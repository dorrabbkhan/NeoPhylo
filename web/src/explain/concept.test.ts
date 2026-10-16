/// <reference types="node" />
// conceptText tests (plan Task 18, spec §6.2): the Concept layer is plain
// language built from the same trace record as the Math layer. The
// Wikipedia 5-taxon worked examples (NJ and UPGMA) are the oracle; both
// are driven through the real engine so NodeIds follow the engine
// convention (leaves in input order, then u1, u2, … via nodeName).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { engine } from "../engine";
import type { Method } from "../engine/generated/Method";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";
import { nodeName } from "../state/names";

import { conceptText } from "./concept";

// Vitest runs with cwd = web/, so fixtures live at ../fixtures. (A
// dynamic new URL(..., import.meta.url) would make Vite glob the repo
// root — resolved paths avoid that.)
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

function names(tree: Tree): string[] {
  return tree.nodes.map((_, id) => nodeName(tree, id));
}

const wikiNj = JSON.parse(
  readRepoFile("fixtures/worked/nj_wikipedia5.json"),
) as Worked;
const njBuilt = build(wikiNj.labels, wikiNj.matrix.data, "Nj");
const njTrace = njBuilt.trace;
const njNames = names(njBuilt.tree);

const wikiUpgma = JSON.parse(
  readRepoFile("fixtures/worked/upgma_wikipedia5.json"),
) as Worked;
const upgmaBuilt = build(wikiUpgma.labels, wikiUpgma.matrix.data, "Upgma");
const upgmaTrace = upgmaBuilt.trace;
const upgmaNames = names(upgmaBuilt.tree);

describe("conceptText (Wikipedia 5-taxon NJ)", () => {
  it("names the joining pair in plain language", () => {
    const t = conceptText(njTrace, 0, njNames);
    expect(t).toContain("a and b");
    expect(t).toContain(
      "a and b are joined next: after accounting for how far each is from everything else, they are the closest pair.",
    );
  });

  it("announces a tie at step 1", () => {
    // Worked-example step 2 has tie: true (spec §6.3: ties are announced).
    expect(conceptText(njTrace, 1, njNames)).toContain(
      "Tie: chosen by input order.",
    );
  });

  it("describes the final three-way join at the last position", () => {
    const t = conceptText(njTrace, 2, njNames); // steps.length = 2
    // The last three clusters are d, e and u2 (nodeName of NodeId 6).
    for (const n of ["d", "e", "u2"]) expect(t).toContain(n);
    expect(t).toContain("central");
  });
});

describe("conceptText (Wikipedia 5-taxon UPGMA)", () => {
  it("names the pair and the new cluster's height", () => {
    const t = conceptText(upgmaTrace, 0, upgmaNames);
    expect(t).toContain(
      "a and b are joined next because they are the closest pair; the new group sits halfway between them at height 8.5.",
    );
  });
});
