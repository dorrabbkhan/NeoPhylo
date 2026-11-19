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

import { describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Item } from "../engine/generated/Item";
import type { Question } from "../engine/generated/Question";
import type { ReadingSet } from "../engine/generated/ReadingSet";
import type { Response } from "../engine/generated/Response";

import {
  effectiveResponse,
  emptyResponse,
  fillItemText,
  initSession,
  isComplete,
  readingReducer,
  selectableFor,
  submittable,
  traitNames,
  type ResponseDraft,
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

describe("two_tier over a pairwise first", () => {
  // The pairwise closest_relative has no untouched Response value —
  // "B" is a real answer — so the draft's `first` is the null marker
  // until the student picks.
  const PAIR_TIER: Question = {
    type: "two_tier",
    first: { type: "closest_relative", form: "pairwise" },
    reasons: [
      "They share a node that nothing else descends from.",
      "Their names sit side by side.",
    ],
    correct_reason: 0,
  };
  const pairTierItem = (): Item => ({
    ...item("q-pair"),
    id: "q-two-pair",
    question: PAIR_TIER,
  });

  it("is unsubmittable until the inner pairwise is picked", () => {
    const it = pairTierItem();
    expect(
      submittable(it, { kind: "two_tier", first: null, reason: -1 }),
    ).toBe(false);
    // Reason picked only: Check stays off.
    expect(
      submittable(it, { kind: "two_tier", first: null, reason: 1 }),
    ).toBe(false);
    // A real pairwise pick + reason completes it.
    expect(
      submittable(it, {
        kind: "two_tier",
        first: { kind: "pairwise", answer: "B" },
        reason: 1,
      }),
    ).toBe(true);
    // Picking "B" explicitly works — the old sentinel's value is a
    // real answer once the student chooses it.
    expect(
      isComplete(PAIR_TIER, {
        kind: "two_tier",
        first: { kind: "pairwise", answer: "B" },
        reason: 0,
      }),
    ).toBe(true);
  });

  it("check does not mark a reason-only pairwise two_tier", () => {
    const set: ReadingSet = { ...DEMO, items: [pairTierItem()] };
    let s = initSession(set);
    s = readingReducer(s, {
      type: "answer",
      response: { kind: "two_tier", first: null, reason: 1 },
    });
    s = readingReducer(s, { type: "check" });
    expect(s.checked[0]).toBe(false);
  });

  it("a standalone pairwise item is unchanged", () => {
    const q: Question = { type: "closest_relative", form: "pairwise" };
    expect(isComplete(q, null)).toBe(false);
    expect(isComplete(q, { kind: "pairwise", answer: "B" })).toBe(true);
    expect(
      submittable(item("q-pair"), { kind: "pairwise", answer: "C" }),
    ).toBe(true);
  });
});

describe("effectiveResponse", () => {
  const pairTierItem = (): Item => ({
    ...item("q-pair"),
    id: "q-two-pair",
    question: {
      type: "two_tier",
      first: { type: "closest_relative", form: "pairwise" },
      reasons: ["x", "y"],
      correct_reason: 0,
    },
  });

  it("maps every draft holding the untouched marker to null", () => {
    const it = pairTierItem();
    expect(effectiveResponse(it, null)).toBeNull();
    expect(
      effectiveResponse(it, {
        kind: "two_tier",
        first: null,
        reason: -1,
      }),
    ).toBeNull();
    expect(
      effectiveResponse(it, {
        kind: "two_tier",
        first: null,
        reason: 1,
      }),
    ).toBeNull();
    // The marker can't hide one level deeper either.
    expect(
      effectiveResponse(it, {
        kind: "two_tier",
        first: { kind: "two_tier", first: null, reason: 0 },
        reason: 1,
      }),
    ).toBeNull();
  });

  it("a complete draft becomes the exact engine Response", () => {
    const r = effectiveResponse(pairTierItem(), {
      kind: "two_tier",
      first: { kind: "pairwise", answer: "C" },
      reason: 1,
    });
    expect(r).toEqual({
      kind: "two_tier",
      first: { kind: "pairwise", answer: "C" },
      reason: 1,
    });
  });

  it("no Response handed to the engine ever carries the marker", () => {
    const it = pairTierItem();
    const set: ReadingSet = { ...DEMO, items: [it] };
    const spy = vi.spyOn(engine, "readingCheck");
    const drafts: (ResponseDraft | null)[] = [
      null,
      { kind: "two_tier", first: null, reason: -1 },
      { kind: "two_tier", first: null, reason: 1 },
      {
        kind: "two_tier",
        first: { kind: "pairwise", answer: "B" },
        reason: -1,
      },
      {
        kind: "two_tier",
        first: { kind: "pairwise", answer: "B" },
        reason: 0,
      },
      {
        kind: "two_tier",
        first: { kind: "two_tier", first: null, reason: 0 },
        reason: 1,
      },
    ];
    for (const d of drafts) {
      const r = effectiveResponse(it, d);
      // Only the non-null results — what the page would send.
      if (r !== null) engine.readingCheck(set, 0, r);
    }
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call[2])).not.toContain('"first":null');
    }
    spy.mockRestore();
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
    // A pairwise question has no untouched Response — "B" is a real
    // answer — so its empty form is null, not a fabricated pick.
    expect(
      emptyResponse({ type: "closest_relative", form: "pairwise" }),
    ).toBeNull();
    expect(
      emptyResponse({
        type: "two_tier",
        first: { type: "closest_relative", form: "pairwise" },
        reasons: ["x"],
        correct_reason: 0,
      }),
    ).toEqual({ kind: "two_tier", first: null, reason: -1 });
  });

  it("traitNames lists authored traits first, then mark-only names", () => {
    const r = engine.readingTree(DEMO, "traits");
    if (!r.ok) throw new Error("traits view refused");
    expect(traitNames(r.value)).toEqual(["hair", "wings", "fur", "nails"]);
  });
});
