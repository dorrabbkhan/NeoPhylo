/// <reference types="node" />
// mathTex tests (plan Task 18, spec §6.2): the Math layer is KaTeX source
// built from the trace's own numbers, each formatted with toFixed(3) and
// trailing zeros trimmed (same precision as the heatmap cells). The
// Wikipedia 5-taxon NJ worked example is the
// oracle for the headline values (spec §4.5); a property test over the 5
// ref fixtures — each driven through the real engine — checks that every
// printed number is in that canonical form.
//
// Fixture files are read from disk: under jsdom import.meta.url is an http
// URL, so the path falls back to cwd-relative resolution (vitest runs in
// web/). Same pattern as state/names.test.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import katex from "katex";
import { describe, expect, it } from "vitest";

import { engine } from "../engine";
import type { Method } from "../engine/generated/Method";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";
import { nodeName } from "../state/names";
import { traceLength } from "../views/stepMatrix";

import { mathTex } from "./math";

/** Read a repo-root-relative file. Vitest runs with cwd = web/, so the
 * fixtures live at ../fixtures. (A dynamic new URL(..., import.meta.url)
 * would make Vite glob the repo root — resolved paths avoid that.) */
function readRepoFile(rel: string): string {
  return readFileSync(resolve(`../${rel}`), "utf8");
}

interface Worked {
  labels: string[];
  matrix: { n: number; data: number[] };
}

function build(labels: string[], data: number[], method: Method) {
  const r = engine.buildTree(
    { labels, model: "P", cells: data.map((v) => ({ Value: v })) },
    method,
    { trace: true },
  );
  if (!r.ok) throw new Error(`buildTree failed: ${JSON.stringify(r.error)}`);
  if (r.value.trace === null) throw new Error("expected a trace");
  return r.value as { tree: Tree; trace: Trace };
}

/** Node display names indexed by NodeId, as the panel passes them. */
function names(tree: Tree): string[] {
  return tree.nodes.map((_, id) => nodeName(tree, id));
}

const wiki = JSON.parse(
  readRepoFile("fixtures/worked/nj_wikipedia5.json"),
) as Worked;
const wikiBuilt = build(wiki.labels, wiki.matrix.data, "Nj");
const wikiTrace = wikiBuilt.trace;
const wikiNames = names(wikiBuilt.tree);

describe("mathTex (Wikipedia 5-taxon NJ)", () => {
  it("plugs the step's numbers into the R, Q, δ and d(u,k) lines", () => {
    const text = mathTex(wikiTrace, 0, wikiNames).join("\n");
    // Step 1 joins a and b: R_a = 31, R_b = 34, Q(a,b) = -50.
    expect(text).toContain("31");
    expect(text).toContain("34");
    expect(text).toContain("-50");
    // δ(a,u) = 2 and δ(b,u) = 3.
    expect(text).toContain("= 2");
    expect(text).toContain("= 3");
  });

  it("shows both equal Q values on a four-node tie step", () => {
    // Worked-example step 2 has tie: true with exactly 4 active nodes
    // (c, d, e, u1): complementary pairs always share the minimum Q.
    const lines = mathTex(wikiTrace, 1, wikiNames);
    const tie = lines.find((l) => l.includes("always equal at four nodes"));
    expect(tie).toBeDefined();
    // Chosen (0,3) = (c,u1); the complement (1,2) = (d,e); both Q = -28.
    expect(tie).toContain("Q(");
    expect(tie).toContain("= -28");
    // The generic notice is for ties with more than four active nodes.
    expect(lines).not.toContain("Tie: chosen by input order.");
  });

  it("shows the three-way join formulas at the final position", () => {
    const lines = mathTex(wikiTrace, 2, wikiNames); // steps.length = 2
    const text = lines.join("\n");
    // l_a = 2, l_b = 1, l_c = 2 for the last three clusters d, e, u2.
    expect(text).toContain("l_");
    expect(text).toContain("= 2");
    expect(text).toContain("= 1");
  });

  it("emits KaTeX-parseable lines (plain-text notices excepted)", () => {
    for (let k = 0; k < traceLength(wikiTrace); k++) {
      for (const line of mathTex(wikiTrace, k, wikiNames)) {
        if (!line.includes("=")) continue;
        expect(() => katex.renderToString(line)).not.toThrow();
      }
    }
  });
});

// The 5 ref fixtures (the *_phylip files are the same alignments imported
// via PHYLIP, so they are not counted separately).
const REFS = ["jc6", "jc7_long", "jc8_gaps", "jc12", "k80_10"];

/** The task's formatting rule, stated independently of the implementation. */
const canon = (v: number) => v.toFixed(3).replace(/\.?0+$/, "");
const NUM = /-?\d+(?:\.\d+)?/g;
// Labels render inside \text{...}; their digits are names, not values.
const TEXT_SPAN = /\\text\{[^}]*\}/g;

function tracesFor(ref: string): { trace: Trace; labels: string[] }[] {
  const meta = JSON.parse(readRepoFile(`fixtures/ref/${ref}.json`)) as {
    input: string;
  };
  const aln = engine.parseFasta(readRepoFile(`fixtures/${meta.input}`));
  if (!aln.ok) throw new Error(`parseFasta(${ref}) failed`);
  const out: { trace: Trace; labels: string[] }[] = [];
  for (const correction of ["P", "Jc69", "K80"] as const) {
    const dm = engine.distances(aln.value, correction);
    if (!dm.ok) continue; // e.g. a saturated JC69 matrix has no trace
    for (const method of ["Nj", "Upgma"] as const) {
      const b = engine.buildTree(dm.value, method, { trace: true });
      if (!b.ok || b.value.trace === null) continue;
      out.push({ trace: b.value.trace, labels: names(b.value.tree) });
    }
  }
  return out;
}

describe("mathTex number formatting (5 ref fixtures)", () => {
  it("prints every number as toFixed(3) with trailing zeros trimmed", () => {
    let stepsChecked = 0;
    for (const ref of REFS) {
      const traces = tracesFor(ref);
      expect(traces.length).toBeGreaterThan(0);
      for (const { trace, labels } of traces) {
        for (let k = 0; k < traceLength(trace); k++) {
          stepsChecked += 1;
          for (const line of mathTex(trace, k, labels)) {
            for (const tok of line.replace(TEXT_SPAN, "").match(NUM) ?? []) {
              expect(canon(Number(tok))).toBe(tok);
            }
          }
        }
      }
    }
    expect(stepsChecked).toBeGreaterThan(0);
  });
});

describe("mathTex tie notice", () => {
  it("keeps the generic line for ties with more than four actives", () => {
    // Hand-built 6-taxon matrix: all off-diagonal distances are 1, so
    // every pair ties on step 1 (6 active nodes > 4).
    const six = build(
      ["t1", "t2", "t3", "t4", "t5", "t6"],
      Array.from({ length: 36 }, (_, i) =>
        Math.floor(i / 6) === i % 6 ? 0 : 1,
      ),
      "Nj",
    );
    const labels = names(six.tree);
    const lines = mathTex(six.trace, 0, labels);
    expect(lines).toContain("Tie: chosen by input order.");
    expect(lines.some((l) => l.includes("always equal at four nodes"))).toBe(
      false,
    );
  });
});
