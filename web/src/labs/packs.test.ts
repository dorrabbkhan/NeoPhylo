// Lab pack checks (v1.4 plan Task 12, spec §3.2/§6.2/§6.3). One
// describe per shipped pack; each asserts four things against the
// committed PHYLIP fixture, never against NeoPhylo's own output:
//
//   1. the pack loads through loadLab and its lab block validates;
//   2. its embedded sequences equal the committed input FASTA byte for
//      byte (names and residues), read from the repo file;
//   3. every settings-table row that names a NeoPhylo setting agrees
//      with the exercise's actual fields — the table cannot drift
//      from the file;
//   4. computed numbers match PHYLIP: the engine's distance matrix on
//      the pack's alignment equals dnadist's printed values within
//      half a unit of the last printed decimal, and NJ — run on
//      PHYLIP's own printed matrix, the exact input neighbor consumed
//      (spec §3.2) — gives the fixture tree's splits exactly and its
//      branch lengths within neighbor's printed precision. NJ on the
//      engine's own matrix must give the same splits.
//
// The comparison is always the COMPUTED tree (splits and lengths from
// the engine), never a drawn, rerooted or laid-out view. Fixtures are
// the oracle: a failure here is a bug in the pack or the engine,
// never in the fixture (AGENTS.md rule 1).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { Cell } from "../engine/generated/Cell";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { Exercise } from "../engine/generated/Exercise";
import type { Tree } from "../engine/generated/Tree";

import { loadLab } from "./registry";
import { splitKeys } from "../layout/splitKeys";
import type { BootstrapTally } from "../engine/generated/BootstrapTally";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { DistModel } from "../engine/generated/DistModel";
import type { SiteFilter } from "../engine/generated/SiteFilter";

const FIXTURES = resolve("..", "fixtures");

interface PhylipFixture {
  name: string;
  labels: string[];
  /** Path to the FASTA input, relative to fixtures/. */
  input: string;
  /** Run name → dense n×n matrix ("F84"). */
  distances: Record<string, number[][]>;
  /** Run name → neighbor's outtree Newick on the printed matrix. */
  nj: Record<string, string>;
  /** Decimals the distance program printed (phylip/ files: the
   * matrix decimals). */
  precision: number;
  /** ref files only: decimals the distance program printed in the
   * matrix (dnadist/protdist print 6). */
  dist_precision?: number;
  /** ref files only: decimals neighbor printed in the outtree (5). */
  tree_precision?: number;
}

/** A ref/ PHYLIP fixture — dist_precision and tree_precision are
 * required (PR #103); a missing key fails at load, never falls back
 * to `precision`. */
interface RefPhylipFixture extends PhylipFixture {
  dist_precision: number;
  tree_precision: number;
}

function loadFixture(sub: string, name: string): PhylipFixture {
  const text = readFileSync(
    resolve(FIXTURES, "phylip", sub, `${name}.json`),
    "utf8",
  );
  return JSON.parse(text) as PhylipFixture;
}

/** The protdist corpus files live in ref/protein/ (protein_dist.rs
 * owns that glob), not under phylip/ — same JSON shape otherwise. */
function loadProteinFixture(name: string): RefPhylipFixture {
  const text = readFileSync(
    resolve(FIXTURES, "ref", "protein", `${name}.json`),
    "utf8",
  );
  const fx = JSON.parse(text) as RefPhylipFixture;
  if (
    typeof fx.dist_precision !== "number" ||
    typeof fx.tree_precision !== "number"
  ) {
    throw new Error(
      `ref/protein/${name}.json must carry dist_precision and tree_precision`,
    );
  }
  return fx;
}

/** `>{name}\n{seq}` records in file order — names and residues byte
 * for byte, ignoring only line wrapping. */
function fastaRecords(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      out.push([line.slice(1), ""]);
    } else if (line.trim() !== "" && out.length > 0) {
      out[out.length - 1][1] += line.trim();
    }
  }
  return out;
}

/** The pack's own copy of its alignment, parsed by the engine. */
function packAlignment(ex: Exercise): Alignment {
  if (ex.data.kind !== "embedded") {
    throw new Error("the pack must embed its alignment");
  }
  const r = engine.parseFasta(ex.data.fasta);
  if (!r.ok) throw new Error(`embedded FASTA must parse`);
  return r.value;
}

/** The fixture's printed matrix as the DistanceMatrix the reference
 * tool's tree program consumed — cells exactly as printed. */
function printedMatrix(
  fx: PhylipFixture,
  run: string,
  model: DistModel,
): DistanceMatrix {
  const want = fx.distances[run];
  const cells: Cell[] = [];
  for (const row of want) {
    for (const v of row) cells.push({ Value: v });
  }
  return { labels: fx.labels, model, cells };
}

function nj(m: DistanceMatrix): Tree {
  const r = engine.buildTree(m, "Nj", { trace: false });
  if (!r.ok) throw new Error(`buildTree failed: ${JSON.stringify(r.error)}`);
  return r.value.tree;
}

function parse(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

/** The sorted multiset of edge lengths — the same tree comparison the
 * corpus oracle uses (tests/corpus.rs check_nj). */
function branchLengths(t: Tree): number[] {
  return t.branches
    .map((b) => b.length)
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b);
}

describe("lab pack dnadist-neighbor", () => {
  const loaded = loadLab("dnadist-neighbor");
  if (!loaded.ok) throw new Error(`pack must load: ${JSON.stringify(loaded.error)}`);
  const pack = loaded.value;
  const fx = loadFixture("f84", "k80_10");
  const inputText = readFileSync(resolve(FIXTURES, fx.input), "utf8");

  it("loads through loadLab and its lab block validates", () => {
    expect(pack.lab.id).toBe("dnadist-neighbor");
    expect(pack.lab.chain).toEqual(["dnadist", "neighbor"]);
    expect(pack.exercise.schema_version).toBe(3);
    expect(pack.exercise.analysis.correction).toBe("F84");
    expect(pack.exercise.analysis.method).toBe("Nj");
    expect(pack.exercise.data.kind).toBe("embedded");
    expect(pack.lab.settings.length).toBeGreaterThan(0);
    expect(pack.lab.objectives.length).toBeGreaterThan(0);
  });

  it("embeds fixtures/inputs/k80_10.fasta byte for byte (names and residues)", () => {
    if (pack.exercise.data.kind !== "embedded") throw new Error("unreachable");
    const embedded = fastaRecords(pack.exercise.data.fasta);
    const committed = fastaRecords(inputText);
    expect(embedded).toEqual(committed);
    expect(embedded.length).toBe(fx.labels.length);
    expect(embedded.map(([name]) => name)).toEqual(fx.labels);
  });

  it("settings-table rows naming a NeoPhylo setting agree with the exercise", () => {
    // Rows whose neophylo cell asserts a real app control start with
    // the control's name ("Correction:", "Method:"); each must agree
    // with the exercise field that control loads. Both kinds must be
    // present so the check can't silently pass on an empty table.
    let sawCorrection = false;
    let sawMethod = false;
    for (const row of pack.lab.settings) {
      if (row.neophylo.startsWith("Correction:")) {
        sawCorrection = true;
        expect(row.neophylo).toContain("F84");
        expect(pack.exercise.analysis.correction).toBe("F84");
      }
      if (row.neophylo.startsWith("Method:")) {
        sawMethod = true;
        expect(row.neophylo).toMatch(/Neighbor-Joining|NJ/);
        expect(pack.exercise.analysis.method).toBe("Nj");
      }
    }
    expect(sawCorrection, "a settings row must name the Correction control").toBe(true);
    expect(sawMethod, "a settings row must name the Method control").toBe(true);
  });

  it("reproduces dnadist's printed F84 matrix within its precision", () => {
    const aln = packAlignment(pack.exercise);
    const r = engine.distances(aln, "F84");
    if (!r.ok) throw new Error(`distances failed: ${JSON.stringify(r.error)}`);
    const got = r.value;
    expect(got.labels).toEqual(fx.labels);
    const n = fx.labels.length;
    const tol = 0.5 * Math.pow(10, -fx.precision); // 6 decimals → 0.5e-6
    const want = fx.distances.F84;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cell = got.cells[i * n + j];
        expect(cell === "Saturated" ? Infinity : Math.abs(cell.Value - want[i][j]),
          `cell ${fx.labels[i]}/${fx.labels[j]}`).toBeLessThanOrEqual(tol);
      }
    }
  });

  it("NJ on PHYLIP's printed F84 matrix gives nj.F84's splits and lengths", () => {
    const got = nj(printedMatrix(fx, "F84", "F84"));
    const want = parse(fx.nj.F84);
    // Unrooted RF = 0 pins every split; the sorted edge-length
    // multiset then agrees elementwise within neighbor's printed
    // precision (5 decimals → 0.5e-5). The f84 fixture records only
    // `precision` — dnadist's 6 matrix decimals — so the outtree
    // bound stays a literal.
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed: ${JSON.stringify(r.error)}`);
    expect(r.value.rf).toBe(0);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    const tol = 0.5e-5;
    gl.forEach((g, k) =>
      expect(Math.abs(g - wl[k]), `branch length ${k}`).toBeLessThanOrEqual(tol));
  });

  it("NJ on the engine's own F84 matrix gives the same splits", () => {
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "F84");
    if (!dm.ok) throw new Error(`distances failed`);
    const got = nj(dm.value);
    const want = parse(fx.nj.F84);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed`);
    expect(r.value.rf).toBe(0);
  });

  it("NJ on the engine's own F84 matrix gives nj.F84's lengths within 0.5e-5", () => {
    // neighbor ran on dnadist's PRINTED (6-decimal) matrix while the
    // engine keeps full precision; this pins that the difference never
    // shows at neighbor's own printed precision (5 decimals → 0.5e-5).
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "F84");
    if (!dm.ok) throw new Error(`distances failed`);
    const got = nj(dm.value);
    const want = parse(fx.nj.F84);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    const tol = 0.5e-5;
    gl.forEach((g, k) =>
      expect(Math.abs(g - wl[k]), `branch length ${k}`).toBeLessThanOrEqual(tol));
  });

  it("pins the prompt's teaching claims to the computed trace and matrix", () => {
    // The predict_pair reveal names t04–t05 as the first join and
    // t06–t07 as the closest pair. Both claims come from the engine on
    // PHYLIP's printed matrix — never from the fixture's tree text.
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "F84");
    if (!dm.ok) throw new Error(`distances failed`);

    // Closest pair in the engine's own matrix.
    let best = { d: Infinity, i: -1, j: -1 };
    const labels = dm.value.labels;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const c = dm.value.cells[i * labels.length + j];
        if (c !== "Saturated" && c.Value < best.d) {
          best = { d: c.Value, i, j };
        }
      }
    }
    expect([labels[best.i], labels[best.j]].sort()).toEqual(["t06", "t07"]);

    // First join of the engine's NJ trace on PHYLIP's printed matrix.
    const tr = engine.buildTree(printedMatrix(fx, "F84", "F84"), "Nj", {
      trace: true,
    });
    if (!tr.ok) throw new Error(`buildTree failed`);
    const trace = tr.value.trace;
    if (trace === null || !("Nj" in trace)) {
      throw new Error("NJ trace missing");
    }
    const first = trace.Nj.steps[0];
    const pair = [first.chosen[0], first.chosen[1]]
      .map((pos) => {
        const node = first.active[pos];
        return dm.value.labels[node];
      })
      .sort();
    expect(pair).toEqual(["t04", "t05"]);
  });
});

/** The length of the edge above `label`'s leaf — branches are indexed
 * by node id. */
function pendantLength(t: Tree, label: string): number {
  const idx = t.nodes.findIndex((n) => n.label === label);
  if (idx < 0) throw new Error(`${label} is not a leaf in this tree`);
  const len = t.branches[idx].length;
  if (len === null) throw new Error(`${label}'s edge carries no length`);
  return len;
}

describe("lab pack protdist-neighbor", () => {
  const loaded = loadLab("protdist-neighbor");
  if (!loaded.ok) throw new Error(`pack must load: ${JSON.stringify(loaded.error)}`);
  const pack = loaded.value;
  const fx = loadProteinFixture("p10_400");
  const inputText = readFileSync(resolve(FIXTURES, fx.input), "utf8");

  it("loads through loadLab and its lab block validates", () => {
    expect(pack.lab.id).toBe("protdist-neighbor");
    expect(pack.lab.chain).toEqual(["protdist", "neighbor"]);
    expect(pack.exercise.schema_version).toBe(3);
    expect(pack.exercise.alphabet).toBe("protein");
    expect(pack.exercise.analysis.correction).toBe("Jtt");
    expect(pack.exercise.analysis.method).toBe("Nj");
    expect(pack.exercise.data.kind).toBe("embedded");
    expect(pack.lab.settings.length).toBeGreaterThan(0);
    expect(pack.lab.objectives.length).toBeGreaterThan(0);
  });

  it("embeds fixtures/inputs/protein/p10_400.fasta byte for byte (names and residues)", () => {
    if (pack.exercise.data.kind !== "embedded") throw new Error("unreachable");
    const embedded = fastaRecords(pack.exercise.data.fasta);
    const committed = fastaRecords(inputText);
    expect(embedded).toEqual(committed);
    expect(embedded.length).toBe(fx.labels.length);
    expect(embedded.map(([name]) => name)).toEqual(fx.labels);
  });

  it("settings-table rows naming a NeoPhylo setting agree with the exercise", () => {
    // Same pin as pack 1: rows asserting a real app control open with
    // the control's name, and each must agree with the exercise field
    // that control loads. The JTT row shows the menu label "JTT"
    // while the wire correction is the DistModel variant "Jtt" — the
    // test pins both spellings so neither can drift.
    let sawCorrection = false;
    let sawMethod = false;
    for (const row of pack.lab.settings) {
      if (row.neophylo.startsWith("Correction:")) {
        sawCorrection = true;
        expect(row.neophylo).toContain("JTT");
        expect(pack.exercise.analysis.correction).toBe("Jtt");
      }
      if (row.neophylo.startsWith("Method:")) {
        sawMethod = true;
        expect(row.neophylo).toMatch(/Neighbor-Joining|NJ/);
        expect(pack.exercise.analysis.method).toBe("Nj");
      }
    }
    expect(sawCorrection, "a settings row must name the Correction control").toBe(true);
    expect(sawMethod, "a settings row must name the Method control").toBe(true);
  });

  it("reproduces protdist's printed JTT matrix within its precision", () => {
    const aln = packAlignment(pack.exercise);
    const r = engine.distances(aln, "Jtt");
    if (!r.ok) throw new Error(`distances failed: ${JSON.stringify(r.error)}`);
    const got = r.value;
    expect(got.labels).toEqual(fx.labels);
    const n = fx.labels.length;
    // protdist 3.697 prints 6 decimals in outfile (`0.722200`); the
    // fixture's `dist_precision` records that, so the bound is half a
    // unit of the last printed decimal. Measured max engine-vs-fixture
    // diff is 4.95e-7, so the bound passes honestly.
    const tol = 0.5 * Math.pow(10, -fx.dist_precision); // 6 decimals → 0.5e-6
    const want = fx.distances.JTT;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cell = got.cells[i * n + j];
        expect(cell === "Saturated" ? Infinity : Math.abs(cell.Value - want[i][j]),
          `cell ${fx.labels[i]}/${fx.labels[j]}`).toBeLessThanOrEqual(tol);
      }
    }
  });

  it("NJ on PHYLIP's printed JTT matrix gives nj.JTT's splits and lengths", () => {
    const got = nj(printedMatrix(fx, "JTT", "Jtt"));
    const want = parse(fx.nj.JTT);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed: ${JSON.stringify(r.error)}`);
    expect(r.value.rf).toBe(0);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    // neighbor's outtree prints 5 decimals → 0.5e-5.
    const tol = 0.5 * Math.pow(10, -fx.tree_precision);
    gl.forEach((g, k) =>
      expect(Math.abs(g - wl[k]), `branch length ${k}`).toBeLessThanOrEqual(tol));
  });

  it("NJ on the engine's own JTT matrix gives the same splits", () => {
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "Jtt");
    if (!dm.ok) throw new Error(`distances failed`);
    const got = nj(dm.value);
    const want = parse(fx.nj.JTT);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed`);
    expect(r.value.rf).toBe(0);
  });

  it("NJ on the engine's own JTT matrix gives nj.JTT's lengths within 0.5e-5", () => {
    // Same pin as pack 1: neighbor ran on protdist's PRINTED matrix
    // while the engine keeps full precision; this pins that the
    // difference never shows at neighbor's own printed precision
    // (tree_precision, 5 decimals → 0.5e-5). Measured headroom: ~4.5e-6.
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "Jtt");
    if (!dm.ok) throw new Error(`distances failed`);
    const got = nj(dm.value);
    const want = parse(fx.nj.JTT);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    const tol = 0.5 * Math.pow(10, -fx.tree_precision);
    gl.forEach((g, k) =>
      expect(Math.abs(g - wl[k]), `branch length ${k}`).toBeLessThanOrEqual(tol));
  });

  it("pins the prompt's teaching claims to the computed trace and matrix", () => {
    // The predict_pair reveal names P04–P07 as the first join — here
    // also the matrix's closest pair — and the closing note names
    // P05's negative pendant edge. All three claims come from the
    // engine on PHYLIP's printed matrix, never from fixture text.
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "Jtt");
    if (!dm.ok) throw new Error(`distances failed`);

    // Closest pair in the engine's own matrix.
    let best = { d: Infinity, i: -1, j: -1 };
    const labels = dm.value.labels;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const c = dm.value.cells[i * labels.length + j];
        if (c !== "Saturated" && c.Value < best.d) {
          best = { d: c.Value, i, j };
        }
      }
    }
    expect([labels[best.i], labels[best.j]].sort()).toEqual(["P04", "P07"]);

    // First join of the engine's NJ trace on PHYLIP's printed matrix —
    // the pair neighbor's progress log reports joining first.
    const tr = engine.buildTree(printedMatrix(fx, "JTT", "Jtt"), "Nj", {
      trace: true,
    });
    if (!tr.ok) throw new Error(`buildTree failed`);
    const trace = tr.value.trace;
    if (trace === null || !("Nj" in trace)) {
      throw new Error("NJ trace missing");
    }
    const first = trace.Nj.steps[0];
    const pair = [first.chosen[0], first.chosen[1]]
      .map((pos) => {
        const node = first.active[pos];
        return dm.value.labels[node];
      })
      .sort();
    expect(pair).toEqual(["P04", "P07"]);

    // The negative branch the note claims: P05's pendant edge is
    // negative in both the computed tree and PHYLIP's outtree, and
    // the two agree within neighbor's 5 printed decimals.
    const want = parse(fx.nj.JTT);
    const gotLen = pendantLength(tr.value.tree, "P05");
    const wantLen = pendantLength(want, "P05");
    expect(wantLen).toBeLessThan(0);
    expect(gotLen).toBeLessThan(0);
    expect(Math.abs(gotLen - wantLen)).toBeLessThanOrEqual(
      0.5 * Math.pow(10, -fx.tree_precision),
    );
  });

  it("pins the note's mechanism: R(P02) > R(P05) at their join makes P05's share negative", () => {
    // The closing note says P05's pendant edge estimated negative
    // because "P02 sits much farther out than P05". NJ's limb formula
    // splits a join's distance by net divergence:
    //   len(x) = d(x,y)/2 + (R_x - R_y) / (2(k-2)),
    // so P05's share goes negative exactly when R(P02) exceeds R(P05)
    // by more than (k-2)·d. Both claims are read off the engine's own
    // trace on the pack's matrix — the run the student steps through.
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "Jtt");
    if (!dm.ok) throw new Error(`distances failed`);
    const tr = engine.buildTree(dm.value, "Nj", { trace: true });
    if (!tr.ok) throw new Error(`buildTree failed`);
    const trace = tr.value.trace;
    if (trace === null || !("Nj" in trace)) {
      throw new Error("NJ trace missing");
    }
    const labelOf = (id: number) => tr.value.tree.nodes[id].label;

    // The step whose chosen pair is P02 and P05 (a cherry in the tree).
    const step = trace.Nj.steps.find(
      (s) =>
        s.chosen
          .map((p) => labelOf(s.active[p]))
          .sort()
          .join("+") === "P02+P05",
    );
    if (!step) throw new Error("no NJ step joins P02 and P05");
    const [i, j] = step.chosen;
    const iIsP02 = labelOf(step.active[i]) === "P02";
    const [p02, p05] = iIsP02 ? [i, j] : [j, i];
    const lenP05 = iIsP02 ? step.len_j : step.len_i;

    // The premise the note states: P02's net divergence (row sum)
    // exceeds P05's at the join.
    expect(step.r[p02]).toBeGreaterThan(step.r[p05]);

    // The mechanism: the limb formula on the step's own distance and
    // row sums reproduces the negative share the trace records for
    // P05, which is the pendant length the tree carries for it.
    const k = step.active.length;
    const dij = step.distance.data[p02 * k + p05];
    const share = dij / 2 + (step.r[p05] - step.r[p02]) / (2 * (k - 2));
    expect(share).toBeLessThan(0);
    expect(Math.abs(share - lenP05)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(pendantLength(tr.value.tree, "P05") - share))
      .toBeLessThanOrEqual(1e-12);
  });
});

/** A phylip/chain/ fixture — PHYLIP's whole pack-3 chain on one input:
 * seqboot's replicates ran through dnadist (M = 100), neighbor (M =
 * 100, J forced on by its seed prompt) and consense three ways.
 * `trees` are neighbor's 100 outtree Newicks, in order. */
interface ChainFixture {
  name: string;
  generator: string;
  /** Path to the FASTA input, relative to fixtures/. */
  input: string;
  seed: number;
  replicates: number;
  labels: string[];
  trees: string[];
  consense: Record<
    "extended" | "strict" | "majority",
    {
      groups: { labels: string[]; count: number }[];
      not_included: { labels: string[]; count: number }[];
      newick: string;
    }
  >;
  tree_precision: number;
}

function loadChainFixture(name: string): ChainFixture {
  const text = readFileSync(
    resolve(FIXTURES, "phylip", "chain", `${name}.json`),
    "utf8",
  );
  return JSON.parse(text) as ChainFixture;
}

/** The canonical unrooted grouping keys of `tree`'s internal edges —
 * the side not containing labels[0], kept when both sides hold ≥ 2
 * taxa. This is `splitKeys`' display convention, which mirrors
 * `bootstrap::split::tree_splits` exactly (its header documents the
 * shared canonicalization); a degenerate tree's repeated grouping is
 * deduplicated per tree, as the engine's tally does. */
function treeGroupingKeys(tree: Tree, labels: string[]): Set<string> {
  const keys = splitKeys(tree, labels, false);
  const n = labels.length;
  const out = new Set<string>();
  for (const [id, key] of keys) {
    if (id === tree.root || tree.nodes[id].children.length === 0) continue;
    const size = key.split("|").filter((s) => s !== "").length;
    if (size >= 2 && size <= n - 2) out.add(key);
  }
  return out;
}

/** A BootstrapTally over an external set of replicate trees — the
 * wire form `bootstrap_batch` emits, assembled from PHYLIP's own
 * neighbor outtrees so `engine.consensus` can run on them. Split
 * extraction reuses `splitKeys` (an existing display helper that
 * documents the engine's convention); the tally itself is never drawn
 * from a rendered view. */
function tallyFromTrees(trees: string[], labels: string[]): BootstrapTally {
  const counts = new Map<string, number>();
  for (const newick of trees) {
    const r = engine.parseNewick(newick);
    if (!r.ok) throw new Error(`a fixture tree must parse: ${newick}`);
    for (const key of treeGroupingKeys(r.value, labels)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return {
    method: "Nj",
    labels,
    successful: trees.length,
    failed: 0,
    counts: [...counts.entries()].map(([key, count]) => ({
      labels: key.split("|"),
      count,
    })),
  };
}

/** The leaf sets under every node (iterative post-order; mirrors the
 * engine trees' arena order). */
function leafSetsOf(tree: Tree): Map<number, Set<string>> {
  const sets = new Map<number, Set<string>>();
  const seen = new Array<boolean>(tree.nodes.length).fill(false);
  const stack: number[] = [tree.root];
  while (stack.length > 0) {
    const id = stack[stack.length - 1];
    const node = tree.nodes[id];
    if (node.children.every((c) => seen[c])) {
      seen[id] = true;
      stack.pop();
      if (node.children.length === 0) {
        sets.set(id, new Set(node.label === null ? [] : [node.label]));
      } else {
        const under = new Set<string>();
        for (const c of node.children) {
          for (const l of sets.get(c) ?? []) under.add(l);
        }
        sets.set(id, under);
      }
      continue;
    }
    for (const c of node.children) if (!seen[c]) stack.push(c);
  }
  return sets;
}

/** A consensus tree's groupings with their replicate counts — read off
 * the COMPUTED tree (internal nodes' leaf sets and support fractions),
 * never a drawn view. `successful` scales support back to a count. */
function consensusGroupings(
  tree: Tree,
  successful: number,
): { key: string; count: number }[] {
  const sets = leafSetsOf(tree);
  const out: { key: string; count: number }[] = [];
  for (let id = 0; id < tree.nodes.length; id++) {
    const node = tree.nodes[id];
    if (id === tree.root || node.children.length === 0) continue;
    const support = tree.branches[id].support;
    if (support === null) throw new Error("consensus node without support");
    out.push({
      key: [...(sets.get(id) ?? [])].sort().join("|"),
      count: Math.round(support * successful),
    });
  }
  return out;
}

describe("lab pack seqboot-consense", () => {
  const loaded = loadLab("seqboot-consense");
  if (!loaded.ok) throw new Error(`pack must load: ${JSON.stringify(loaded.error)}`);
  const pack = loaded.value;
  const fx = loadChainFixture("jc12_boot100");
  const fxFull = loadFixture("f84", "jc12");
  const inputText = readFileSync(resolve(FIXTURES, fx.input), "utf8");
  const phylipTally = tallyFromTrees(fx.trees, fx.labels);

  it("loads through loadLab and its lab block validates", () => {
    expect(pack.lab.id).toBe("seqboot-consense");
    expect(pack.lab.chain).toEqual([
      "seqboot",
      "dnadist",
      "neighbor",
      "consense",
    ]);
    expect(pack.exercise.schema_version).toBe(3);
    expect(pack.exercise.analysis.correction).toBe("F84");
    expect(pack.exercise.analysis.method).toBe("Nj");
    expect(pack.exercise.data.kind).toBe("embedded");
    expect(pack.lab.settings.length).toBeGreaterThan(0);
    expect(pack.lab.objectives.length).toBeGreaterThan(0);
  });

  it("embeds fixtures/inputs/jc12.fasta byte for byte (names and residues)", () => {
    if (pack.exercise.data.kind !== "embedded") throw new Error("unreachable");
    const embedded = fastaRecords(pack.exercise.data.fasta);
    const committed = fastaRecords(inputText);
    expect(embedded).toEqual(committed);
    expect(embedded.length).toBe(fx.labels.length);
    expect(embedded.map(([name]) => name)).toEqual(fx.labels);
  });

  it("settings-table rows naming a NeoPhylo setting agree with the exercise", () => {
    // Same pin as packs 1–2, plus the two bootstrap controls: rows
    // asserting a real app control open with the control's name
    // ("Correction:", "Method:", "Replicates:", "Seed:") and each must
    // agree with the exercise field that control loads. The replicates
    // row must also show 100 — seqboot's own default, recorded in
    // fixtures/README.md ("defaults are J Bootstrap resampling and
    // R = 100 replicates") — and the seed row must be the odd value the
    // PHYLIP chain ran.
    let sawCorrection = false;
    let sawMethod = false;
    let sawReplicates = false;
    let sawSeed = false;
    if (pack.exercise.bootstrap === null) {
      throw new Error("the pack must set bootstrap.replicates and .seed");
    }
    const boot = pack.exercise.bootstrap;
    expect(boot.replicates).toBe(fx.replicates); // 100, seqboot's R default
    expect(boot.seed).toBe(fx.seed); // the odd seed the chain used
    expect(boot.seed % 2).toBe(1);
    for (const row of pack.lab.settings) {
      if (row.neophylo.startsWith("Correction:")) {
        sawCorrection = true;
        expect(row.neophylo).toContain("F84");
        expect(pack.exercise.analysis.correction).toBe("F84");
      }
      if (row.neophylo.startsWith("Method:")) {
        sawMethod = true;
        expect(row.neophylo).toMatch(/Neighbor-Joining|NJ/);
        expect(pack.exercise.analysis.method).toBe("Nj");
      }
      if (row.neophylo.startsWith("Replicates:")) {
        sawReplicates = true;
        expect(row.neophylo).toContain(String(boot.replicates));
      }
      if (row.neophylo.startsWith("Seed:")) {
        sawSeed = true;
        expect(row.neophylo).toContain(String(boot.seed));
      }
    }
    expect(sawCorrection, "a settings row must name the Correction control").toBe(true);
    expect(sawMethod, "a settings row must name the Method control").toBe(true);
    expect(sawReplicates, "a settings row must name the Replicates control").toBe(true);
    expect(sawSeed, "a settings row must name the Seed control").toBe(true);
  });

  it("reproduces dnadist's printed F84 matrix within its precision", () => {
    const aln = packAlignment(pack.exercise);
    const r = engine.distances(aln, "F84");
    if (!r.ok) throw new Error(`distances failed: ${JSON.stringify(r.error)}`);
    const got = r.value;
    expect(got.labels).toEqual(fx.labels);
    const n = fx.labels.length;
    const tol = 0.5 * Math.pow(10, -fxFull.precision); // 6 decimals → 0.5e-6
    const want = fxFull.distances.F84;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cell = got.cells[i * n + j];
        expect(cell === "Saturated" ? Infinity : Math.abs(cell.Value - want[i][j]),
          `cell ${fx.labels[i]}/${fx.labels[j]}`).toBeLessThanOrEqual(tol);
      }
    }
  });

  it("NJ on PHYLIP's printed F84 matrix gives nj.F84's splits and lengths", () => {
    const got = nj(printedMatrix(fxFull, "F84", "F84"));
    const want = parse(fxFull.nj.F84);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed: ${JSON.stringify(r.error)}`);
    expect(r.value.rf).toBe(0);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    // neighbor's outtree prints 5 decimals → 0.5e-5.
    const tol = 0.5 * Math.pow(10, -fx.tree_precision);
    gl.forEach((g, k) =>
      expect(Math.abs(g - wl[k]), `branch length ${k}`).toBeLessThanOrEqual(tol));
  });

  it("NJ on the engine's own F84 matrix gives the same splits and lengths", () => {
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "F84");
    if (!dm.ok) throw new Error(`distances failed`);
    const got = nj(dm.value);
    const want = parse(fxFull.nj.F84);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed`);
    expect(r.value.rf).toBe(0);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    const tol = 0.5e-5;
    gl.forEach((g, k) =>
      expect(Math.abs(g - wl[k]), `branch length ${k}`).toBeLessThanOrEqual(tol));
  });

  it("the tally of PHYLIP's own replicate trees is consense's whole set inventory", () => {
    // The engine-convention tally over neighbor's 100 outtrees must
    // hold exactly the groupings consense reports: every "Sets
    // included" row plus every "Sets NOT included" row (extended is
    // the only run that lists rejected sets — strict and majority
    // print "NONE"), each with the same count. This is where NeoPhylo
    // exposes the not_included counts: the tally the consensus tabs
    // draw from.
    const got = new Map(
      phylipTally.counts.map((c) => [c.labels.join("|"), c.count]),
    );
    const want = new Map<string, number>();
    for (const g of [
      ...fx.consense.extended.groups,
      ...fx.consense.extended.not_included,
    ]) {
      want.set([...g.labels].sort().join("|"), g.count);
    }
    expect(got.size).toBe(want.size);
    for (const [key, count] of want) {
      expect(got.get(key), `grouping ${key}`).toBe(count);
    }
  });

  it.each(["Strict", "Majority", "Extended"] as const)(
    "engine consensus of PHYLIP's replicate trees equals consense %s",
    (kind: ConsensusKind) => {
      // The plan's pack-3 assertion: NeoPhylo's consensus computed
      // from PHYLIP's own 100 replicate trees equals consense for
      // strict, majority and extended — the same groupings with the
      // same counts.
      const r = engine.consensus(phylipTally, kind, fx.labels);
      if (!r.ok) throw new Error(`consensus failed: ${JSON.stringify(r.error)}`);
      const got = consensusGroupings(r.value, phylipTally.successful)
        .map((g) => `${g.count}:${g.key}`)
        .sort();
      const key =
        kind === "Strict" ? "strict" : kind === "Majority" ? "majority" : "extended";
      const want = fx.consense[key].groups
        .map((g) => `${g.count}:${[...g.labels].sort().join("|")}`)
        .sort();
      expect(got).toEqual(want);
    },
  );

  it("NeoPhylo's own bootstrap majority-rule groupings equal consense's", () => {
    // The lab's own run — the exercise's bootstrap block (the chain's
    // odd seed, 100 replicates) through the engine exactly as the app
    // runs it. A different RNG draws different resamples, so the counts
    // honestly differ; what is pinned is the SET of majority-rule
    // groupings, which must equal consense's majority "Sets included".
    if (pack.exercise.bootstrap === null) throw new Error("unreachable");
    const aln = packAlignment(pack.exercise);
    const r = engine.bootstrapBatch(
      aln,
      "F84",
      "Nj",
      pack.exercise.bootstrap.seed,
      0,
      pack.exercise.bootstrap.replicates,
    );
    if (!r.ok) throw new Error(`bootstrap failed: ${JSON.stringify(r.error)}`);
    const cr = engine.consensus(r.value, "Majority", r.value.labels);
    if (!cr.ok) throw new Error(`consensus failed`);
    const got = new Set(
      consensusGroupings(cr.value, r.value.successful).map((g) => g.key),
    );
    const want = new Set(
      fx.consense.majority.groups.map((g) => [...g.labels].sort().join("|")),
    );
    expect(got).toEqual(want);
  });

  it("pins the prompts' teaching claims to the computed trace, matrix and tally", () => {
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "F84");
    if (!dm.ok) throw new Error(`distances failed`);

    // Closest pair in the engine's own matrix — the tempting first pick.
    let best = { d: Infinity, i: -1, j: -1 };
    const labels = dm.value.labels;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const c = dm.value.cells[i * labels.length + j];
        if (c !== "Saturated" && c.Value < best.d) {
          best = { d: c.Value, i, j };
        }
      }
    }
    expect([labels[best.i], labels[best.j]].sort()).toEqual(["t01", "t02"]);

    // First join of the engine's NJ trace on PHYLIP's printed matrix —
    // the pair the predict_pair reveal names.
    const tr = engine.buildTree(printedMatrix(fxFull, "F84", "F84"), "Nj", {
      trace: true,
    });
    if (!tr.ok) throw new Error(`buildTree failed`);
    const trace = tr.value.trace;
    if (trace === null || !("Nj" in trace)) {
      throw new Error("NJ trace missing");
    }
    const first = trace.Nj.steps[0];
    const pair = [first.chosen[0], first.chosen[1]]
      .map((pos) => dm.value.labels[first.active[pos]])
      .sort();
    expect(pair).toEqual(["t11", "t12"]);

    // The predict_branch reveal names the least-supported internal
    // branch of the inferred tree in the lab's own run, and claims it
    // is the same grouping PHYLIP's chain found weakest — the
    // minimum-count row of consense's majority "Sets included", read
    // from the fixture rather than hard-coded. The whole original
    // tree's groupings must sit in the tally so support lands on real
    // branches.
    if (pack.exercise.bootstrap === null) throw new Error("unreachable");
    const ownTree = nj(dm.value);
    const own = engine.bootstrapBatch(
      aln,
      "F84",
      "Nj",
      pack.exercise.bootstrap.seed,
      0,
      pack.exercise.bootstrap.replicates,
    );
    if (!own.ok) throw new Error(`bootstrap failed`);
    const st = engine.supportOnTree(ownTree, own.value);
    if (!st.ok) throw new Error(`supportOnTree failed`);
    const keys = splitKeys(st.value, fx.labels, false);
    let weakest = { support: Infinity, key: "" };
    for (let i = 0; i < st.value.nodes.length; i++) {
      const node = st.value.nodes[i];
      const s = st.value.branches[i].support;
      if (i !== st.value.root && node.children.length > 0 && s !== null) {
        if (s < weakest.support) {
          weakest = { support: s, key: keys.get(i) ?? "" };
        }
      }
    }
    const phylipWeakest = fx.consense.majority.groups.reduce((a, g) =>
      g.count < a.count ? g : a,
    );
    expect(weakest.key).toBe([...phylipWeakest.labels].sort().join("|"));
  });
});

/* ---- v1.4b Task 13 handout 1: MEGA "JC69 vs K2P" (spec §7.1) ---- */

/** A fixtures/mega/library/*.json oracle — the Task 2 shape run on a
 * library dataset (Task 9). `matrix` cells are numbers or null (MEGA's
 * `n/c`); `trees` are MEGA's output Newicks. */
interface MegaFixture {
  precision: { distances: number; branch_lengths: number };
  input: string;
  distances: Record<
    string,
    { labels: string[]; matrix: (number | null)[][] }
  >;
  trees: Record<string, string>;
  /** Task 9's 100-replicate blocks: the support MEGA printed on the
   * original NJ tree, keyed by canonical split (the handout values —
   * only their split SETS are asserted; the counts are one unseeded
   * run's, owner ruling on #126). Absent on inputs Task 9 did not
   * bootstrap. */
  bootstrap?: Record<
    string,
    { replicates: number; support: Record<string, number> }
  >;
}

function loadMegaFixture(name: string): MegaFixture {
  const text = readFileSync(
    resolve(FIXTURES, "mega", "library", `${name}.json`),
    "utf8",
  );
  return JSON.parse(text) as MegaFixture;
}

/** One .mao file's `key = value` pairs — the GUI serialization the
 * generator validated (fixtures/worked/mega-notes.md). Keys are
 * trimmed of the fixed-width padding MEGA writes. */
function maoSettings(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([^=;]+?)\s*=\s*(.+?)\s*$/.exec(line);
    if (m !== null) out.set(m[1], m[2]);
  }
  return out;
}

/** The union of a family of .mao files' settings: key → every value
 * any file in the family declares (Model/Method legitimately differs
 * between the JC69 and K2P files). */
function maoUnion(paths: string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of paths) {
    for (const [k, v] of maoSettings(p)) {
      const set = out.get(k) ?? new Set<string>();
      set.add(v);
      out.set(k, set);
    }
  }
  return out;
}

/** One .mao file's `key = value` pairs inside a single `[section]` —
 * the AnalysisSettings block is the analysis dialog's serialization,
 * the section the handout's "nothing is left to a default" claim is
 * about (fix round 1). */
function maoSection(path: string, section: string): Map<string, string> {
  const out = new Map<string, string>();
  let inside = false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sec !== null) {
      inside = sec[1].trim() === section;
      continue;
    }
    if (!inside) continue;
    const m = /^([^=;]+?)\s*=\s*(.+?)\s*$/.exec(line);
    if (m !== null) out.set(m[1], m[2]);
  }
  return out;
}

/** Lengths printed in a Newick, sorted, each with its decimal count —
 * MEGA trims trailing zeros, so the tolerance is per value (the
 * fixtures/mega README rule + the floating-point floor
 * parity_mega_library.rs uses). */
function printedLengths(newick: string): { v: number; d: number }[] {
  const out: { v: number; d: number }[] = [];
  for (const m of newick.matchAll(/:([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?\d+)?)/g)) {
    const frac = /\.(\d+)/.exec(m[1]);
    out.push({ v: Number(m[1]), d: frac === null ? 0 : frac[1].length });
  }
  return out.sort((a, b) => a.v - b.v);
}

function lenTol(value: number, decimals: number): number {
  return Math.max(
    0.5 * Math.pow(10, -decimals),
    8 * Number.EPSILON * Math.max(1, Math.abs(value)),
  );
}

/** `run` is e.g. "JC69/pairwise": model name / filter kind. */
function megaDistances(
  aln: Alignment,
  model: DistModel,
  filter: SiteFilter,
): DistanceMatrix {
  const r = engine.distancesFiltered(aln, model, filter);
  if (!r.ok) throw new Error(`distancesFiltered failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("lab pack mega-jc69-vs-k2p", () => {
  const loaded = loadLab("mega-jc69-vs-k2p");
  if (!loaded.ok) throw new Error(`pack must load: ${JSON.stringify(loaded.error)}`);
  const pack = loaded.value;
  const fx = loadMegaFixture("primate-mtdna");
  // The library FASTA the pack embeds — read from the shipped file.
  const libraryText = readFileSync(
    resolve("..", "web/public/library/primate-mtdna.fasta"),
    "utf8",
  );
  const DIST_MAOS = [
    resolve(FIXTURES, "mega", "mao", "dist_dna_jc69_pairwise.mao"),
    resolve(FIXTURES, "mega", "mao", "dist_dna_k2p_pairwise.mao"),
  ];
  const NJ_MAOS = [
    resolve(FIXTURES, "mega", "mao", "nj_dna_jc69_pairwise.mao"),
    resolve(FIXTURES, "mega", "mao", "nj_dna_k2p_pairwise.mao"),
  ];

  it("loads through loadLab and its lab block validates", () => {
    expect(pack.lab.id).toBe("mega-jc69-vs-k2p");
    if (pack.lab.tool !== "mega") throw new Error("the pack is a MEGA lab");
    expect(pack.exercise.schema_version).toBe(4);
    expect(pack.exercise.alphabet).toBe("dna");
    // The lab's starting run is JC69; the handout's step switches K80 in.
    expect(pack.exercise.analysis.correction).toBe("Jc69");
    expect(pack.exercise.analysis.method).toBe("Nj");
    // One gap treatment for the handout's runs (conductor note):
    // pairwise deletion, MEGA's own default.
    expect(pack.exercise.analysis.site_filter).toEqual({ kind: "pairwise" });
    expect(pack.exercise.data.kind).toBe("embedded");
    expect(pack.lab.minutes).toBeGreaterThanOrEqual(5);
    expect(pack.lab.minutes).toBeLessThanOrEqual(180);
    expect(pack.lab.settings.length).toBeGreaterThan(0);
    expect(pack.lab.objectives.length).toBeGreaterThan(0);
  });

  it("embeds web/public/library/primate-mtdna.fasta byte for byte (names and residues)", () => {
    if (pack.exercise.data.kind !== "embedded") throw new Error("unreachable");
    const embedded = fastaRecords(pack.exercise.data.fasta);
    const committed = fastaRecords(libraryText);
    expect(embedded).toEqual(committed);
    expect(embedded.length).toBe(7);
    expect(embedded.map(([name]) => name)).toEqual(
      fx.distances["JC69/pairwise"].labels,
    );
    for (const [, seq] of embedded) expect(seq.length).toBe(1138);
  });

  it("every settings-table row cites a setting the named .mao run declares", () => {
    // spec §7.1: "its settings table matches the .mao settings it
    // cites". Rows carry `mega_setting` as "<.mao key>: <.mao value>";
    // the menu cell names which run family the row belongs to —
    // distance rows are checked against the two dist_*_pairwise .mao
    // files, Phylogeny rows against the two nj_*_pairwise files.
    const dist = maoUnion(DIST_MAOS);
    const nj = maoUnion(NJ_MAOS);
    let sawDist = 0;
    let sawNj = 0;
    for (const row of pack.lab.settings) {
      if (!("mega_setting" in row)) throw new Error("not a MEGA row");
      const split = /:\s/.exec(row.mega_setting);
      if (split === null) {
        throw new Error(`mega_setting "${row.mega_setting}" is not "Key: Value"`);
      }
      const key = row.mega_setting.slice(0, split.index);
      const value = row.mega_setting.slice(split.index + 2).trim();
      const family = /distance/i.test(row.mega_menu) ? dist : nj;
      if (/distance/i.test(row.mega_menu)) sawDist++;
      else sawNj++;
      const values = family.get(key);
      expect(
        values !== undefined && values.has(value),
        `row "${row.option}" cites ${key}: ${value} — not in the .mao family`,
      ).toBe(true);
    }
    expect(sawDist).toBeGreaterThan(0);
    expect(sawNj).toBeGreaterThan(0);
  });

  it("the model rows name the two runs' models exactly as the .mao files do", () => {
    // The handout's two runs are JC69 then K2P; each row's mega_setting
    // must equal the cited .mao's Model/Method, not just any family
    // value — so a swapped or drifted model row fails.
    const jc69Mao = maoSettings(DIST_MAOS[0]);
    const k2pMao = maoSettings(DIST_MAOS[1]);
    const rows = pack.lab.settings.filter(
      (r): r is Extract<typeof r, { mega_setting: string }> =>
        "mega_setting" in r && /model\/method/i.test(r.mega_setting),
    );
    const jc69Row = rows.find((r) => /JC69/.test(r.neophylo));
    const k2pRow = rows.find((r) => /K80/.test(r.neophylo));
    expect(jc69Row?.mega_setting).toBe(
      `Model/Method: ${jc69Mao.get("Model/Method")}`,
    );
    expect(k2pRow?.mega_setting).toBe(
      `Model/Method: ${k2pMao.get("Model/Method")}`,
    );
    // MEGA's "Kimura 2-parameter" is NeoPhylo's K80 — never K2P_PHYLIP.
    expect(k2pMao.get("Model/Method")).toBe("Kimura 2-parameter model");
    expect(k2pRow?.neophylo).toContain("K80");
  });

  it("settings-table rows naming a NeoPhylo control agree with the exercise", () => {
    let sawMethod = false;
    let sawFilter = false;
    const corrections = new Set<string>();
    for (const row of pack.lab.settings) {
      if (row.neophylo.startsWith("Correction:")) {
        // Only the two runs' models may appear — run 1's JC69 (the
        // model the lab loads) and run 2's K80.
        const m = /^Correction: (\S+)/.exec(row.neophylo);
        if (m === null) {
          throw new Error(`bad Correction row "${row.neophylo}"`);
        }
        corrections.add(m[1]);
      }
      if (row.neophylo.startsWith("Method:")) {
        sawMethod = true;
        expect(row.neophylo).toMatch(/Neighbor-Joining|NJ/);
        expect(pack.exercise.analysis.method).toBe("Nj");
      }
      if (row.neophylo.startsWith("Gap treatment:")) {
        sawFilter = true;
        expect(row.neophylo).toMatch(/Pairwise/i);
        expect(pack.exercise.analysis.site_filter).toEqual({
          kind: "pairwise",
        });
      }
    }
    expect(corrections, "Correction rows name the two runs' models").toEqual(
      new Set(["JC69", "K80"]),
    );
    // The loaded run is JC69; the handout's step 4 switches K80 in.
    expect(pack.exercise.analysis.correction).toBe("Jc69");
    expect(sawMethod, "a settings row must name the Method control").toBe(true);
    expect(sawFilter, "a settings row must name the Gap treatment control").toBe(true);
  });

  it("lists every option the .mao runs set — nothing is left to a default", () => {
    // The handout's claim, pinned against the .mao files' own
    // [AnalysisSettings] sections (the analysis dialog's
    // serialization): every option of both run families must appear
    // as a row of its own menu family. The only keys the table never
    // lists are MEGA's section separators (serialized "Key = ====")
    // and the execution-time cap — a runtime limit, not an analysis
    // option (fix round 1: the NJ run's Scope/Rates/Substitutions
    // rows were missing).
    const SKIP = new Set(["Has Time Limit", "Maximum Execution Time"]);
    const missing: string[] = [];
    for (const [menuRe, maos] of [
      [/distance/i, DIST_MAOS],
      [/phylogeny/i, NJ_MAOS],
    ] as const) {
      const rows = pack.lab.settings.filter(
        (r) => "mega_setting" in r && menuRe.test(r.mega_menu),
      );
      for (const mao of maos) {
        for (const [key, value] of maoSection(mao, "AnalysisSettings")) {
          if (SKIP.has(key) || /^=+$/.test(value)) continue;
          if (
            !rows.some(
              (r) =>
                "mega_setting" in r && r.mega_setting.startsWith(`${key}:`),
            )
          ) {
            missing.push(`${key} (${mao.split("/").pop()})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(["JC69", "K80"] as const)(
    "reproduces MEGA's printed %s matrix within its precision",
    (model) => {
      const aln = packAlignment(pack.exercise);
      const got = megaDistances(aln, model === "JC69" ? "Jc69" : "K80", {
        kind: "pairwise",
      });
      const want = fx.distances[`${model}/pairwise`];
      expect(got.labels).toEqual(want.labels);
      const n = want.labels.length;
      const tol = 0.5 * Math.pow(10, -fx.precision.distances); // 8 decimals → 0.5e-8
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const w = want.matrix[i][j];
          const cell = got.cells[i * n + j];
          expect(
            w === null
              ? cell === "Saturated"
              : cell !== "Saturated" && Math.abs(cell.Value - w) <= tol,
            `cell ${want.labels[i]}/${want.labels[j]}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(["JC69", "K80"] as const)(
    "NJ on MEGA's printed %s matrix gives the fixture tree's splits",
    (model) => {
      // Topology only (parity_mega_library.rs check_printed_topology):
      // the fixture trees were computed at full precision, so the
      // 8-decimal matrix rounding propagates ~1e-9 into lengths.
      const run = fx.distances[`${model}/pairwise`];
      const cells: Cell[] = [];
      for (const row of run.matrix) {
        for (const v of row) {
          if (v === null) throw new Error("tree over a matrix with n/c cells");
          cells.push({ Value: v });
        }
      }
      const got = nj({ labels: run.labels, model: model === "JC69" ? "Jc69" : "K80", cells });
      const want = parse(fx.trees[`nj/${model}/pairwise`]);
      const r = engine.compare(want, got);
      if (!r.ok) throw new Error(`compare failed: ${JSON.stringify(r.error)}`);
      expect(r.value.rf).toBe(0);
    },
  );

  it.each(["JC69", "K80"] as const)(
    "NJ on the engine's own %s matrix gives the fixture tree's splits and lengths",
    (model) => {
      // Full parity on the engine's own matrix (parity_mega_library.rs
      // check_tree): every split, then every branch length within half
      // an ulp of each printed value's own decimals (MEGA trims
      // trailing zeros) + the fp floor.
      const aln = packAlignment(pack.exercise);
      const dm = megaDistances(aln, model === "JC69" ? "Jc69" : "K80", {
        kind: "pairwise",
      });
      const got = nj(dm);
      const want = parse(fx.trees[`nj/${model}/pairwise`]);
      const r = engine.compare(want, got);
      if (!r.ok) throw new Error("compare failed");
      expect(r.value.rf).toBe(0);
      const wl = printedLengths(fx.trees[`nj/${model}/pairwise`]);
      const gl = branchLengths(got);
      expect(gl.length).toBe(wl.length);
      gl.forEach((g, k) =>
        expect(
          Math.abs(g - wl[k].v),
          `branch length ${k}`,
        ).toBeLessThanOrEqual(lenTol(wl[k].v, wl[k].d)),
      );
    },
  );

  it("the two models' NJ trees have the same splits, as the handout says", () => {
    // The handout's step 5 claim is read off the fixtures, never
    // hard-coded: both runs' trees carry the same split set.
    const a = parse(fx.trees["nj/JC69/pairwise"]);
    const b = parse(fx.trees["nj/K80/pairwise"]);
    const r = engine.compare(a, b);
    if (!r.ok) throw new Error("compare failed");
    expect(r.value.rf).toBe(0);
    // And its "the model moves every distance" premise: every K80
    // cell ≥ its JC69 cell on this transition-heavy data.
    const jc = fx.distances["JC69/pairwise"].matrix;
    const k8 = fx.distances["K80/pairwise"].matrix;
    for (let i = 0; i < jc.length; i++) {
      for (let j = 0; j < jc[i].length; j++) {
        if (jc[i][j] !== null && k8[i][j] !== null) {
          expect(k8[i][j]).toBeGreaterThanOrEqual(jc[i][j]!);
        }
      }
    }
  });

  it.each([
    { kind: "pairwise" },
    { kind: "complete" },
    { kind: "partial", cutoff_pct: 95 },
  ] as SiteFilter[])(
    "pins the prompts' claims under $kind deletion too",
    (filter) => {
      // The predict_pair reveal names the orangutan pair as the first
      // join and the chimp–bonobo pair as the matrix's closest. Both
      // are read off the engine on the pack's alignment under every
      // gap treatment the sandbox offers, so the claim stays true if
      // the student switches it (the handout's last question asks
      // exactly that).
      const aln = packAlignment(pack.exercise);
      for (const model of ["Jc69", "K80"] as const) {
        const dm = megaDistances(aln, model, filter);
        let best = { d: Infinity, i: -1, j: -1 };
        const labels = dm.labels;
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const c = dm.cells[i * labels.length + j];
            if (c !== "Saturated" && c.Value < best.d) {
              best = { d: c.Value, i, j };
            }
          }
        }
        expect(
          [labels[best.i], labels[best.j]].sort(),
          `closest pair under ${model}/${filter.kind}`,
        ).toEqual(["Pan_paniscus", "Pan_troglodytes"]);

        const tr = engine.buildTree(dm, "Nj", { trace: true });
        if (!tr.ok) throw new Error("buildTree failed");
        const trace = tr.value.trace;
        if (trace === null || !("Nj" in trace)) {
          throw new Error("NJ trace missing");
        }
        const first = trace.Nj.steps[0];
        const pair = [first.chosen[0], first.chosen[1]]
          .map((pos) => labels[first.active[pos]])
          .sort();
        expect(pair, `first join under ${model}/${filter.kind}`).toEqual([
          "Pongo_abelii",
          "Pongo_pygmaeus",
        ]);
      }
    },
  );

  it("the first join on MEGA's printed matrix is the orangutan pair", () => {
    // The reveal's other claim: NJ replays the same first join on the
    // exact printed matrix MEGA's tree run consumed.
    const run = fx.distances["JC69/pairwise"];
    const cells: Cell[] = run.matrix
      .flat()
      .map((v) => {
        if (v === null) throw new Error("n/c cell");
        return { Value: v };
      });
    const tr = engine.buildTree(
      { labels: run.labels, model: "Jc69", cells },
      "Nj",
      { trace: true },
    );
    if (!tr.ok) throw new Error("buildTree failed");
    const trace = tr.value.trace;
    if (trace === null || !("Nj" in trace)) throw new Error("NJ trace missing");
    const first = trace.Nj.steps[0];
    const pair = [first.chosen[0], first.chosen[1]]
      .map((pos) => run.labels[first.active[pos]])
      .sort();
    expect(pair).toEqual(["Pongo_abelii", "Pongo_pygmaeus"]);
  });

  it("the prompt texts never state the K80 result before the student runs it", () => {
    // Every prompt fires during the handout's JC69 half — none may
    // answer step 5's split comparison or the first discussion
    // question ("did the model change every distance?") before the
    // student runs K80 (fix round 1).
    const text = pack.exercise.prompts
      .map((p) => [p.concept, p.math ?? "", p.reveal ?? ""].join("\n"))
      .join("\n");
    for (const phrase of ["same splits", "come back", "every distance"]) {
      expect(text, `prompt text must not contain "${phrase}"`).not.toContain(
        phrase,
      );
    }
  });

  it.each([
    { kind: "pairwise" },
    { kind: "complete" },
    { kind: "partial", cutoff_pct: 95 },
  ] as SiteFilter[])(
    "the closing note names each of the JC69 tree's four splits ($kind)",
    (filter) => {
      // The step-5 note must describe the tree the student just read:
      // every non-trivial split in words, with no rooting implication
      // ("outside", "outgroup" — the gibbon sits inside the
      // orangutan-side grouping, it is not an outlier). The split set
      // is computed from the engine's own JC69 NJ tree under every
      // gap treatment the sandbox offers — the same four splits on
      // all of them — never hard-coded. Each split is named by its
      // smaller side so the pinned phrase reads the same whichever
      // side the canonical key picked.
      const aln = packAlignment(pack.exercise);
      const note = pack.exercise.prompts.find((p) => p.at_step === 5);
      if (note === undefined) {
        throw new Error("the lab must carry the step-5 closing note");
      }
      const PHRASES: Record<string, string> = {
        "Pan_paniscus|Pan_troglodytes": "the two chimpanzees together",
        "Homo_sapiens|Pan_paniscus|Pan_troglodytes":
          "human joined with the chimpanzees",
        "Pongo_abelii|Pongo_pygmaeus": "the two orangutans together",
        "Hylobates_lar|Pongo_abelii|Pongo_pygmaeus":
          "the orangutans with the gibbon",
      };
      const dm = megaDistances(aln, "Jc69", filter);
      const keys = treeGroupingKeys(nj(dm), dm.labels);
      expect(keys.size, "the JC69 NJ tree has four splits").toBe(4);
      for (const key of keys) {
        const side = key.split("|");
        const comp = dm.labels.filter((l) => !side.includes(l));
        const compKey = [...comp].sort().join("|");
        const canon =
          side.length < comp.length
            ? key
            : comp.length < side.length
              ? compKey
              : [key, compKey].sort()[0];
        const phrase = PHRASES[canon];
        expect(
          phrase,
          `no phrase pinned for split ${canon}`,
        ).not.toBeUndefined();
        expect(
          note.concept,
          `the note must describe split ${canon}`,
        ).toContain(phrase);
      }
      expect(note.concept).not.toMatch(/outgroup|outside/i);
    },
  );

  it("never implies MEGA's own example file prints these numbers", () => {
    // Conductor rule (per-task note): the dataset is the D-loop
    // region of the Horai accessions, not MEGA's bundled mtDNA file —
    // the handout must not claim its numbers reproduce by opening that
    // file. The token never appears.
    const text = `${pack.lab.handout_md}\n${"mega_note_md" in pack.lab ? pack.lab.mega_note_md : ""}`;
    expect(text).not.toMatch(/mtCDNA/i);
  });
});

function upgma(m: DistanceMatrix): Tree {
  const r = engine.buildTree(m, "Upgma", { trace: false });
  if (!r.ok) throw new Error(`buildTree failed: ${JSON.stringify(r.error)}`);
  return r.value.tree;
}

/** One edge in a printed Newick: the (sorted) clade below it, the
 * length and its decimal count — MEGA trims trailing zeros, so the
 * per-value tolerance reads the decimals off the text. Port of
 * parity_mega_library.rs NwkScan. */
interface NwkEdge {
  clade: string[];
  len: number;
  dec: number;
}

function nwkEdges(text: string): NwkEdge[] {
  const edges: NwkEdge[] = [];
  let pos = 0;
  const ws = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };
  const subtree = (): string[] => {
    ws();
    let leaves: string[];
    if (text[pos] === "(") {
      pos++;
      leaves = [];
      for (;;) {
        leaves = leaves.concat(subtree());
        ws();
        const c = text[pos];
        if (c === ",") pos++;
        else if (c === ")") {
          pos++;
          break;
        } else throw new Error(`expected ',' or ')' at ${pos}`);
      }
      // Optional internal label (ignored): skip to ':' ',' ')' ';'.
      while (pos < text.length && !":[,);".includes(text[pos])) pos++;
    } else {
      const start = pos;
      while (pos < text.length && !":[,);".includes(text[pos])) pos++;
      leaves = [text.slice(start, pos).trim()];
    }
    if (pos < text.length && text[pos] === ":") {
      pos++;
      const start = pos;
      while (pos < text.length && /[0-9.+\-eE]/.test(text[pos])) pos++;
      const tok = text.slice(start, pos);
      const dot = tok.indexOf(".");
      const dec =
        dot === -1 ? 0 : (tok.slice(dot + 1).match(/^\d+/)?.[0].length ?? 0);
      leaves.sort();
      edges.push({ clade: leaves.slice(), len: Number(tok), dec });
    }
    return leaves;
  };
  subtree();
  return edges;
}

/** A rooted tree's clade → printed edge length map (UPGMA fixture
 * trees), keyed by the sorted leaf set below each edge. The root
 * carries no edge, as in parity_mega_library.rs edge_map(rooted). */
function rootedEdgeMap(nwk: string): Map<string, NwkEdge> {
  const out = new Map<string, NwkEdge>();
  for (const e of nwkEdges(nwk)) out.set(e.clade.join("|"), e);
  return out;
}

/** The same clade → length map for an engine tree: each non-root
 * node's leaf set against its branch length. */
function rootedCladeMap(t: Tree): Map<string, number> {
  const sets = leafSetsOf(t);
  const out = new Map<string, number>();
  for (let id = 0; id < t.nodes.length; id++) {
    if (id === t.root) continue;
    const len = t.branches[id].length;
    if (len === null) throw new Error("an edge carries no length");
    out.set([...(sets.get(id) ?? [])].sort().join("|"), len);
  }
  return out;
}

function sameKeys(a: Map<string, unknown>, b: Map<string, unknown>): boolean {
  return a.size === b.size && [...a.keys()].every((k) => b.has(k));
}

/** One merge in a fixture's rooted UPGMA newick: the clade it forms,
 * its two child edges and the node's printed height above the leaves
 * (the mean of the two child derivations — the replay re-derives each
 * side). Port of parity_mega_library.rs MegaMerge. */
interface MegaMerge {
  clade: string[];
  children: [NwkEdge, NwkEdge];
  height: number;
}

/** Decompose a rooted UPGMA newick into its merge sequence, ordered by
 * increasing height then clade size (port of mega_merges). */
function megaMerges(ctx: string, nwk: string, allLabels: string[]): MegaMerge[] {
  const edgeMap = rootedEdgeMap(nwk);
  const clades = [...edgeMap.values()].map((e) => e.clade);
  const root = [...allLabels].sort();
  const internals = clades.filter((c) => c.length >= 2);
  internals.push(root);
  const uniq = [
    ...new Map(internals.map((c) => [c.join("|"), c])).values(),
  ];
  uniq.sort((a, b) => a.length - b.length);
  const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));
  const heightOf = new Map<string, number>();
  const merges: MegaMerge[] = [];
  for (const s of uniq) {
    // Children = the maximal proper sub-clades among the edge clades
    // (a child may be a single leaf).
    const children = clades.filter(
      (c) =>
        c.length < s.length &&
        subset(c, s) &&
        !clades.some(
          (o) =>
            o.length < s.length &&
            c.length < o.length &&
            subset(c, o) &&
            subset(o, s),
        ),
    );
    if (children.length !== 2) {
      throw new Error(
        `${ctx}: clade ${s} has ${children.length} children (want a binary rooted tree)`,
      );
    }
    const deriv = children.map(
      (c) => (heightOf.get(c.join("|")) ?? 0) + edgeMap.get(c.join("|"))!.len,
    );
    const height = (deriv[0] + deriv[1]) / 2;
    heightOf.set(s.join("|"), height);
    merges.push({
      clade: s,
      children: [
        edgeMap.get(children[0].join("|"))!,
        edgeMap.get(children[1].join("|"))!,
      ],
      height,
    });
  }
  merges.sort(
    (a, b) => a.height - b.height || a.clade.length - b.clade.length,
  );
  return merges;
}

/** Replay MEGA's printed UPGMA tree on the engine's full-precision
 * matrix (parity_mega_library.rs replay_mega_upgma, owner ruling on
 * #126): at every merge MEGA's pair must be *a* minimum-distance pair
 * — exact `===`, the ties are exact rationals like 17/142 — and each
 * cluster's height must equal half that distance within `lenTol`.
 * Throws on the first broken step; returns whether the replay saw a
 * step with more than one minimal pair (a mismatch without a tie
 * stays a failure). */
function replayMegaUpgma(ctx: string, nwk: string, ours: DistanceMatrix): boolean {
  const merges = megaMerges(ctx, nwk, ours.labels);
  const n = ours.labels.length;
  let d = ours.cells.map((c) => {
    if (c === "Saturated") throw new Error(`${ctx}: tree over an n/c cell`);
    return c.Value;
  });
  let members: string[][] = ours.labels.map((l) => [l]);
  let sizes = new Array<number>(n).fill(1);
  const heights = new Map<string, number>();
  let sawTie = false;
  for (const m of merges) {
    const k = members.length;
    const find = (c: string[]) =>
      members.findIndex((x) => x.join("|") === c.join("|"));
    const ci = find(m.children[0].clade);
    const cj = find(m.children[1].clade);
    if (ci === -1 || cj === -1 || ci === cj) {
      throw new Error(`${ctx}: a child of ${m.clade} is not an active cluster`);
    }
    let best = Infinity;
    let minimal = 0;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const v = d[i * k + j];
        if (v < best) {
          best = v;
          minimal = 1;
        } else if (v === best) minimal++;
      }
    }
    const dij = d[ci * k + cj];
    if (dij !== best) {
      throw new Error(
        `${ctx}: MEGA merges ${m.children[0].clade} + ${m.children[1].clade} at distance ${dij} but the step minimum is ${best} — not a tie resolution`,
      );
    }
    sawTie ||= minimal > 1;
    const h = best / 2;
    for (const child of m.children) {
      const hVia = (heights.get(child.clade.join("|")) ?? 0) + child.len;
      const tol = lenTol(hVia, child.dec);
      if (Math.abs(hVia - h) > tol) {
        throw new Error(
          `${ctx}: cluster ${m.clade} height ${hVia} vs half the merge distance ${h} (tol ${tol})`,
        );
      }
    }
    heights.set(m.clade.join("|"), m.height);
    // Agglomerate exactly like algos/upgma.rs (size-weighted means,
    // remaining clusters keep their order, the new one last).
    const remaining = [...Array(k).keys()].filter((x) => x !== ci && x !== cj);
    const [si, sj] = [sizes[ci], sizes[cj]];
    const newRow = remaining.map(
      (x) => (si * d[ci * k + x] + sj * d[cj * k + x]) / (si + sj),
    );
    const nk = k - 1;
    const nd = new Array<number>(nk * nk).fill(0);
    remaining.forEach((a, x) => {
      remaining.forEach((b, y) => {
        nd[x * nk + y] = d[a * k + b];
      });
      nd[x * nk + nk - 1] = newRow[x];
      nd[(nk - 1) * nk + x] = newRow[x];
    });
    d = nd;
    const union = [...members[ci], ...members[cj]].sort();
    if (union.join("|") !== m.clade.join("|")) {
      throw new Error(`${ctx}: MEGA clade ${m.clade} is not the union of its children`);
    }
    members = [...remaining.map((x) => members[x]), union];
    sizes = [...remaining.map((x) => sizes[x]), si + sj];
  }
  if (members.length !== 1) {
    throw new Error(`${ctx}: replay left ${members.length} clusters after all merges`);
  }
  return sawTie;
}

/** The exact UPGMA comparison (parity_mega_library.rs
 * upgma_match_kind's exact arm): rooted-clade topology on MEGA's
 * printed matrix, then topology plus every branch length on the
 * engine's own matrix within per-value lenTol. Throws on failure so
 * the tie-aware replay can run. */
function upgmaExactMatch(
  ctx: string,
  nwk: string,
  megaDm: DistanceMatrix,
  ours: DistanceMatrix,
): void {
  const exp = rootedEdgeMap(nwk);
  const printed = rootedCladeMap(upgma(megaDm));
  if (!sameKeys(exp, printed)) {
    throw new Error(`${ctx}: printed-matrix topology differs`);
  }
  const act = rootedCladeMap(upgma(ours));
  if (!sameKeys(exp, act)) {
    throw new Error(`${ctx}: topology differs from MEGA`);
  }
  for (const [clade, e] of exp) {
    const g = act.get(clade)!;
    const tol = lenTol(e.len, e.dec);
    if (Math.abs(g - e.len) > tol) {
      throw new Error(`${ctx}: clade ${clade} length ${g} vs MEGA ${e.len} (tol ${tol})`);
    }
  }
}

/** A fixture run's printed matrix as a DistanceMatrix (panics on n/c
 * cells — tree fixtures only exist for complete matrices). */
function megaPrintedMatrix(
  run: { labels: string[]; matrix: (number | null)[][] },
  model: DistModel,
): DistanceMatrix {
  const cells: Cell[] = [];
  for (const row of run.matrix) {
    for (const v of row) {
      if (v === null) throw new Error("tree over a matrix with n/c cells");
      cells.push({ Value: v });
    }
  }
  return { labels: run.labels, model, cells };
}

describe("lab pack mega-nj-vs-upgma", () => {
  const loaded = loadLab("mega-nj-vs-upgma");
  if (!loaded.ok) throw new Error(`pack must load: ${JSON.stringify(loaded.error)}`);
  const pack = loaded.value;
  const fx = loadMegaFixture("globins");
  // The library FASTA the pack embeds — read from the shipped file.
  const libraryText = readFileSync(
    resolve("..", "web/public/library/globins.fasta"),
    "utf8",
  );
  const DIST_MAOS = [
    resolve(FIXTURES, "mega", "mao", "dist_protein_poisson_pairwise.mao"),
  ];
  const NJ_MAOS = [
    resolve(FIXTURES, "mega", "mao", "nj_protein_poisson_pairwise.mao"),
  ];
  const UPGMA_MAOS = [
    resolve(FIXTURES, "mega", "mao", "upgma_protein_poisson_pairwise.mao"),
  ];

  it("loads through loadLab and its lab block validates", () => {
    expect(pack.lab.id).toBe("mega-nj-vs-upgma");
    if (pack.lab.tool !== "mega") throw new Error("the pack is a MEGA lab");
    expect(pack.exercise.schema_version).toBe(4);
    expect(pack.exercise.alphabet).toBe("protein");
    // The lab's starting run is NJ (the handout's first tree); the
    // handout's step 4 switches the Method control to UPGMA.
    expect(pack.exercise.analysis.correction).toBe("Poisson");
    expect(pack.exercise.analysis.method).toBe("Nj");
    // One gap treatment for the handout's runs (conductor note):
    // pairwise deletion, MEGA's own default.
    expect(pack.exercise.analysis.site_filter).toEqual({ kind: "pairwise" });
    expect(pack.exercise.data.kind).toBe("embedded");
    expect(pack.lab.minutes).toBeGreaterThanOrEqual(5);
    expect(pack.lab.minutes).toBeLessThanOrEqual(180);
    expect(pack.lab.settings.length).toBeGreaterThan(0);
    expect(pack.lab.objectives.length).toBeGreaterThan(0);
  });

  it("embeds web/public/library/globins.fasta byte for byte (names and residues)", () => {
    if (pack.exercise.data.kind !== "embedded") throw new Error("unreachable");
    const embedded = fastaRecords(pack.exercise.data.fasta);
    const committed = fastaRecords(libraryText);
    expect(embedded).toEqual(committed);
    expect(embedded.length).toBe(23);
    expect(embedded.map(([name]) => name)).toEqual(
      fx.distances["Poisson/pairwise"].labels,
    );
    for (const [, seq] of embedded) expect(seq.length).toBe(156);
  });

  it("every settings-table row cites a setting the named .mao run declares", () => {
    // spec §7.1: the rows' mega_setting is "<.mao key>: <.mao value>";
    // mega_menu names the run family — distance rows are checked
    // against the dist .mao, "UPGMA" menu rows against the UPGMA .mao,
    // the remaining Phylogeny rows against the NJ .mao.
    const dist = maoUnion(DIST_MAOS);
    const nj = maoUnion(NJ_MAOS);
    const upgma = maoUnion(UPGMA_MAOS);
    const saw = { dist: 0, nj: 0, upgma: 0 };
    for (const row of pack.lab.settings) {
      if (!("mega_setting" in row)) throw new Error("not a MEGA row");
      const split = /:\s/.exec(row.mega_setting);
      if (split === null) {
        throw new Error(`mega_setting "${row.mega_setting}" is not "Key: Value"`);
      }
      const key = row.mega_setting.slice(0, split.index);
      const value = row.mega_setting.slice(split.index + 2).trim();
      const [family, name] = /distance/i.test(row.mega_menu)
        ? ([dist, "dist"] as const)
        : /upgma/i.test(row.mega_menu)
          ? ([upgma, "upgma"] as const)
          : ([nj, "nj"] as const);
      saw[name]++;
      const values = family.get(key);
      expect(
        values !== undefined && values.has(value),
        `row "${row.option}" cites ${key}: ${value} — not in the .mao family`,
      ).toBe(true);
    }
    expect(saw.dist).toBeGreaterThan(0);
    expect(saw.nj).toBeGreaterThan(0);
    expect(saw.upgma).toBeGreaterThan(0);
  });

  it("the model and method rows name the three runs' settings exactly as the .mao files do", () => {
    // One distance run and two tree runs; each tree family's
    // Statistical Method row must equal its own .mao's value, and the
    // model rows the Poisson model's.
    const njMao = maoSettings(NJ_MAOS[0]);
    const upgmaMao = maoSettings(UPGMA_MAOS[0]);
    const rows = pack.lab.settings.filter(
      (r): r is Extract<typeof r, { mega_setting: string }> =>
        "mega_setting" in r,
    );
    const methodRows = rows.filter((r) =>
      /statistical method/i.test(r.mega_setting),
    );
    const njRow = methodRows.find((r) => /upgma/i.test(r.mega_menu) === false);
    const upgmaRow = methodRows.find((r) => /upgma/i.test(r.mega_menu));
    expect(njRow?.mega_setting).toBe(
      `Statistical Method: ${njMao.get("Statistical Method")}`,
    );
    expect(upgmaRow?.mega_setting).toBe(
      `Statistical Method: ${upgmaMao.get("Statistical Method")}`,
    );
    expect(njMao.get("Statistical Method")).toBe("Neighbor-joining");
    expect(upgmaMao.get("Statistical Method")).toBe("UPGMA");
    // Every Model/Method row cites the Poisson model — the handout's
    // one distance model for all three runs.
    const modelRows = rows.filter((r) => /model\/method/i.test(r.mega_setting));
    expect(modelRows.length).toBeGreaterThan(0);
    for (const r of modelRows) {
      expect(r.mega_setting).toBe("Model/Method: Poisson model");
    }
  });

  it("settings-table rows naming a NeoPhylo control agree with the exercise", () => {
    const corrections = new Set<string>();
    const methods = new Set<string>();
    let sawFilter = false;
    for (const row of pack.lab.settings) {
      if (row.neophylo.startsWith("Correction:")) {
        const m = /^Correction: (\S+)/.exec(row.neophylo);
        if (m === null) {
          throw new Error(`bad Correction row "${row.neophylo}"`);
        }
        corrections.add(m[1]);
      }
      if (row.neophylo.startsWith("Method:")) {
        const m = /^Method: (\S+)/.exec(row.neophylo);
        if (m === null) throw new Error(`bad Method row "${row.neophylo}"`);
        methods.add(m[1]);
      }
      if (row.neophylo.startsWith("Gap treatment:")) {
        sawFilter = true;
        expect(row.neophylo).toMatch(/Pairwise/i);
        expect(pack.exercise.analysis.site_filter).toEqual({
          kind: "pairwise",
        });
      }
    }
    // The one distance model the three runs share.
    expect(corrections).toEqual(new Set(["Poisson"]));
    // Both tree methods appear; the lab loads NJ (the first run) and
    // the handout's step switches UPGMA in.
    expect(methods).toEqual(new Set(["NJ", "UPGMA"]));
    expect(pack.exercise.analysis.method).toBe("Nj");
    expect(sawFilter, "a settings row must name the Gap treatment control").toBe(true);
  });

  it("lists every option the .mao runs set — nothing is left to a default", () => {
    // Same pin as handout 1: every non-administrative
    // [AnalysisSettings] key of each run family must appear as a row
    // of that menu family.
    const SKIP = new Set(["Has Time Limit", "Maximum Execution Time"]);
    const missing: string[] = [];
    for (const [menuRe, maos] of [
      [/distance/i, DIST_MAOS],
      [/upgma/i, UPGMA_MAOS],
      [/nj/i, NJ_MAOS],
    ] as const) {
      const rows = pack.lab.settings.filter(
        (r) => "mega_setting" in r && menuRe.test(r.mega_menu),
      );
      for (const mao of maos) {
        for (const [key, value] of maoSection(mao, "AnalysisSettings")) {
          if (SKIP.has(key) || /^=+$/.test(value)) continue;
          if (
            !rows.some(
              (r) =>
                "mega_setting" in r && r.mega_setting.startsWith(`${key}:`),
            )
          ) {
            missing.push(`${key} (${mao.split("/").pop()})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("reproduces MEGA's printed Poisson matrix within its precision", () => {
    const aln = packAlignment(pack.exercise);
    const got = megaDistances(aln, "Poisson", { kind: "pairwise" });
    const want = fx.distances["Poisson/pairwise"];
    expect(got.labels).toEqual(want.labels);
    const n = want.labels.length;
    const tol = 0.5 * Math.pow(10, -fx.precision.distances); // 8 decimals → 0.5e-8
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = want.matrix[i][j];
        const cell = got.cells[i * n + j];
        expect(
          w === null
            ? cell === "Saturated"
            : cell !== "Saturated" && Math.abs(cell.Value - w) <= tol,
          `cell ${want.labels[i]}/${want.labels[j]}`,
        ).toBe(true);
      }
    }
  });

  it("NJ on MEGA's printed Poisson matrix gives the fixture tree's splits", () => {
    // Topology only on the printed matrix (parity_mega_library.rs
    // check_printed_topology): the fixture trees were computed at full
    // precision, so the 8-decimal rounding propagates ~1e-9.
    const run = fx.distances["Poisson/pairwise"];
    const got = nj(megaPrintedMatrix(run, "Poisson"));
    const want = parse(fx.trees["nj/Poisson/pairwise"]);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error(`compare failed: ${JSON.stringify(r.error)}`);
    expect(r.value.rf).toBe(0);
  });

  it("NJ on the engine's own Poisson matrix gives the fixture tree's splits and lengths", () => {
    // Full parity on the engine's own matrix (parity_mega_library.rs
    // check_tree): NJ stays exact everywhere — every split, then every
    // branch length within per-value lenTol.
    const aln = packAlignment(pack.exercise);
    const dm = megaDistances(aln, "Poisson", { kind: "pairwise" });
    const got = nj(dm);
    const want = parse(fx.trees["nj/Poisson/pairwise"]);
    const r = engine.compare(want, got);
    if (!r.ok) throw new Error("compare failed");
    expect(r.value.rf).toBe(0);
    const wl = printedLengths(fx.trees["nj/Poisson/pairwise"]);
    const gl = branchLengths(got);
    expect(gl.length).toBe(wl.length);
    gl.forEach((g, k) =>
      expect(
        Math.abs(g - wl[k].v),
        `branch length ${k}`,
      ).toBeLessThanOrEqual(lenTol(wl[k].v, wl[k].d)),
    );
  });

  it("UPGMA on the engine's Poisson matrix is MEGA's tree through a real tie", () => {
    // The globins HBA tie (fixtures/worked/mega-notes.md "Ties in
    // globins"; parity_mega_library.rs upgma_tie_resolutions_are_exactly
    // pins this key as tie-aware): the exact comparison — printed-
    // matrix topology plus full parity on the engine's matrix — must
    // fail, and MEGA's tree must replay on the engine's matrix as a
    // valid UPGMA resolution through a step with more than one minimal
    // pair. A mismatch without a tie still fails.
    const ctx = "globins upgma/Poisson/pairwise";
    const run = fx.distances["Poisson/pairwise"];
    const aln = packAlignment(pack.exercise);
    const ours = megaDistances(aln, "Poisson", { kind: "pairwise" });
    const nwk = fx.trees["upgma/Poisson/pairwise"];
    const megaDm = megaPrintedMatrix(run, "Poisson");
    let exactError: unknown = undefined;
    try {
      upgmaExactMatch(ctx, nwk, megaDm, ours);
    } catch (e) {
      exactError = e;
    }
    expect(
      exactError,
      "the globins pairwise UPGMA run is pinned tie-aware — an exact match means the fixture's premise changed",
    ).not.toBeUndefined();
    expect(
      replayMegaUpgma(ctx, nwk, ours),
      "MEGA's tree must replay on the engine's matrix through a real tied step",
    ).toBe(true);
  });

  // Every correction the lab's protein menu offers the student (P,
  // Kimura and JTT always; Poisson here because the lab prescribes
  // it — CORRECTIONS.protein minus SANDBOX_MODELS, plus the
  // prescribed model as the conditional option) times every gap
  // treatment the Gap control offers. The prompts show at stepper
  // positions, not per run, so every scoped claim must hold under
  // each of these — and the loop pins the engine's answers so the
  // scoping can't rot.
  const PICKABLE_MODELS: DistModel[] = ["P", "Kimura", "Jtt", "Poisson"];
  const STUDENT_FILTERS: SiteFilter[] = [
    { kind: "pairwise" },
    { kind: "complete" },
    { kind: "partial", cutoff_pct: 95 },
  ];

  it.each(
    PICKABLE_MODELS.flatMap((model) =>
      STUDENT_FILTERS.map((filter) => ({ model, filter })),
    ),
  )(
    "the prompt's first-join claims hold under $model / $filter.kind",
    ({ model, filter }) => {
      // The predict_pair reveal's scoped claims, read off the engine
      // on the pack's alignment: the closest matrix pair is the
      // identical Human_HBB–Chimp_HBB under everything; NJ's first
      // join is Human_HBA–Horse_HBA under every model BUT JTT, where
      // the same Q rule opens Cow_HBA–Human_HBA; UPGMA's first merge
      // is the identical beta pair under everything.
      const aln = packAlignment(pack.exercise);
      const dm = megaDistances(aln, model, filter);
      const labels = dm.labels;
      let best = { d: Infinity, i: -1, j: -1 };
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const c = dm.cells[i * labels.length + j];
          if (c !== "Saturated" && c.Value < best.d) {
            best = { d: c.Value, i, j };
          }
        }
      }
      const run = `${typeof model === "string" ? model : "?"}/${filter.kind}`;
      expect(
        [labels[best.i], labels[best.j]].sort(),
        `closest pair under ${run}`,
      ).toEqual(["Chimp_HBB", "Human_HBB"]);

      const firstJoin = (method: "Nj" | "Upgma"): string[] => {
        const tr = engine.buildTree(dm, method, { trace: true });
        if (!tr.ok) throw new Error("buildTree failed");
        const trace = tr.value.trace;
        const first =
          trace === null
            ? null
            : "Nj" in trace
              ? trace.Nj.steps[0]
              : trace.Upgma.steps[0];
        if (first === null) throw new Error(`${method} trace missing`);
        return [first.chosen[0], first.chosen[1]]
          .map((pos) => labels[first.active[pos]])
          .sort();
      };
      expect(firstJoin("Nj"), `first NJ join under ${run}`).toEqual(
        model === "Jtt"
          ? ["Cow_HBA", "Human_HBA"]
          : ["Horse_HBA", "Human_HBA"],
      );
      expect(firstJoin("Upgma"), `first UPGMA merge under ${run}`).toEqual([
        "Chimp_HBB",
        "Human_HBB",
      ]);
    },
  );

  it("the reveal names each first join only inside its own run's scope", () => {
    // The prompt shows under whichever method, model and filter the
    // student has selected when it fires — every pair the reveal
    // names must sit in a sentence that names its own run, so the
    // text is true on screen under all of them (fix round 1: an
    // unscoped "joins first under Q" named the NJ pair while the
    // verdict line showed the UPGMA pair).
    const predict = pack.exercise.prompts.find(
      (p) => p.type === "predict_pair",
    );
    const reveal = predict?.reveal;
    if (reveal === null || reveal === undefined || reveal === "") {
      throw new Error("the lab must carry a predict_pair prompt with a reveal");
    }
    const sentences = reveal.split(/(?<=[.:;!?])\s+/);
    const scoped = (pair: RegExp, scope: RegExp, what: string): void => {
      const hit = sentences.find((s) => pair.test(s));
      expect(
        hit !== undefined && scope.test(hit),
        `the reveal's ${what} claim must sit in a sentence scoped to its run`,
      ).toBe(true);
    };
    scoped(/Human_HBA and Horse_HBA/, /NJ|Poisson/, "NJ first join");
    scoped(/Cow_HBA and Human_HBA/, /JTT/, "JTT divergence");
    scoped(/identical betas/, /UPGMA/, "UPGMA first merge");
  });

  it("the first join on MEGA's printed matrix is the alpha pair, as the reveal says", () => {
    // NJ replays the same first join on the exact printed matrix
    // MEGA's NJ run consumed; UPGMA replays the identical pair.
    const run = fx.distances["Poisson/pairwise"];
    const megaDm = megaPrintedMatrix(run, "Poisson");
    const tr = engine.buildTree(megaDm, "Nj", { trace: true });
    if (!tr.ok) throw new Error("buildTree failed");
    const trace = tr.value.trace;
    if (trace === null || !("Nj" in trace)) throw new Error("NJ trace missing");
    const first = trace.Nj.steps[0];
    const pair = [first.chosen[0], first.chosen[1]]
      .map((pos) => run.labels[first.active[pos]])
      .sort();
    expect(pair).toEqual(["Horse_HBA", "Human_HBA"]);

    const tr2 = engine.buildTree(megaDm, "Upgma", { trace: true });
    if (!tr2.ok) throw new Error("buildTree failed");
    const trace2 = tr2.value.trace;
    if (trace2 === null || !("Upgma" in trace2)) {
      throw new Error("UPGMA trace missing");
    }
    const firstU = trace2.Upgma.steps[0];
    const pairU = [firstU.chosen[0], firstU.chosen[1]]
      .map((pos) => run.labels[firstU.active[pos]])
      .sort();
    expect(pairU).toEqual(["Chimp_HBB", "Human_HBB"]);
  });

  // The step-21 note's named groupings, each mapped to the exact
  // split it names (fix round 1: every grouping named must be an
  // exact split — the ten mammalian betas exclude mouse and rat,
  // whose own pair is the next split out to make twelve). The pinned
  // phrase is the note's wording; the canonical key is the smaller
  // side either way it canonicalizes.
  const NOTE_PHRASES: Record<string, string> = {
    "Chicken_HBAA|Cow_HBA|Horse_HBA|Human_HBA|Mouse_HBA|Xenopus_HBA1":
      "the six alpha globins together",
    "Chimp_HBB|Cow_HBB|Dog_HBB|Gorilla_HBB|Horse_HBB|Human_HBB|Human_HBD|Pig_HBB|Rabbit_HBB|Sheep_HBB":
      "the ten mammalian beta globins together",
    "Chimp_HBB|Cow_HBB|Dog_HBB|Gorilla_HBB|Horse_HBB|Human_HBB|Human_HBD|Mouse_HBB1|Pig_HBB|Rabbit_HBB|Rat_HBB1|Sheep_HBB":
      "twelve mammalian betas",
    "Chimp_HBB|Human_HBB": "identical human–chimp betas",
    "Mouse_HBB1|Rat_HBB1": "mouse–rat pair",
    "Cow_HBB|Sheep_HBB": "cow–sheep pair",
  };

  it.each(
    PICKABLE_MODELS.flatMap((model) =>
      STUDENT_FILTERS.map((filter) => ({ model, filter })),
    ),
  )(
    "the closing note's groupings are exact splits of the NJ tree ($model/$filter.kind)",
    ({ model, filter }) => {
      const aln = packAlignment(pack.exercise);
      const note = pack.exercise.prompts.find((p) => p.at_step === 21);
      if (note === undefined) {
        throw new Error("the lab must carry the step-21 closing note");
      }
      const dm = megaDistances(aln, model, filter);
      const keys = treeGroupingKeys(nj(dm), dm.labels);
      for (const [split, phrase] of Object.entries(NOTE_PHRASES)) {
        const comp = dm.labels
          .filter((l) => !split.split("|").includes(l))
          .sort()
          .join("|");
        expect(
          keys.has(split) || keys.has(comp),
          `the NJ tree must contain the split behind "${phrase}"`,
        ).toBe(true);
        expect(
          note.concept,
          `the note must describe split ${split}`,
        ).toContain(phrase);
      }
      // The note names its run so it can't be misread after a method
      // switch — and never implies rooting ("unrooted" is wanted).
      expect(note.concept).toMatch(/NJ/);
      expect(note.concept).not.toMatch(/outgroup|outside|\brooted\b/i);
    },
  );

  it.each(STUDENT_FILTERS)(
    "the named groupings are exact splits of MEGA's printed NJ tree too ($kind)",
    (filter) => {
      // The same six groupings, read off the fixture trees — the
      // note's claims are MEGA's splits, not just the engine's.
      const note = pack.exercise.prompts.find((p) => p.at_step === 21);
      if (note === undefined) {
        throw new Error("the lab must carry the step-21 closing note");
      }
      const fname =
        filter.kind === "partial" ? `partial${filter.cutoff_pct}` : filter.kind;
      const run = fx.distances[`Poisson/${fname}`];
      const keys = treeGroupingKeys(
        parse(fx.trees[`nj/Poisson/${fname}`]),
        run.labels,
      );
      for (const [split, phrase] of Object.entries(NOTE_PHRASES)) {
        const comp = run.labels
          .filter((l) => !split.split("|").includes(l))
          .sort()
          .join("|");
        expect(
          keys.has(split) || keys.has(comp),
          `the fixture NJ tree must contain the split behind "${phrase}"`,
        ).toBe(true);
      }
    },
  );

  it("the prompt texts never state the UPGMA comparison before the student runs it", () => {
    // The prompts show at fixed stepper positions under whichever run
    // is on screen — none may answer step 5's "where do the two trees
    // disagree" before the student builds the UPGMA tree (the reveal
    // may set up the closest-pair contrast, never the outcome).
    const text = pack.exercise.prompts
      .map((p) => [p.concept, p.math ?? "", p.reveal ?? ""].join("\n"))
      .join("\n");
    for (const phrase of [
      "the same groupings",
      "disagree",
      "only inside",
      "identical trees",
    ]) {
      expect(text, `prompt text must not contain "${phrase}"`).not.toContain(
        phrase,
      );
    }
  });

  it("never claims the UPGMA trees are identical — where they match, it explains the tie", () => {
    // The globins UPGMA tie (per-task note): MEGA and NeoPhylo may
    // join a different one of the tied alpha pairs; both are valid
    // UPGMA trees. The handout and the MEGA note must explain the tie
    // where they discuss agreement, and never claim the trees match
    // exactly.
    const text = `${pack.lab.handout_md}\n${"mega_note_md" in pack.lab ? pack.lab.mega_note_md : ""}`;
    expect(text).toMatch(/tie/i);
    expect(text).not.toMatch(/identical (UPGMA )?trees/i);
    expect(text).not.toMatch(/the same UPGMA tree/i);
    expect(text).not.toMatch(/UPGMA trees? (are|is) (the same|identical)/i);
  });
});

/* ---- v1.4b Task 13 handout 3: MEGA "100 bootstrap replicates" (spec
 * §7.1) ---- */

describe("lab pack mega-bootstrap-100", () => {
  const loaded = loadLab("mega-bootstrap-100");
  if (!loaded.ok) throw new Error(`pack must load: ${JSON.stringify(loaded.error)}`);
  const pack = loaded.value;
  const fx = loadMegaFixture("16s-rrna");
  if (fx.bootstrap === undefined) {
    throw new Error("16s-rrna's fixture must carry the 100-replicate blocks");
  }
  const boot = fx.bootstrap;
  // The library FASTA the pack embeds — read from the shipped file.
  const libraryText = readFileSync(
    resolve("..", "web/public/library/16s-rrna.fasta"),
    "utf8",
  );
  const NJBOOT_MAOS = [
    resolve(FIXTURES, "mega", "mao", "njboot_dna_k2p_pairwise.mao"),
    resolve(FIXTURES, "mega", "mao", "njboot_dna_k2p_complete.mao"),
  ];
  // The handout's two runs — the gap treatment is the only option that
  // changes between them.
  const RUNS = ["pairwise", "complete"] as const;
  const RUN_FILTERS: Record<(typeof RUNS)[number], SiteFilter> = {
    pairwise: { kind: "pairwise" },
    complete: { kind: "complete" },
  };
  // Every correction the lab's DNA menu offers the student (P, JC69 and
  // K80 always — F84 and K2P_PHYLIP are sandbox-only models,
  // CORRECTIONS.dna minus SANDBOX_MODELS) times every gap treatment the
  // Gap control offers. Prompts show at stepper positions under
  // whichever of these is selected, so scoped claims are pinned under
  // all of them.
  const PICKABLE_MODELS: DistModel[] = ["P", "Jc69", "K80"];
  const STUDENT_FILTERS: SiteFilter[] = [
    { kind: "pairwise" },
    { kind: "complete" },
    { kind: "partial", cutoff_pct: 95 },
  ];

  it("loads through loadLab and its lab block validates", () => {
    expect(pack.lab.id).toBe("mega-bootstrap-100");
    if (pack.lab.tool !== "mega") throw new Error("the pack is a MEGA lab");
    expect(pack.exercise.schema_version).toBe(4);
    expect(pack.exercise.alphabet).toBe("dna");
    // The lab's run is MEGA's bootstrap NJ chain: K2P distances, NJ,
    // 100 replicates under pairwise deletion (MEGA's default gap
    // treatment); the handout's step switches complete deletion in.
    expect(pack.exercise.analysis.correction).toBe("K80");
    expect(pack.exercise.analysis.method).toBe("Nj");
    expect(pack.exercise.analysis.site_filter).toEqual({ kind: "pairwise" });
    expect(pack.exercise.data.kind).toBe("embedded");
    // The bootstrap block carries the cited .mao run's replicate count
    // and the seed MEGA does not offer (the settings table shows both).
    if (pack.exercise.bootstrap === null) {
      throw new Error("the pack must set bootstrap.replicates and .seed");
    }
    expect(pack.exercise.bootstrap.replicates).toBe(100);
    expect(Number.isInteger(pack.exercise.bootstrap.seed)).toBe(true);
    expect(pack.lab.minutes).toBeGreaterThanOrEqual(5);
    expect(pack.lab.minutes).toBeLessThanOrEqual(180);
    expect(pack.lab.settings.length).toBeGreaterThan(0);
    expect(pack.lab.objectives.length).toBeGreaterThan(0);
  });

  it("embeds web/public/library/16s-rrna.fasta byte for byte (names and residues)", () => {
    if (pack.exercise.data.kind !== "embedded") throw new Error("unreachable");
    const embedded = fastaRecords(pack.exercise.data.fasta);
    const committed = fastaRecords(libraryText);
    expect(embedded).toEqual(committed);
    expect(embedded.length).toBe(27);
    expect(embedded.map(([name]) => name)).toEqual(
      fx.distances["K80/pairwise"].labels,
    );
    for (const [, seq] of embedded) expect(seq.length).toBe(1628);
  });

  it("every settings-table row cites a setting the named .mao run declares", () => {
    // spec §7.1: "its settings table matches the .mao settings it
    // cites". Both runs share one menu path (Phylogeny → Construct/test
    // NJ tree), so every row's "Key: Value" must appear in the union of
    // the two njboot .mao files — the gap row legitimately cites both
    // values. The single exception is the seed row: MEGA's bootstrap
    // is unseeded (fixtures/worked/mega-notes.md), so it carries no
    // ".mao key" and must say so.
    const union = maoUnion(NJBOOT_MAOS);
    let noMaoKey = 0;
    for (const row of pack.lab.settings) {
      if (!("mega_setting" in row)) throw new Error("not a MEGA row");
      const split = /:\s/.exec(row.mega_setting);
      if (split === null) {
        noMaoKey++;
        expect(row.mega_setting).toMatch(/no MEGA setting|unseeded|no seed/i);
        continue;
      }
      const key = row.mega_setting.slice(0, split.index);
      const value = row.mega_setting.slice(split.index + 2).trim();
      const values = union.get(key);
      expect(
        values !== undefined && values.has(value),
        `row "${row.option}" cites ${key}: ${value} — not in the .mao family`,
      ).toBe(true);
    }
    expect(noMaoKey, "only the seed row may lack a .mao setting").toBe(1);
  });

  it("the bootstrap and model rows name the runs' settings exactly as the .mao files do", () => {
    // The two runs differ only in Gaps/Missing Data — every other run
    // option is shared, so each row must equal the .mao value verbatim.
    const mao = maoSettings(NJBOOT_MAOS[0]);
    const rows = pack.lab.settings.filter(
      (r): r is Extract<typeof r, { mega_setting: string }> =>
        "mega_setting" in r,
    );
    for (const key of [
      "Analysis",
      "Scope",
      "Statistical Method",
      "Test of Phylogeny",
      "Approach",
      "Bootstrap Replicates",
      "Substitutions Type",
      "Model/Method",
      "Substitutions to Include",
      "Rates among Sites",
      "Pattern among Lineages",
    ]) {
      const row = rows.find((r) => r.mega_setting.startsWith(`${key}:`));
      expect(row, `a settings row cites ${key}`).not.toBeUndefined();
      expect(row?.mega_setting).toBe(`${key}: ${mao.get(key)}`);
    }
    // The bootstrap run is the lesson: its three keys bind exactly.
    expect(mao.get("Test of Phylogeny")).toBe("Bootstrap method");
    expect(mao.get("Approach")).toBe("Standard Bootstrap (slow)");
    expect(mao.get("Bootstrap Replicates")).toBe("100");
    expect(mao.get("Statistical Method")).toBe("Neighbor-joining");
    expect(mao.get("Model/Method")).toBe("Kimura 2-parameter model");
    // Both gap treatments the handout runs are cited as rows.
    const gapRows = rows.filter((r) =>
      /^Gaps\/Missing Data:/.test(r.mega_setting),
    );
    expect(gapRows.map((r) => r.mega_setting).sort()).toEqual([
      "Gaps/Missing Data: Complete deletion",
      "Gaps/Missing Data: Pairwise deletion",
    ]);
    // And the fixture blocks are the 100-replicate runs the rows cite.
    expect(boot["nj/K80/pairwise"].replicates).toBe(100);
    expect(boot["nj/K80/complete"].replicates).toBe(100);
  });

  it("settings-table rows naming a NeoPhylo control agree with the exercise", () => {
    const corrections = new Set<string>();
    const gaps: string[] = [];
    let sawMethod = false;
    let sawReplicates = false;
    let sawSeed = false;
    if (pack.exercise.bootstrap === null) throw new Error("unreachable");
    const exerciseBoot = pack.exercise.bootstrap;
    for (const row of pack.lab.settings) {
      if (row.neophylo.startsWith("Correction:")) {
        const m = /^Correction: (\S+)/.exec(row.neophylo);
        if (m === null) {
          throw new Error(`bad Correction row "${row.neophylo}"`);
        }
        corrections.add(m[1]);
      }
      if (row.neophylo.startsWith("Method:")) {
        sawMethod = true;
        expect(row.neophylo).toMatch(/Neighbor-Joining|NJ/);
        expect(pack.exercise.analysis.method).toBe("Nj");
      }
      if (row.neophylo.startsWith("Gap treatment:")) {
        gaps.push(row.neophylo);
      }
      if (row.neophylo.startsWith("Replicates:")) {
        sawReplicates = true;
        expect(row.neophylo).toContain(String(exerciseBoot.replicates));
      }
      if (row.neophylo.startsWith("Seed:")) {
        sawSeed = true;
        expect(row.neophylo).toContain(String(exerciseBoot.seed));
      }
    }
    // One model for both runs: MEGA's "Kimura 2-parameter" is K80.
    expect(corrections).toEqual(new Set(["K80"]));
    expect(pack.exercise.analysis.correction).toBe("K80");
    // Both gap treatments the handout switches between.
    expect(gaps.join("\n")).toMatch(/Pairwise/i);
    expect(gaps.join("\n")).toMatch(/Complete/i);
    expect(exerciseBoot.replicates).toBe(100);
    expect(sawMethod, "a settings row must name the Method control").toBe(true);
    expect(sawReplicates, "a settings row must name the Replicates control").toBe(true);
    expect(sawSeed, "a settings row must name the Seed control").toBe(true);
  });

  it("lists every option the .mao runs set — nothing is left to a default", () => {
    // Same pin as handouts 1–2: every non-administrative
    // [AnalysisSettings] key of each cited .mao appears as a row.
    const SKIP = new Set(["Has Time Limit", "Maximum Execution Time"]);
    const missing: string[] = [];
    for (const mao of NJBOOT_MAOS) {
      for (const [key, value] of maoSection(mao, "AnalysisSettings")) {
        if (SKIP.has(key) || /^=+$/.test(value)) continue;
        if (
          !pack.lab.settings.some(
            (r) =>
              "mega_setting" in r && r.mega_setting.startsWith(`${key}:`),
          )
        ) {
          missing.push(`${key} (${mao.split("/").pop()})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(RUNS)(
    "reproduces MEGA's printed K80 matrix under %s deletion within its precision",
    (filter) => {
      const aln = packAlignment(pack.exercise);
      const got = megaDistances(aln, "K80", RUN_FILTERS[filter]);
      const want = fx.distances[`K80/${filter}`];
      expect(got.labels).toEqual(want.labels);
      const n = want.labels.length;
      const tol = 0.5 * Math.pow(10, -fx.precision.distances); // 8 decimals → 0.5e-8
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const w = want.matrix[i][j];
          const cell = got.cells[i * n + j];
          expect(
            w === null
              ? cell === "Saturated"
              : cell !== "Saturated" && Math.abs(cell.Value - w) <= tol,
            `cell ${want.labels[i]}/${want.labels[j]}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(RUNS)(
    "NJ on MEGA's printed K80 matrix under %s gives the fixture tree's splits",
    (filter) => {
      // Topology only (parity_mega_library.rs check_printed_topology):
      // the fixture trees were computed at full precision, so the
      // 8-decimal matrix rounding propagates ~1e-9 into lengths.
      const run = fx.distances[`K80/${filter}`];
      const got = nj(megaPrintedMatrix(run, "K80"));
      const want = parse(fx.trees[`nj/K80/${filter}`]);
      const r = engine.compare(want, got);
      if (!r.ok) throw new Error(`compare failed: ${JSON.stringify(r.error)}`);
      expect(r.value.rf).toBe(0);
    },
  );

  it.each(RUNS)(
    "NJ on the engine's own K80 matrix under %s gives the fixture tree's splits and lengths",
    (filter) => {
      // Full parity on the engine's own matrix (parity_mega_library.rs
      // check_tree): every split, then every branch length within
      // per-value lenTol.
      const aln = packAlignment(pack.exercise);
      const dm = megaDistances(aln, "K80", RUN_FILTERS[filter]);
      const got = nj(dm);
      const want = parse(fx.trees[`nj/K80/${filter}`]);
      const r = engine.compare(want, got);
      if (!r.ok) throw new Error("compare failed");
      expect(r.value.rf).toBe(0);
      const wl = printedLengths(fx.trees[`nj/K80/${filter}`]);
      const gl = branchLengths(got);
      expect(gl.length).toBe(wl.length);
      gl.forEach((g, k) =>
        expect(
          Math.abs(g - wl[k].v),
          `branch length ${k}`,
        ).toBeLessThanOrEqual(lenTol(wl[k].v, wl[k].d)),
      );
    },
  );

  it.each(RUNS)(
    "the engine's NJ splits under %s are exactly the splits MEGA's 100-replicate run labelled",
    (filter) => {
      // The bootstrap-support rule (owner ruling on #126,
      // docs/decisions.md "v1.4b Task 9 Step 3"): MEGA's bootstrap is
      // unseeded, so only the SPLIT SETS are asserted — the engine's
      // NJ splits under the lab's filter equal the fixture's bootstrap
      // support keys equal the fixture tree's splits. The 100-replicate
      // support NUMBERS are never compared to NeoPhylo's.
      const run = boot[`nj/K80/${filter}`];
      const aln = packAlignment(pack.exercise);
      const dm = megaDistances(aln, "K80", RUN_FILTERS[filter]);
      const ourKeys = treeGroupingKeys(nj(dm), dm.labels);
      const megaKeys = new Set(Object.keys(run.support));
      expect(ourKeys).toEqual(megaKeys);
      const treeKeys = treeGroupingKeys(
        parse(fx.trees[`nj/K80/${filter}`]),
        dm.labels,
      );
      expect(treeKeys).toEqual(megaKeys);
    },
  );

  it("the two filters' NJ trees share one split set on this data, as the handout asks about", () => {
    // Scoped to the lab's K80 run — under the other pickable models
    // the split sets legitimately differ (verified), so the handout
    // poses this as a question about its own runs. MEGA's two trees
    // are the same split set, and so are the engine's.
    const fixturePairwise = treeGroupingKeys(
      parse(fx.trees["nj/K80/pairwise"]),
      fx.distances["K80/pairwise"].labels,
    );
    const fixtureComplete = treeGroupingKeys(
      parse(fx.trees["nj/K80/complete"]),
      fx.distances["K80/complete"].labels,
    );
    expect(fixturePairwise).toEqual(fixtureComplete);
    // The two bootstrap blocks label that same set.
    expect(new Set(Object.keys(boot["nj/K80/pairwise"].support))).toEqual(
      fixturePairwise,
    );
    expect(new Set(Object.keys(boot["nj/K80/complete"].support))).toEqual(
      fixturePairwise,
    );
    const aln = packAlignment(pack.exercise);
    const ourPairwise = treeGroupingKeys(
      nj(megaDistances(aln, "K80", { kind: "pairwise" })),
      aln.labels,
    );
    const ourComplete = treeGroupingKeys(
      nj(megaDistances(aln, "K80", { kind: "complete" })),
      aln.labels,
    );
    expect(ourPairwise).toEqual(ourComplete);
    expect(ourPairwise).toEqual(fixturePairwise);
  });

  it("several supports move a lot between the two recorded runs — the handout's premise", () => {
    // Same tree, different counts: on the shared split set, several of
    // MEGA's 100-replicate supports differ by 20+ points between the
    // gap treatments. Fixture-only — these are MEGA's own two recorded
    // unseeded runs, never compared against NeoPhylo's numbers.
    const pw = boot["nj/K80/pairwise"].support;
    const cp = boot["nj/K80/complete"].support;
    expect(Object.keys(pw).sort()).toEqual(Object.keys(cp).sort());
    let moved = 0;
    let maxDiff = 0;
    for (const k of Object.keys(pw)) {
      const d = Math.abs(pw[k] - cp[k]);
      if (d >= 20) moved++;
      if (d > maxDiff) maxDiff = d;
    }
    expect(moved, "the premise needs several supports moving 20+ points").toBeGreaterThanOrEqual(5);
    expect(maxDiff).toBeGreaterThanOrEqual(50);
  });

  it.each(
    PICKABLE_MODELS.flatMap((model) =>
      STUDENT_FILTERS.map((filter) => ({ model, filter })),
    ),
  )(
    "the prompt's closest-pair and first-join claims hold under $model/$filter.kind",
    ({ model, filter }) => {
      // The predict_pair reveal names Escherichia_coli +
      // Salmonella_enterica — the two enteric bacteria — as both the
      // matrix's closest pair and the first join, under NJ AND UPGMA.
      // Read off the engine on the pack's alignment under every model
      // and gap treatment the student can pick.
      const aln = packAlignment(pack.exercise);
      const dm = megaDistances(aln, model, filter);
      const labels = dm.labels;
      let best = { d: Infinity, i: -1, j: -1 };
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const c = dm.cells[i * labels.length + j];
          if (c !== "Saturated" && c.Value < best.d) {
            best = { d: c.Value, i, j };
          }
        }
      }
      const run = `${typeof model === "string" ? model : "?"}/${filter.kind}`;
      expect(
        [labels[best.i], labels[best.j]].sort(),
        `closest pair under ${run}`,
      ).toEqual(["Escherichia_coli", "Salmonella_enterica"]);

      const firstJoin = (method: "Nj" | "Upgma"): string[] => {
        const tr = engine.buildTree(dm, method, { trace: true });
        if (!tr.ok) throw new Error("buildTree failed");
        const trace = tr.value.trace;
        const first =
          trace === null
            ? null
            : "Nj" in trace
              ? trace.Nj.steps[0]
              : trace.Upgma.steps[0];
        if (first === null) throw new Error(`${method} trace missing`);
        return [first.chosen[0], first.chosen[1]]
          .map((pos) => labels[first.active[pos]])
          .sort();
      };
      expect(firstJoin("Nj"), `first NJ join under ${run}`).toEqual([
        "Escherichia_coli",
        "Salmonella_enterica",
      ]);
      expect(firstJoin("Upgma"), `first UPGMA merge under ${run}`).toEqual([
        "Escherichia_coli",
        "Salmonella_enterica",
      ]);
    },
  );

  it.each(RUNS)(
    "the first join on MEGA's printed K80 matrix under %s is the enteric pair",
    (filter) => {
      // The reveal's claim replays on the exact printed matrix MEGA's
      // tree run consumed.
      const run = fx.distances[`K80/${filter}`];
      const megaDm = megaPrintedMatrix(run, "K80");
      const tr = engine.buildTree(megaDm, "Nj", { trace: true });
      if (!tr.ok) throw new Error("buildTree failed");
      const trace = tr.value.trace;
      if (trace === null || !("Nj" in trace)) throw new Error("NJ trace missing");
      const first = trace.Nj.steps[0];
      const pair = [first.chosen[0], first.chosen[1]]
        .map((pos) => run.labels[first.active[pos]])
        .sort();
      expect(pair).toEqual(["Escherichia_coli", "Salmonella_enterica"]);
    },
  );

  // The step-25 note's named groupings (at_step 25 = the finished NJ
  // tree's position on a 27-taxon run — n − 2), each mapped to the
  // exact split it names. Every one is an exact split of the engine's
  // NJ tree under every pickable model × filter AND of the fixture NJ
  // trees, so the note stays true under anything the student selects.
  const NOTE_PHRASES: Record<string, string> = {
    "Escherichia_coli|Salmonella_enterica": "the two enteric bacteria together",
    "Mycoplasmoides_pneumoniae|Spiroplasma_citri": "the two mollicutes together",
    "Nostoc_coriaceum|Synechococcus_elongatus": "the two cyanobacteria",
    "Deinococcus_radiodurans|Thermus_aquaticus": "the Deinococcus–Thermus pair",
    "Bacillus_subtilis|Staphylococcus_aureus": "Bacillus–Staphylococcus",
    "Agrobacterium_tumefaciens|Caulobacter_vibrioides|Rickettsia_prowazekii":
      "alphaproteobacterial triple",
  };

  it.each(
    PICKABLE_MODELS.flatMap((model) =>
      STUDENT_FILTERS.map((filter) => ({ model, filter })),
    ),
  )(
    "the closing note's groupings are exact splits of the NJ tree ($model/$filter.kind)",
    ({ model, filter }) => {
      const aln = packAlignment(pack.exercise);
      const note = pack.exercise.prompts.find((p) => p.at_step === 25);
      if (note === undefined) {
        throw new Error("the lab must carry the step-25 closing note");
      }
      const dm = megaDistances(aln, model, filter);
      const keys = treeGroupingKeys(nj(dm), dm.labels);
      for (const [split, phrase] of Object.entries(NOTE_PHRASES)) {
        const comp = dm.labels
          .filter((l) => !split.split("|").includes(l))
          .sort()
          .join("|");
        expect(
          keys.has(split) || keys.has(comp),
          `the NJ tree must contain the split behind "${phrase}"`,
        ).toBe(true);
        expect(
          note.concept,
          `the note must describe split ${split}`,
        ).toContain(phrase);
      }
      // The note names its run and never implies rooting.
      expect(note.concept).toMatch(/NJ/);
      expect(note.concept).not.toMatch(/outgroup|outside|\brooted\b/i);
    },
  );

  it.each(["pairwise", "complete", "partial95"] as const)(
    "the named groupings are exact splits of MEGA's printed NJ tree too (%s)",
    (filter) => {
      const run = fx.distances[`K80/${filter}`];
      const keys = treeGroupingKeys(
        parse(fx.trees[`nj/K80/${filter}`]),
        run.labels,
      );
      for (const [split, phrase] of Object.entries(NOTE_PHRASES)) {
        const comp = run.labels
          .filter((l) => !split.split("|").includes(l))
          .sort()
          .join("|");
        expect(
          keys.has(split) || keys.has(comp),
          `the fixture NJ tree must contain the split behind "${phrase}"`,
        ).toBe(true);
      }
    },
  );

  it("the prompt texts never state the pairwise-vs-complete outcome before the student runs it", () => {
    // Step 6's comparison — did the tree change, which support moved
    // most — stays the student's to make: no prompt may answer it, and
    // no prompt may quote a support value.
    const text = pack.exercise.prompts
      .map((p) => [p.concept, p.math ?? "", p.reveal ?? ""].join("\n"))
      .join("\n");
    for (const phrase of [
      "the same splits",
      "same split set",
      "identical splits",
      "moves most",
      "moved most",
    ]) {
      expect(text, `prompt text must not contain "${phrase}"`).not.toContain(
        phrase,
      );
    }
    expect(text).not.toMatch(/\b\d{1,3}\s*(?:%|percent|of (?:the )?100\b)/);
  });

  it("support is never a probability — the disclaimer survives and no positive reading does", () => {
    // Review rule (spec §7.4): the texts may only say support is NOT a
    // probability. Strip the negated forms; anything left that reads
    // "probability", "chance" or "confidence" is a failure.
    const text = `${pack.lab.handout_md}\n${"mega_note_md" in pack.lab ? pack.lab.mega_note_md : ""}\n${pack.exercise.prompts
      .map((p) => [p.concept, p.math ?? "", p.reveal ?? ""].join("\n"))
      .join("\n")}`;
    expect(text).toMatch(/never a probability/i);
    const stripped = text.replace(/never a probability[^.\n]*/gi, "");
    expect(stripped).not.toMatch(/probabilit|confidence that|% chance/i);
  });

  it("says MEGA's bootstrap is unseeded and NeoPhylo's run is reproducible from the seed", () => {
    // The handout's core MEGA-vs-NeoPhylo fact (mega-notes.md "No seed
    // option"): stated where the student reads it, never implied by a
    // missing row.
    const text = `${pack.lab.handout_md}\n${"mega_note_md" in pack.lab ? pack.lab.mega_note_md : ""}`;
    expect(text).toMatch(/no seed|unseeded/i);
    expect(text).toMatch(/seed/i);
    // And it never states a MEGA support value as what the student
    // will see — the fixture values are one MEGA run's, attributed.
    expect(text).not.toMatch(/you will see \d|will show \d/i);
  });
});
