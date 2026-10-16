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

if (process.exitCode) process.exit(process.exitCode);
console.log(`R parity OK (${checked} comparisons)`);
