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
import type { DistModel } from "../engine/generated/DistModel";

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
  /** Decimals the distance program printed. */
  precision: number;
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
function loadProteinFixture(name: string): PhylipFixture {
  const text = readFileSync(
    resolve(FIXTURES, "ref", "protein", `${name}.json`),
    "utf8",
  );
  return JSON.parse(text) as PhylipFixture;
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
    // precision (5 decimals → 0.5e-5).
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
    // The fixture's own precision (4, the smallest decimal count
    // surviving the JSON round-trip; protdist prints 6) → 0.5e-4.
    const tol = 0.5 * Math.pow(10, -fx.precision);
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
    const tol = 0.5e-5; // neighbor's outtree prints 5 decimals
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
    // (5 decimals → 0.5e-5). Measured headroom: ~4.5e-6.
    const aln = packAlignment(pack.exercise);
    const dm = engine.distances(aln, "Jtt");
    if (!dm.ok) throw new Error(`distances failed`);
    const got = nj(dm.value);
    const want = parse(fx.nj.JTT);
    const gl = branchLengths(got);
    const wl = branchLengths(want);
    expect(gl.length).toBe(wl.length);
    const tol = 0.5e-5;
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
    expect(Math.abs(gotLen - wantLen)).toBeLessThanOrEqual(0.5e-5);
  });
});
