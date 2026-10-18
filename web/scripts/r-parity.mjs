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
import { exportR } from "../src/export/rscript.ts";

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
 * `write.tree(tree)` at top level prints R's vector form — one line like
 * `[1] "((A:1,B:2):3,C:4);"` — so pull the Newick out of the quotes and
 * undo R's own string escaping (\" and \\).
 */
function extractNewick(stdout) {
  for (const line of stdout.trim().split("\n")) {
    const m = /^\[\d+\] "(.*)"\s*$/.exec(line);
    if (m !== null && m[1].endsWith(";")) {
      return m[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
    }
    // A bare Newick line also counts (e.g. if output style changes).
    if (/^\(.*\);$/.test(line.trim())) return line.trim();
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

if (process.exitCode) process.exit(process.exitCode);
console.log(`R parity OK (${checked} comparisons)`);
