// flow.ts unit tests (v1.5 plan Task 8, spec §5.4–5.6): the state
// machine's submit/commit/encode contract — first/last/attempts the
// Finish code packs, commit sealing, and the pick→answer mappings.

import { describe, expect, it } from "vitest";

import type { TaskAnswer } from "../engine/generated/TaskAnswer";

import {
  answeredCount,
  branchAnswer,
  cellAnswer,
  clusterTipIndex,
  commitTask,
  encodeAttempts,
  finish,
  lastSubmitted,
  leafAnswer,
  newFlow,
  scaleNumericInput,
  startWork,
  submit,
  taskPosition,
} from "./flow";

const pair = (a: number, b: number): TaskAnswer => ({
  kind: "pair",
  value: [a, b],
});

describe("flow state machine", () => {
  it("start → working → finished", () => {
    const f0 = newFlow(2);
    expect(f0.phase).toBe("start");
    const f1 = startWork(f0);
    expect(f1.phase).toBe("working");
    const f2 = finish(f1, "NP1-abc", 12);
    expect(f2.phase).toBe("finished");
    expect(f2.code).toBe("NP1-abc");
    expect(f2.finishedMin).toBe(12);
  });

  it("submit records first then last, counting attempts", () => {
    let f = startWork(newFlow(1));
    f = submit(f, 0, pair(0, 1));
    expect(f.tasks[0]).toMatchObject({
      first: pair(0, 1),
      last: null,
      attempts: 1,
      committed: false,
    });
    // The practice-mode wrong → retry → right path: the second,
    // different submission lands in `last`.
    f = submit(f, 0, pair(0, 2));
    expect(f.tasks[0]).toMatchObject({
      first: pair(0, 1),
      last: pair(0, 2),
      attempts: 2,
    });
    // Re-submitting the same answer bumps the count but keeps last.
    f = submit(f, 0, pair(0, 2));
    expect(f.tasks[0]).toMatchObject({ attempts: 3, last: pair(0, 2) });
  });

  it("commit seals the task and submits a changed draft", () => {
    let f = startWork(newFlow(1));
    f = submit(f, 0, pair(0, 1));
    f = commitTask(f, 0, pair(0, 1));
    // Same answer as the last submission: sealed, no extra attempt.
    expect(f.tasks[0]).toMatchObject({ attempts: 1, committed: true });
    let g = startWork(newFlow(1));
    g = commitTask(g, 0, pair(3, 4));
    expect(g.tasks[0]).toMatchObject({
      first: pair(3, 4),
      attempts: 1,
      committed: true,
    });
  });

  it("a null commit seals nothing", () => {
    let f = startWork(newFlow(1));
    f = commitTask(f, 0, null);
    expect(f.tasks[0].committed).toBe(true);
    expect(f.tasks[0].first).toBeNull();
    expect(f.tasks[0].attempts).toBe(0);
  });

  it("encodeAttempts emits one record per task, skipped for null", () => {
    let f = startWork(newFlow(2));
    f = submit(f, 0, pair(0, 1));
    const attempts = encodeAttempts(f);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].first).toEqual(pair(0, 1));
    expect(attempts[1]).toEqual({ first: null, last: null, attempts: 0 });
  });

  it("answeredCount counts submitted tasks", () => {
    let f = startWork(newFlow(3));
    f = submit(f, 1, pair(0, 1));
    expect(answeredCount(f)).toBe(1);
  });

  it("lastSubmitted prefers last over first", () => {
    let f = startWork(newFlow(1));
    f = submit(f, 0, pair(0, 1));
    f = submit(f, 0, pair(2, 3));
    expect(lastSubmitted(f.tasks[0])).toEqual(pair(2, 3));
  });
});

describe("taskPosition", () => {
  it("maps stepper tasks to at_step − 1; others to null", () => {
    expect(
      taskPosition({ kind: "predict_pair", step: 3 }),
    ).toBe(2);
    expect(
      taskPosition({
        kind: "numeric",
        step: 1,
        quantity: "q_value",
        role: "chosen",
      }),
    ).toBe(0);
    expect(taskPosition({ kind: "predict_branch" })).toBeNull();
    expect(taskPosition({ kind: "reading", item: 0 })).toBeNull();
  });
});

describe("pick → TaskAnswer", () => {
  const tipOrder = ["A", "B", "C", "D", "E"];
  // Active clusters: node 10 = {A,B}, node 11 = {C}, node 12 = {D,E}.
  const leafSets = new Map<number, ReadonlySet<string>>([
    [10, new Set(["A", "B"])],
    [11, new Set(["C"])],
    [12, new Set(["D", "E"])],
  ]);
  const active = [10, 11, 12];

  it("clusterTipIndex is the lowest matrix position of the leaf set", () => {
    expect(clusterTipIndex(tipOrder, leafSets, 10)).toBe(0);
    expect(clusterTipIndex(tipOrder, leafSets, 12)).toBe(3);
    expect(clusterTipIndex(tipOrder, leafSets, 99)).toBe(-1);
  });

  it("cellAnswer resolves two active clusters to their canonical tips", () => {
    expect(cellAnswer(tipOrder, leafSets, active, 0, 2)).toEqual(
      pair(0, 3),
    );
    expect(cellAnswer(tipOrder, leafSets, active, 0, 0)).toBeNull();
  });

  it("leafAnswer resolves each leaf to its containing cluster's tip", () => {
    // B is inside cluster 10 (canonical 0); D inside 12 (canonical 3).
    expect(leafAnswer(tipOrder, leafSets, active, "B", "D")).toEqual(
      pair(0, 3),
    );
    // Two leaves of one cluster are not a pair.
    expect(leafAnswer(tipOrder, leafSets, active, "A", "B")).toBeNull();
    // An unknown leaf fails to resolve.
    expect(leafAnswer(tipOrder, leafSets, active, "Z", "A")).toBeNull();
  });

  it("branchAnswer splits the canonical split key", () => {
    expect(branchAnswer("A|B|C")).toEqual({
      kind: "branch",
      value: ["A", "B", "C"],
    });
  });
});

describe("scaleNumericInput", () => {
  it("scales a typed decimal at the display precision — exactly", () => {
    expect(scaleNumericInput("1.234", 3)).toBe(1234);
    expect(scaleNumericInput("0.5", 3)).toBe(500);
    expect(scaleNumericInput("12", 3)).toBe(12000);
    expect(scaleNumericInput("-0.25", 2)).toBe(-25);
    // Extra decimals are dropped only when zero — displayed values
    // never carry them.
    expect(scaleNumericInput("1.2300", 3)).toBe(1230);
    expect(scaleNumericInput("1.2345", 3)).toBeNull();
    expect(scaleNumericInput("abc", 3)).toBeNull();
    expect(scaleNumericInput("", 3)).toBeNull();
  });
});
