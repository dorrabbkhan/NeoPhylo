// Session-reducer tests for the reading area (v1.4d plan Task 8,
// spec §4.4/§7.2). Named tests:
// - the reducer keeps each item's response across Back/Next
//   (Review Focus 4);
// - test mode never exposes a verdict (checked stays false) before
//   Finish — practice mode marks the item checked so the page can
//   ask the engine for the verdict;
// - isComplete gates Check per question kind, including the
//   two-tier "reason picked but first unanswered" case.
//
// Sets are loaded through the real engine — the demo file doubles
// as fixture here so a load regression fails this test too.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Question } from "../engine/generated/Question";
import type { ReadingSet } from "../engine/generated/ReadingSet";
import type { Response } from "../engine/generated/Response";

import {
  emptyResponse,
  fillItemText,
  initSession,
  isComplete,
  readingReducer,
  selectableFor,
  submittable,
  traitNames,
} from "./state";

function loadDemo(): ReadingSet {
  const text = readFileSync(
    resolve("..", "exercises", "reading", "trees-demo.json"),
    "utf8",
  );
  const r = engine.loadReadingSet(text);
  if (!r.ok) throw new Error(`demo set refused: ${r.error.kind}`);
  return r.value;
}

const DEMO = loadDemo();
const item = (id: string) => {
  const it = DEMO.items.find((x) => x.id === id);
  if (it === undefined) throw new Error(`no item ${id}`);
  return it;
};

describe("reading session reducer", () => {
  it("starts on item 0 with empty responses", () => {
    const s = initSession(DEMO);
    expect(s.index).toBe(0);
    expect(s.responses).toHaveLength(DEMO.items.length);
    expect(s.responses.every((r) => r === null)).toBe(true);
    expect(s.checked.every((c) => !c)).toBe(true);
    expect(s.finished).toBe(false);
  });

  it("keeps each item's response across Back/Next (Review Focus 4)", () => {
    let s = initSession(DEMO);
    const r0: Response = { kind: "choice", index: 2 };
    s = readingReducer(s, { type: "answer", response: r0 });
    s = readingReducer(s, { type: "next" });
    const r1: Response = { kind: "choice", index: 0 };
    s = readingReducer(s, { type: "answer", response: r1 });
    s = readingReducer(s, { type: "next" });
    s = readingReducer(s, { type: "back" });
    expect(s.responses[1]).toEqual(r1);
    s = readingReducer(s, { type: "back" });
    expect(s.responses[0]).toEqual(r0);
  });

  it("clamps Back at the first item and Next at the last", () => {
    let s = initSession(DEMO);
    s = readingReducer(s, { type: "back" });
    expect(s.index).toBe(0);
    for (let i = 0; i < DEMO.items.length + 3; i++) {
      s = readingReducer(s, { type: "next" });
    }
    expect(s.index).toBe(DEMO.items.length - 1);
  });

  it("check marks the item only when the response is complete", () => {
    let s = initSession(DEMO); // practice set
    s = readingReducer(s, { type: "check" });
    expect(s.checked[0]).toBe(false);
    s = readingReducer(s, {
      type: "answer",
      response: { kind: "choice", index: 1 },
    });
    s = readingReducer(s, { type: "check" });
    expect(s.checked[0]).toBe(true);
  });

  it("a retry clears the check so the verdict is recomputed", () => {
    let s = initSession(DEMO);
    s = readingReducer(s, {
      type: "answer",
      response: { kind: "choice", index: 1 },
    });
    s = readingReducer(s, { type: "check" });
    s = readingReducer(s, {
      type: "answer",
      response: { kind: "choice", index: 2 },
    });
    expect(s.checked[0]).toBe(false);
  });

  it("test mode never marks an item checked before Finish", () => {
    const testSet: ReadingSet = { ...DEMO, mode: "test" };
    let s = initSession(testSet);
    s = readingReducer(s, {
      type: "answer",
      response: { kind: "choice", index: 0 },
    });
    s = readingReducer(s, { type: "check" });
    expect(s.checked[0]).toBe(false);
    s = readingReducer(s, { type: "next" });
    s = readingReducer(s, { type: "finish" });
    expect(s.finished).toBe(true);
  });

  it("restart returns to a fresh session", () => {
    let s = initSession(DEMO);
    s = readingReducer(s, {
      type: "answer",
      response: { kind: "choice", index: 1 },
    });
    s = readingReducer(s, { type: "finish" });
    s = readingReducer(s, { type: "restart" });
    expect(s.index).toBe(0);
    expect(s.finished).toBe(false);
    expect(s.responses.every((r) => r === null)).toBe(true);
  });
});

describe("isComplete / submittable", () => {
  const complete = (q: Question, r: Response | null) => isComplete(q, r);

  it("single-choice questions need a picked option", () => {
    const q: Question = { type: "is_clade" };
    expect(complete(q, null)).toBe(false);
    expect(complete(q, { kind: "choice", index: -1 })).toBe(false);
    expect(complete(q, { kind: "choice", index: 0 })).toBe(true);
  });

  it("select_true may be submitted with nothing selected", () => {
    const q: Question = { type: "select_true", statements: [] };
    expect(complete(q, null)).toBe(true);
    expect(complete(q, { kind: "choices", indices: [] })).toBe(true);
    expect(submittable(item("q-select"), null)).toBe(true);
  });

  it("node responses need a clade; tips responses need a tip", () => {
    const mrca: Question = { type: "mrca" };
    expect(complete(mrca, { kind: "node", clade: [] })).toBe(false);
    expect(complete(mrca, { kind: "node", clade: ["a", "b"] })).toBe(true);
    const tips: Question = {
      type: "trait",
      ask: { kind: "which_have", trait_name: "hair" },
    };
    expect(complete(tips, { kind: "tips", tips: [] })).toBe(false);
    expect(complete(tips, { kind: "tips", tips: ["bat"] })).toBe(true);
  });

  it("order_nodes is complete only with every letter ordered", () => {
    const q: Question = { type: "order_nodes", nodes: ["P", "Q", "R"] };
    expect(complete(q, { kind: "order", letters: ["P"] })).toBe(false);
    expect(complete(q, { kind: "order", letters: ["R", "P", "Q"] })).toBe(
      true,
    );
  });

  it("two_tier needs both the first answer and a reason", () => {
    const q: Question = {
      type: "two_tier",
      first: { type: "is_clade" },
      reasons: ["x", "y"],
      correct_reason: 0,
    };
    expect(
      complete(q, {
        kind: "two_tier",
        first: { kind: "choice", index: 0 },
        reason: -1,
      }),
    ).toBe(false);
    expect(
      complete(q, {
        kind: "two_tier",
        first: { kind: "choice", index: -1 },
        reason: 1,
      }),
    ).toBe(false);
    expect(
      complete(q, {
        kind: "two_tier",
        first: { kind: "choice", index: 0 },
        reason: 1,
      }),
    ).toBe(true);
  });
});

describe("selectableFor", () => {
  it("maps each question kind to the tree's pick mode", () => {
    expect(selectableFor({ type: "mrca" })).toBe("node");
    expect(selectableFor({ type: "mrca", options: ["W"] })).toBe("points");
    expect(
      selectableFor({ type: "place_taxon", name: "x", sister: ["a"] }),
    ).toBe("points");
    expect(selectableFor({ type: "smallest_clade" })).toBe("node");
    expect(selectableFor({ type: "order_nodes", nodes: ["P"] })).toBe(
      "node",
    );
    expect(
      selectableFor({ type: "closest_relative", form: "closest" }),
    ).toBe("tips");
    expect(
      selectableFor({ type: "closest_relative", form: "most_distant" }),
    ).toBe("tips");
    expect(
      selectableFor({ type: "closest_relative", form: "pairwise" }),
    ).toBe("none");
    expect(selectableFor({ type: "which_differs" })).toBe("none");
    expect(selectableFor({ type: "count_clades" })).toBe("none");
    expect(
      selectableFor({
        type: "trait",
        ask: { kind: "which_have", trait_name: "hair" },
      }),
    ).toBe("tips");
    expect(
      selectableFor({
        type: "trait",
        ask: { kind: "has_not", has: "hair", lacks: "fur" },
      }),
    ).toBe("tips");
    expect(
      selectableFor({
        type: "two_tier",
        first: { type: "mrca" },
        reasons: [],
        correct_reason: 0,
      }),
    ).toBe("node");
  });
});

describe("item text + helpers", () => {
  it("fills {a}, {b}, {c} and {set} placeholders", () => {
    expect(fillItemText(item("q-pair"))).toBe(
      "Is human more closely related to chimp or to gorilla?",
    );
    expect(fillItemText(item("q-clade"))).toBe(
      "Do gibbon and gorilla form a clade?",
    );
    expect(fillItemText(item("q-longnames"))).toBe(
      "Do Homo sapiens and Pan paniscus form a clade?",
    );
  });

  it("joins three or more tips with commas and 'and'", () => {
    const fake = { ...item("q-clade"), tips: ["a", "b", "c"] };
    expect(fillItemText(fake)).toBe("Do a, b and c form a clade?");
  });

  it("emptyResponse makes an incomplete answer of the right kind", () => {
    expect(emptyResponse({ type: "mrca" })).toEqual({
      kind: "node",
      clade: [],
    });
    expect(emptyResponse({ type: "is_clade" })).toEqual({
      kind: "choice",
      index: -1,
    });
    expect(emptyResponse({ type: "select_true", statements: [] })).toEqual({
      kind: "choices",
      indices: [],
    });
  });

  it("traitNames lists authored traits first, then mark-only names", () => {
    const r = engine.readingTree(DEMO, "traits");
    if (!r.ok) throw new Error("traits view refused");
    expect(traitNames(r.value)).toEqual(["hair", "wings", "fur", "nails"]);
  });
});
