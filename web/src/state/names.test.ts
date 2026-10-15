/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import { nodeName } from "./names";

// Wikipedia 5-taxon NJ worked example (fixtures/worked). Built through the
// real engine so node ids follow the engine convention: leaves 0..4 in
// input order, internal nodes in creation order (plan Global Constraints).
// Under jsdom import.meta.url is an http URL, so fall back to a
// cwd-relative path (vitest runs with cwd = web/).
function wikipedia5(): { tree: Tree; stepNodes: number[]; labels: string[] } {
  const fxUrl = new URL(
    "../../../fixtures/worked/nj_wikipedia5.json",
    import.meta.url,
  );
  const fxPath =
    fxUrl.protocol === "file:"
      ? fileURLToPath(fxUrl)
      : resolve("../fixtures/worked/nj_wikipedia5.json");
  const fx = JSON.parse(readFileSync(fxPath, "utf8")) as {
    labels: string[];
    matrix: { data: number[] };
  };
  const r = engine.buildTree(
    {
      labels: fx.labels,
      model: "P",
      cells: fx.matrix.data.map((v) => ({ Value: v })),
    },
    "Nj",
    { trace: true },
  );
  if (!r.ok) throw new Error(`buildTree failed: ${JSON.stringify(r.error)}`);
  if (!r.value.trace || !("Nj" in r.value.trace)) {
    throw new Error("expected an NJ trace");
  }
  return {
    tree: r.value.tree,
    stepNodes: r.value.trace.Nj.steps.map((s) => s.new_node),
    labels: fx.labels,
  };
}

describe("nodeName", () => {
  it("names leaves by their labels", () => {
    const { tree, labels } = wikipedia5();
    for (let id = 0; id < labels.length; id++) {
      expect(nodeName(tree, id)).toBe(labels[id]);
    }
    expect(labels).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("names internal nodes u1, u2, … in creation order", () => {
    const { tree, stepNodes } = wikipedia5();
    // NJ steps 1 and 2 create the first two internal nodes; the final
    // three-way join creates the central node, which is the root.
    expect(nodeName(tree, stepNodes[0])).toBe("u1");
    expect(nodeName(tree, stepNodes[1])).toBe("u2");
    expect(nodeName(tree, tree.root)).toBe("u3");
  });
});
