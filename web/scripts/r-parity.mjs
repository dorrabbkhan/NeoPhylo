#!/usr/bin/env node
// R export parity (plan Task 24, spec §8.6). For every committed
// fixtures/ref/*.json input (ape-generated ones), this generates the R
// script with exportR, runs it through Rscript, parses the printed
// Newick with the built wasm engine, and compares it against the
// engine's own tree: topology RF = 0 and all pairwise patristic
// distances within 1e-6 (R's write.tree prints limited digits).
// Run from web/: `node scripts/r-parity.mjs` (check.sh, RPARITY=1).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { initSync } from "../src/engine/pkg/neophylo_wasm.js";
import * as wasm from "../src/engine/pkg/neophylo_wasm.js";
import { escapeR, exportR } from "../src/export/rscript.ts";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const fixturesDir = resolve(webDir, "../fixtures");

initSync({
  module: readFileSync(resolve(webDir, "src/engine/pkg/neophylo_wasm_bg.wasm")),
});

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

const unwrap = (r, what) => {
  if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

/** Patristic (path) distance between nodes a and b of `tree`. */
function patristic(tree) {
  const dist = (a, b) => {
    // Ancestor set of a with edge sums, then climb from b until we meet
    // it (the LCA). Rooting does not matter for the path length.
    const anc = new Map();
    let d = 0;
    for (let id = a; id !== null; id = tree.nodes[id].parent) {
      anc.set(id, d);
      d += tree.branches[id].length ?? 0;
    }
    d = 0;
    for (let id = b; ; id = tree.nodes[id].parent) {
      if (anc.has(id)) return anc.get(id) + d;
      d += tree.branches[id].length ?? 0;
    }
  };
  return dist;
}

function runR(script) {
  const dir = mkdtempSync(join(tmpdir(), "r-parity-"));
  try {
    const file = join(dir, "script.R");
    writeFileSync(file, script);
    return execFileSync("Rscript", [file], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `cat(write.tree(tree), "\n")` prints the bare Newick line — that's the
 * primary form. The old quoted vector form `[1] "((A:1,B:2):3,C:4);"`
 * is still accepted for robustness (escaping undone: \" and \\).
 */
function extractNewick(stdout) {
  for (const line of stdout.trim().split("\n")) {
    if (/^\(.*\);$/.test(line.trim())) return line.trim();
  }
  for (const line of stdout.trim().split("\n")) {
    const m = /^\[\d+\] "(.*)"\s*$/.exec(line);
    if (m !== null && m[1].endsWith(";")) {
      return m[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
    }
  }
  return null;
}

function compareTrees(name, rTree, eTree) {
  const rf = unwrap(wasm.compare(rTree, eTree), "compare");
  if (rf.rf !== 0) {
    fail(`${name}: RF = ${rf.rf} (expected 0)`);
    return;
  }
  const labels = eTree.nodes
    .filter((n) => n.children.length === 0)
    .map((n) => n.label);
  const rd = patristic(rTree);
  const ed = patristic(eTree);
  const idOf = (t, label) =>
    t.nodes.findIndex((n) => n.children.length === 0 && n.label === label);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i];
      const b = labels[j];
      const diff = Math.abs(
        rd(idOf(rTree, a), idOf(rTree, b)) - ed(idOf(eTree, a), idOf(eTree, b)),
      );
      if (!(diff <= 1e-6)) {
        fail(
          `${name}: patristic ${a}-${b} differs by ${diff.toExponential(3)} ` +
            `(R ${rd(idOf(rTree, a), idOf(rTree, b))} vs engine ` +
            `${ed(idOf(eTree, a), idOf(eTree, b))})`,
        );
        return;
      }
    }
  }
}

const CORRECTIONS = ["P", "Jc69", "K80"];
const METHODS = ["Nj", "Upgma"];

let checked = 0;
const refs = readdirSync(join(fixturesDir, "ref"))
  .filter((f) => f.endsWith(".json") && !f.endsWith("_phylip.json"))
  .sort();

for (const file of refs) {
  const ref = JSON.parse(readFileSync(join(fixturesDir, "ref", file), "utf8"));
  const fasta = readFileSync(join(fixturesDir, ref.input), "utf8");
  const alignment = unwrap(wasm.parse_fasta(fasta), "parse_fasta");
  for (const correction of CORRECTIONS) {
    const dm = wasm.distances(alignment, correction);
    if (!dm.ok) {
      console.log(`skip ${ref.name} ${correction}: engine ${dm.error.kind}`);
      continue;
    }
    for (const method of METHODS) {
      const built = wasm.build_tree(dm.value, method, { trace: false });
      if (!built.ok) {
        console.log(
          `skip ${ref.name} ${correction}/${method}: engine ${built.error.kind}`,
        );
        continue;
      }
      const tag = `${ref.name} ${correction}/${method}`;
      const stdout = runR(exportR(alignment, correction, method));
      const newick = extractNewick(stdout);
      if (!newick) {
        fail(`${tag}: no Newick in R output: ${stdout.slice(0, 200)}`);
        continue;
      }
      const rTree = unwrap(wasm.parse_newick(newick), `parse_newick (${tag})`);
      compareTrees(tag, rTree, built.value.tree);
      checked += 1;
    }
  }
}

// Review Focus 2: a label with a quote and an apostrophe must produce a
// script R actually runs (the unit test only checks the escaping).
{
  const alignment = {
    labels: ["O'Brien\"s", "b", "c", "d"],
    seqs: [
      [65, 67, 71, 84, 65, 67, 71, 84],
      [65, 67, 71, 84, 65, 67, 71, 65],
      [65, 67, 65, 84, 65, 67, 65, 84],
      [65, 65, 71, 84, 65, 65, 71, 84],
    ],
  };
  try {
    const out = runR(exportR(alignment, "Jc69", "Nj"));
    const newick = extractNewick(out);
    if (!newick) throw new Error(`no Newick in output: ${out.slice(0, 200)}`);
    // R's write.tree emits labels containing ' or " bare (not
    // single-quoted), which is non-standard Newick — so we check the
    // label survived rather than re-parsing with our strict parser.
    if (!newick.includes("O'Brien\"s")) {
      throw new Error(`label mangled in output: ${newick}`);
    }
    checked += 1;
    console.log("ok escaped-label script runs in R");
  } catch (e) {
    fail(`escaped-label script: ${e.message}`);
  }
}

// --- protein parity (v1.1 Task 13) --------------------------------------
// For every fixtures/ref/protein/*.json the exported R script's printed
// distance matrix is compared cell-by-cell against the engine's:
// p and Kimura must match to 1e-9 (same formulas), while phangorn's JTT
// is a different variant than protdist's — it differs by ~1–1.7%
// relative across all distance bands (docs/decisions.md Task 6), so JTT
// is compared at JTT_REL_TOL relative. Engine "Saturated" cells must
// come out non-finite in R (NaN from -log of a negative argument, or
// Inf from dist.ml's bound).
const JTT_REL_TOL = 0.02; // decisions.md Task 6: ~1–1.7% relative, rounded up

/** Parse the R-printed matrix rows into numbers/NaN. Returns null if
 * fewer than `n` numeric lines were found. */
function parseMatrix(stdout, n) {
  const rows = [];
  for (const line of stdout.trim().split("\n")) {
    const toks = line.trim().split(/\s+/);
    if (toks.length !== n) continue;
    const vals = toks.map((t) => {
      if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
      if (t === "NA" || t === "NaN") return NaN;
      if (t === "Inf") return Infinity;
      if (t === "-Inf") return -Infinity;
      return null;
    });
    if (vals.every((v) => v !== null)) rows.push(vals);
  }
  return rows.length >= n ? rows.slice(rows.length - n) : null;
}

function compareMatrix(tag, rMat, dm, relTol) {
  const n = dm.labels.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = dm.cells[i * n + j];
      const rv = rMat[i][j];
      if (cell === "Saturated") {
        if (Number.isFinite(rv)) {
          fail(`${tag}: [${i},${j}] engine Saturated but R = ${rv}`);
          return;
        }
        continue;
      }
      const ev = cell.Value;
      if (!Number.isFinite(rv)) {
        fail(`${tag}: [${i},${j}] engine ${ev} but R non-finite`);
        return;
      }
      const diff = Math.abs(rv - ev);
      const tol = relTol === null ? 1e-9 : relTol * Math.max(Math.abs(ev), 1e-12);
      if (!(diff <= Math.max(tol, 1e-9))) {
        fail(
          `${tag}: [${i},${j}] |${rv} - ${ev}| = ${diff.toExponential(3)}` +
            ` (tol ${Math.max(tol, 1e-9).toExponential(3)})`,
        );
        return;
      }
    }
  }
}

const pdir = join(fixturesDir, "ref", "protein");
const proteinRefs = existsSync(pdir)
  ? readdirSync(pdir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];

for (const file of proteinRefs) {
  const ref = JSON.parse(readFileSync(join(pdir, file), "utf8"));
  const fasta = readFileSync(join(fixturesDir, ref.input), "utf8");
  const alignment = unwrap(wasm.parse_fasta(fasta), `parse_fasta ${ref.name}`);
  for (const [correction, relTol] of [
    ["P", null],
    ["Kimura", null],
    ["Jtt", JTT_REL_TOL],
  ]) {
    const tag = `${ref.name} ${correction}`;
    const dm = wasm.distances(alignment, correction);
    if (!dm.ok) {
      fail(`${tag}: engine distances failed: ${JSON.stringify(dm.error)}`);
      continue;
    }
    const stdout = runR(exportR(alignment, correction, "Nj"));
    const rMat = parseMatrix(stdout, alignment.labels.length);
    if (rMat === null) {
      fail(`${tag}: no ${alignment.labels.length}x${alignment.labels.length} matrix in R output`);
      continue;
    }
    compareMatrix(tag, rMat, dm.value, relTol);
    checked += 1;
  }

  // PHYLIP round trip (Task 13): the exported matrix must feed
  // `neighbor` and reproduce NeoPhylo's NJ tree (RF = 0). PHYLIP_NEIGHBOR
  // is set by scripts/ci/r-parity.sh; the check is skipped if absent.
  const neighborBin = process.env.PHYLIP_NEIGHBOR;
  if (neighborBin) {
    const dm = wasm.distances(alignment, "Jtt");
    if (!dm.ok) {
      fail(`${ref.name}: engine JTT failed: ${JSON.stringify(dm.error)}`);
      continue;
    }
    const written = wasm.write_phylip_matrix(dm.value, "Auto");
    if (!written.ok) {
      fail(`${ref.name}: write_phylip_matrix ${JSON.stringify(written.error)}`);
      continue;
    }
    const dir = mkdtempSync(join(tmpdir(), "neighbor-"));
    try {
      writeFileSync(join(dir, "infile"), written.value);
      execFileSync(neighborBin, {
        input: "Y\n",
        cwd: dir,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const outtree = readFileSync(join(dir, "outtree"), "utf8");
      const nwk = outtree.replace(/\s+/g, "");
      const rTree = unwrap(wasm.parse_newick(nwk), `parse_newick ${ref.name}`);
      const built = unwrap(
        wasm.build_tree(dm.value, "Nj", { trace: false }),
        `build_tree ${ref.name}`,
      );
      const rf = unwrap(wasm.compare(built.tree, rTree), "compare");
      if (rf.rf !== 0) {
        fail(`${ref.name}: neighbor round trip RF = ${rf.rf} (expected 0)`);
      } else {
        checked += 1;
        console.log(`ok ${ref.name}: neighbor round trip RF = 0`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// --- bootstrap statistical parity (v1.2 Task 8, spec §8.3) -----------
// For two fixture alignments — one DNA (JC69, NJ), one protein (Kimura,
// NJ) — run BOOT_REPS replicates through the wasm engine and through
// ape::boot.phylo(B, trees = TRUE) with the same distance and method.
// Every internal branch's support must differ by at most 5 percentage
// points (the resampling RNGs differ, so this is a statistical check,
// not an equality check). The per-split table is printed either way.

const BOOT_REPS = Number(process.env.BOOT_REPS || 1000);

/** Leaf labels under node `id` of `tree` (test-side grouping lookup). */
function leafSet(tree, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const n = tree.nodes[stack.pop()];
    if (n.children.length === 0) out.add(n.label);
    else for (const c of n.children) stack.push(c);
  }
  return out;
}

/**
 * Canonical split key for an edge in the support tree: the side NOT
 * containing `labels[0]` (the engine's canonical side, Global
 * Constraints), sorted for comparison.
 */
function canonicalKey(tree, id, labels) {
  const under = leafSet(tree, id);
  const side = under.has(labels[0])
    ? labels.filter((l) => !under.has(l))
    : [...under];
  return side.slice().sort().join("|");
}

/**
 * Engine side: bootstrap `aln` under `model`/`method`, then collect
 * canonical split -> support fraction for every internal branch that
 * carries one. Returns { map, successful, failed }.
 */
function engineSupport(alignment, model, method, seed, replicates) {
  const tally = unwrap(
    wasm.bootstrap_batch(alignment, model, method, seed, 0, replicates),
    "bootstrap_batch",
  );
  const dm = unwrap(wasm.distances(alignment, model), "distances");
  const built = unwrap(
    wasm.build_tree(dm, method, { trace: false }),
    "build_tree",
  );
  const support = unwrap(
    wasm.support_on_tree(built.tree, tally),
    "support_on_tree",
  );
  const map = new Map();
  support.nodes.forEach((n, id) => {
    const s = support.branches[id]?.support;
    if (s === null || s === undefined) return;
    map.set(canonicalKey(support, id, tally.labels), s);
  });
  return { map, successful: tally.successful, failed: tally.failed };
}

/**
 * The ape::boot.phylo side as an R script. Prints one JSON array of
 * { labels: [...], count: n } — the bipartitions ape::prop.part found
 * in the B replicate trees. The FUN given to boot.phylo redoes the
 * full distance + NJ on each resample, matching the engine.
 */
function bootScript(alignment, body) {
  const lines = [];
  alignment.labels.forEach((label, i) => {
    lines.push(`>${label}`);
    lines.push(String.fromCharCode(...alignment.seqs[i]));
  });
  const fasta = escapeR(lines.join("\n"));
  return `# v1.2 spec §8.3: bootstrap bipartition counts.
# The resample loop is what ape::boot.phylo does with block=1
# (x[, sample.int(nc, TRUE)]), written out because boot.phylo aborts on
# the first FUN error — it cannot express the engine's failed-replicate
# rule (a replicate with saturated/unestimable distances is skipped, so
# FUN returns NULL and the loop keeps only successful trees).
fa <- "${fasta}"
${body}
trees <- vector("list", ${BOOT_REPS})
kept <- 0L
for (b in seq_len(${BOOT_REPS})) {
  tr <- f(x[, sample.int(ncol(x), replace = TRUE)])
  if (!is.null(tr)) {
    kept <- kept + 1L
    trees[[kept]] <- tr
  }
}
trees <- trees[seq_len(kept)]
class(trees) <- "multiPhylo"
pp <- ape::prop.part(trees, check.labels = TRUE)
tips <- attr(pp, "labels")
counts <- attr(pp, "number")
out <- lapply(seq_along(pp), function(i)
  list(labels = tips[pp[[i]]], count = counts[i]))
cat(jsonlite::toJSON(list(kept = kept, parts = out), auto_unbox = TRUE),
    "\n")
`;
}

const DNA_BOOT = `aln <- ape::read.dna(textConnection(fa), format = "fasta")
x <- aln
d <- ape::dist.dna(aln, model = "JC69", pairwise.deletion = TRUE)
tree <- ape::nj(d)
# Saturated JC69 distances come out Inf, which ape::nj rejects; those
# replicates are the engine's 'failed' set, so FUN returns NULL.
f <- function(x) tryCatch(
  ape::nj(ape::dist.dna(x, model = "JC69", pairwise.deletion = TRUE)),
  error = function(e) NULL)`;

const PROTEIN_BOOT = `aln <- ape::read.FASTA(textConnection(fa), type = "AA")
x <- do.call(rbind, lapply(aln, as.character))
p0 <- as.matrix(ape::dist.aa(as.matrix(aln), pairwise.deletion = TRUE,
                             scaled = TRUE))
tree <- ape::nj(as.dist(-log(1 - p0 - 0.2 * p0^2)))
# Kimura (1983): d = -ln(1 - p - p^2/5), the same transform the protein
# R export uses; p from ape::dist.aa on the resampled matrix. A pair too
# diverged for the transform (non-finite d) is a skipped replicate.
f <- function(x) {
  p <- as.matrix(ape::dist.aa(x, pairwise.deletion = TRUE,
                              scaled = TRUE))
  dd <- -log(1 - p - 0.2 * p^2)
  if (any(!is.finite(dd[lower.tri(dd)]))) return(NULL)
  ape::nj(as.dist(dd))
}`;

/**
 * Compare engine vs R support for one alignment. A part matches an
 * engine split when the part's label set equals the canonical side or
 * its complement; both fractions divide by their kept replicate count.
 */
function compareBootstrap(tag, alignment, model, scriptBody) {
  const { map, successful, failed } = engineSupport(
    alignment,
    model,
    "Nj",
    1,
    BOOT_REPS,
  );
  const stdout = runR(scriptBody);
  const jsonLine = stdout
    .trim()
    .split("\n")
    .find((l) => l.trim().startsWith('{"kept"'));
  if (!jsonLine) {
    fail(`${tag}: no JSON in R output: ${stdout.slice(0, 300)}`);
    return;
  }
  const { kept, parts } = JSON.parse(jsonLine);
  const all = new Set(alignment.labels);
  // ape::prop.part reports each bipartition under whichever side is
  // below the stored root, so the same split can appear under either
  // orientation across trees — sum the counts of every part matching
  // this bipartition on either side.
  const rCount = (key) => {
    const side = new Set(key.split("|"));
    const same = (a, b) =>
      a.size === b.size && [...a].every((l) => b.has(l));
    let n = 0;
    for (const p of parts) {
      const set = new Set(p.labels);
      const comp = new Set([...all].filter((l) => !set.has(l)));
      if (same(set, side) || same(comp, side)) n += p.count;
    }
    return n;
  };
  console.log(
    `\n${tag}: ${successful} successful, ${failed} skipped ` +
      `(engine), ${kept} of ${BOOT_REPS} kept (ape)`,
  );
  console.log("  split".padEnd(44) + "engine %".padStart(10) +
    "ape %".padStart(10) + "|diff| pp".padStart(11));
  let worst = 0;
  let ok = true;
  const rows = [...map.entries()].sort(
    (a, b) => a[0].split("|").length - b[0].split("|").length,
  );
  for (const [key, frac] of rows) {
    const rFrac = rCount(key) / kept;
    const diff = Math.abs(frac - rFrac);
    worst = Math.max(worst, diff);
    if (diff > 0.05) ok = false;
    console.log(
      "  " +
        key.padEnd(42) +
        (frac * 100).toFixed(1).padStart(9) +
        (rFrac * 100).toFixed(1).padStart(10) +
        (diff * 100).toFixed(2).padStart(11),
    );
  }
  if (!ok) {
    fail(`${tag}: support differs by more than 5 pp (worst ${(worst * 100).toFixed(2)} pp)`);
    return;
  }
  checked += 1;
  console.log(`ok ${tag}: all splits within 5 pp (worst ${(worst * 100).toFixed(2)} pp)`);
}

// DNA: fixtures/inputs/jc12.fasta, JC69, NJ (spec §8.3 / plan Task 8).
{
  const fasta = readFileSync(join(fixturesDir, "inputs/jc12.fasta"), "utf8");
  const alignment = unwrap(wasm.parse_fasta(fasta), "parse_fasta jc12");
  compareBootstrap(
    "jc12 JC69/NJ bootstrap",
    alignment,
    "Jc69",
    bootScript(alignment, DNA_BOOT),
  );
}

// Protein: fixtures/inputs/protein/p6_150.fasta, Kimura, NJ.
{
  const fasta = readFileSync(
    join(fixturesDir, "inputs/protein/p6_150.fasta"),
    "utf8",
  );
  const alignment = unwrap(wasm.parse_fasta(fasta), "parse_fasta p6_150");
  compareBootstrap(
    "p6_150 Kimura/NJ bootstrap",
    alignment,
    "Kimura",
    bootScript(alignment, PROTEIN_BOOT),
  );
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`R parity OK (${checked} comparisons)`);
