// Draft-helpers tests for the reading editor (v1.4d plan Task 10).
// Every helper is pure shaping: the engine is the only validator, so
// these pin the JSON the forms write, the pick→item mapping taps feed,
// and the draft↔set round trip used by Import.

import { describe, expect, it } from "vitest";

import { engine } from "../../../engine/index";
import type { Tree } from "../../../engine/generated/Tree";
import { readErrorMessage } from "../../../reading/errors";

import {
  buildWireSet,
  canvasClade,
  draftFromSet,
  emptyDraft,
  emptyTreeDraft,
  probeSetJson,
  resolveTreeView,
} from "./readingDraft";
import { applyExtra } from "./readingExtras";
import {
  applyPick,
  newItem,
  pickTargetsFor,
} from "./readingItems";

const NEWICK = "((a,b),(c,d));";

function parse(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

describe("buildWireSet", () => {
  it("emits the wire ReadingSet the forms describe", () => {
    const draft = {
      ...emptyDraft(),
      id: "trees-mini",
      title: "Mammal reading",
      summary: "A small set",
    };
    draft.trees = [{ ...emptyTreeDraft("t1"), newick: NEWICK }];
    const item = newItem("mrca", "t1", 1);
    item.text = "Tap the MRCA of {set}.";
    item.tips = ["a", "b"];
    draft.items = [item];

    expect(buildWireSet(draft)).toEqual({
      schema_version: 1,
      kind: "reading",
      id: "trees-mini",
      title: "Mammal reading",
      summary: "A small set",
      mode: "practice",
      taxa_pool: {},
      trees: {
        t1: {
          newick: NEWICK,
          node_letters: [],
          marks: [],
          traits: [],
          points: [],
        },
      },
      items: [
        {
          id: "q1",
          text: "Tap the MRCA of {set}.",
          trees: ["t1"],
          tips: ["a", "b"],
          question: { type: "mrca" },
          rotate_tool: true,
        },
      ],
    });
  });

  it("emits times only when set, and carries letters, marks and points", () => {
    const t = emptyTreeDraft("t1");
    t.newick = NEWICK;
    t.node_letters = [{ on: ["a", "b"], letter: "P" }];
    t.marks = [{ on: ["c", "d"], trait: "hair", change: "gain" }];
    t.points = [{ letter: "X", on: ["a"], at: "branch" }];
    t.traits = [{ name: "hair", ancestral: "bare", derived: "hairy" }];
    t.times = {
      unit: "Ma",
      source: "a cited estimate",
      ages: [{ on: ["a", "b"], age: 3.5 }],
    };
    const wire = buildWireSet({
      ...emptyDraft(),
      id: "x",
      title: "t",
      summary: "s",
      trees: [t],
      items: [],
    }) as { trees: Record<string, Record<string, unknown>> };
    expect(wire.trees.t1).toEqual({
      newick: NEWICK,
      node_letters: [{ on: ["a", "b"], letter: "P" }],
      times: {
        unit: "Ma",
        source: "a cited estimate",
        ages: [{ on: ["a", "b"], age: 3.5 }],
      },
      marks: [{ on: ["c", "d"], trait: "hair", change: "gain" }],
      traits: [{ name: "hair", ancestral: "bare", derived: "hairy" }],
      points: [{ letter: "X", on: ["a"], at: "branch" }],
    });
  });

  it("omits the times key for none and emits the schematic string", () => {
    const t = emptyTreeDraft("t1");
    t.newick = NEWICK;
    const build = () =>
      (
        buildWireSet({
          ...emptyDraft(),
          id: "x",
          title: "t",
          summary: "s",
          trees: [t],
          items: [],
        }) as { trees: Record<string, Record<string, unknown>> }
      ).trees.t1;
    expect("times" in build()).toBe(false);
    t.times = "schematic";
    expect(build().times).toBe("schematic");
  });
});

describe("newItem", () => {
  it("defaults each question type to an editable shell", () => {
    expect(newItem("which_differs", "t1", 2).question).toEqual({
      type: "which_differs",
    });
    expect(newItem("closest_relative", "t1", 3).question).toEqual({
      type: "closest_relative",
      form: "closest",
    });
    expect(newItem("trait", "t1", 4).question).toEqual({
      type: "trait",
      ask: { kind: "which_have", trait_name: "" },
    });
    expect(newItem("two_tier", "t1", 5).question).toEqual({
      type: "two_tier",
      first: { type: "is_clade" },
      reasons: ["", ""],
      correct_reason: 0,
    });
    const it1 = newItem("order_nodes", null, 6);
    expect(it1.trees).toEqual([]);
    expect(it1.id).toBe("q6");
    expect(it1.rotate_tool).toBe(true);
  });
});

describe("draftFromSet / buildWireSet round trip", () => {
  it("rebuilds a loaded set byte-for-byte through the draft", () => {
    const wire = {
      schema_version: 1,
      kind: "reading",
      id: "trees-rt",
      title: "Round trip",
      summary: "s",
      meta: {
        objectives: ["read a tree"],
        minutes: 10,
        level: "intro",
        prepares_for: [],
      },
      mode: "test",
      taxa_pool: { mammals: ["cat", "dog"] },
      trees: {
        t1: {
          newick: NEWICK,
          node_letters: [{ on: "root", letter: "P" }],
          marks: [{ on: ["a", "b"], trait: "fur", change: "gain" }],
          traits: [{ name: "fur", ancestral: "bare", derived: "furry" }],
          points: [{ letter: "X", on: ["a"], at: "branch" }],
        },
      },
      items: [
        {
          id: "q1",
          text: "How many clades?",
          note_after: "The root counts.",
          trees: ["t1"],
          tips: [],
          question: { type: "count_clades" },
          rotate_tool: false,
        },
      ],
    };
    const first = engine.loadReadingSet(JSON.stringify(wire));
    if (!first.ok) {
      throw new Error(`fixture set must load: ${readErrorMessage(first.error)}`);
    }
    const rebuilt = buildWireSet(draftFromSet(first.value));
    const second = engine.loadReadingSet(JSON.stringify(rebuilt));
    if (!second.ok) {
      throw new Error(
        `rebuilt set must load: ${readErrorMessage(second.error)}`,
      );
    }
    expect(second.value).toEqual(first.value);
  });
});

describe("resolveTreeView / probeSetJson", () => {
  it("resolves a stored tree to a ReadingTreeView for preview", () => {
    const t = { ...emptyTreeDraft("t1"), newick: NEWICK };
    const r = resolveTreeView(t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodes).toHaveLength(7);
    const root = r.value.nodes[r.value.root];
    expect(root.clade).toEqual(["a", "b", "c", "d"]);
  });

  it("reports the engine's message for an unparseable tree", () => {
    const t = { ...emptyTreeDraft("t1"), newick: "(((a,b)," };
    const r = resolveTreeView(t);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidReading");
  });

  it("probe set names extras problems against the tree", () => {
    const t = { ...emptyTreeDraft("t1"), newick: NEWICK };
    t.node_letters = [{ on: ["a", "z"], letter: "P" }];
    const r = engine.loadReadingSet(probeSetJson(t));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({
      kind: "InvalidReading",
      field: expect.stringContaining("node_letters"),
    });
  });
});

describe("canvasClade", () => {
  it("names a drawn node by its sorted tip set", () => {
    const tree = parse(NEWICK);
    const r = canvasClade(tree, tree.root);
    expect(r).toEqual({ ok: true, value: ["a", "b", "c", "d"] });
  });

  it("refuses an id that names no node tips", () => {
    const tree = parse(NEWICK);
    const r = canvasClade(tree, 99);
    expect(r.ok).toBe(false);
  });
});

describe("pickTargetsFor", () => {
  it("offers tips for mrca/smallest_clade/is_clade, a/b/c for pairwise, none for count_clades", () => {
    const ids = (q: ReturnType<typeof newItem>["question"]) =>
      pickTargetsFor(q).map((t) => t.id);
    expect(ids({ type: "mrca" })).toContain("tips");
    expect(ids({ type: "smallest_clade" })).toContain("tips");
    expect(ids({ type: "is_clade" })).toContain("tips");
    expect(ids({ type: "count_clades" })).toEqual([]);
    expect(
      ids({ type: "closest_relative", form: "pairwise" }),
    ).toEqual(["a", "b", "c"]);
    expect(ids({ type: "closest_relative", form: "closest" })).toEqual([
      "a",
    ]);
    expect(ids({ type: "order_nodes", nodes: [] })).toEqual([
      "order-nodes",
    ]);
    expect(ids({ type: "place_taxon", name: "x", sister: [] })).toEqual([
      "sister",
    ]);
    expect(
      ids({
        type: "trait",
        ask: { kind: "homologous", trait_name: "t", x: "a", y: "b" },
      }),
    ).toEqual(["ask-x", "ask-y"]);
    // two_tier exposes its inner question's targets.
    expect(
      ids({
        type: "two_tier",
        first: { type: "mrca" },
        reasons: [],
        correct_reason: 0,
      }),
    ).toContain("tips");
  });
});

describe("applyPick", () => {
  const tree = { ...emptyTreeDraft("t1"), newick: NEWICK };
  tree.node_letters = [{ on: ["a", "b"], letter: "P" }];
  tree.points = [
    { letter: "W", on: ["c", "d"], at: "node" },
    { letter: "X", on: ["a", "b"], at: "branch" },
  ];
  const viewR = resolveTreeView(tree);
  if (!viewR.ok) throw new Error("fixture tree must resolve");
  const view = viewR.value;

  it("toggles tips for the set target, sorted", () => {
    const item = newItem("mrca", "t1", 1);
    let next = applyPick(item, "tips", ["c"], view);
    next = applyPick(next, "tips", ["a"], view);
    expect(next.tips).toEqual(["a", "c"]);
    next = applyPick(next, "tips", ["a"], view);
    expect(next.tips).toEqual(["c"]);
  });

  it("sets a/b/c from the tapped tip", () => {
    const item = newItem("closest_relative", "t1", 1);
    item.question = { type: "closest_relative", form: "pairwise" };
    const next = applyPick(item, "b", ["d"], view);
    expect(next.b).toBe("d");
  });

  it("sets the place_taxon sister from the tapped node's clade", () => {
    const item = newItem("place_taxon", "t1", 1);
    const next = applyPick(item, "sister", ["a", "b"], view);
    expect(next.question).toEqual({
      type: "place_taxon",
      name: "",
      sister: ["a", "b"],
    });
  });

  it("resolves a tapped point clade to its letter for mrca options", () => {
    const item = newItem("mrca", "t1", 1);
    item.question = { type: "mrca", options: [] };
    let next = applyPick(item, "mrca-options", ["c", "d"], view);
    expect(next.question).toEqual({
      type: "mrca",
      options: ["W"],
    });
    next = applyPick(next, "mrca-options", ["a", "b"], view);
    expect(next.question).toEqual({
      type: "mrca",
      options: ["W", "X"],
    });
  });

  it("resolves a tapped lettered node to its letter for order_nodes", () => {
    const item = newItem("order_nodes", "t1", 1);
    const next = applyPick(item, "order-nodes", ["a", "b"], view);
    expect(next.question).toEqual({
      type: "order_nodes",
      nodes: ["P"],
    });
  });

  it("routes two_tier picks to the inner question", () => {
    const item = newItem("two_tier", "t1", 1);
    item.question = {
      type: "two_tier",
      first: { type: "place_taxon", name: "x", sister: [] },
      reasons: ["r1", "r2"],
      correct_reason: 1,
    };
    const next = applyPick(item, "sister", ["c", "d"], view);
    expect(next.question).toEqual({
      type: "two_tier",
      first: { type: "place_taxon", name: "x", sister: ["c", "d"] },
      reasons: ["r1", "r2"],
      correct_reason: 1,
    });
  });
});

describe("applyExtra", () => {
  const base = () => ({ ...emptyTreeDraft("t1"), newick: NEWICK });

  it("sets or replaces a node letter on the tapped clade", () => {
    let t = applyExtra(base(), "letter", ["a", "b"], { letter: "P" });
    expect(t.node_letters).toEqual([{ on: ["a", "b"], letter: "P" }]);
    t = applyExtra(t, "letter", ["a", "b"], { letter: "Q" });
    expect(t.node_letters).toEqual([{ on: ["a", "b"], letter: "Q" }]);
  });

  it("adds a mark with its trait and change", () => {
    const t = applyExtra(base(), "mark", ["c", "d"], {
      trait: "hair",
      change: "gain",
    });
    expect(t.marks).toEqual([
      { on: ["c", "d"], trait: "hair", change: "gain" },
    ]);
  });

  it("adds points on nodes and branches", () => {
    let t = applyExtra(base(), "point-node", ["a"], { letter: "X" });
    t = applyExtra(t, "point-branch", ["c", "d"], { letter: "Y" });
    expect(t.points).toEqual([
      { letter: "X", on: ["a"], at: "node" },
      { letter: "Y", on: ["c", "d"], at: "branch" },
    ]);
  });

  it("sets an age on the tapped clade", () => {
    const t0 = base();
    t0.times = { unit: "Ma", source: "", ages: [] };
    const t = applyExtra(t0, "age", ["a", "b"], { age: 2.5 });
    expect(t.times).toEqual({
      unit: "Ma",
      source: "",
      ages: [{ on: ["a", "b"], age: 2.5 }],
    });
  });
});
