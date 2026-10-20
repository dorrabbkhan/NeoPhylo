// Session bootstrap state tests (v1.2 plan Task 10, v1.2 spec §6.1).
// The reducer is pure: a running job lives in `bootstrap.jobId` and a
// data/model change clears results to "idle" while moving that jobId
// to `cancelJobId`, which the App effect turns into client.cancel().

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { BootstrapTally } from "../engine/generated/BootstrapTally";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { Tree } from "../engine/generated/Tree";

import { initialSession, reducer } from "./session";
import type { Session } from "./session";

const EXERCISE_JSON = `{
  "schema_version": 1,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" }
}`;

function exercise(): Exercise {
  const r = engine.loadExercise(EXERCISE_JSON);
  if (!r.ok) throw new Error("loadExercise failed");
  return r.value;
}

function loaded(): Session {
  const ex = exercise();
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

function tree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error("parseNewick failed");
  return r.value;
}

const SUPPORT_TREE = () =>
  tree("((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);");

const TALLY: BootstrapTally = {
  method: "Nj",
  labels: ["A", "B", "C", "D", "E"],
  successful: 100,
  failed: 0,
  counts: [
    { labels: ["A", "B"], count: 98 },
    { labels: ["D", "E"], count: 87 },
  ],
};

const CONSENSUS = (): Record<ConsensusKind, Tree> => ({
  Strict: SUPPORT_TREE(),
  Majority: SUPPORT_TREE(),
  Extended: SUPPORT_TREE(),
});

const DROPPED = {
  Strict: [],
  Majority: [],
  Extended: [],
};

/** A session with a bootstrap job in flight (jobId 7, 40/100 done). */
function running(): Session {
  let s = reducer(loaded(), { type: "bootstrapRequested", jobId: 7 });
  s = reducer(s, {
    type: "bootstrapProgress",
    jobId: 7,
    done: 40,
    total: 100,
    failed: 0,
    etaMs: 200,
    support: SUPPORT_TREE(),
  });
  return s;
}

/** A session with a finished run (jobId 7). */
function done(): Session {
  return reducer(running(), {
    type: "bootstrapDone",
    jobId: 7,
    result: {
      tally: TALLY,
      support: SUPPORT_TREE(),
      consensus: CONSENSUS(),
      dropped: DROPPED,
      failed: 0,
    },
  });
}

describe("bootstrap session state", () => {
  it("defaults: idle, 100 replicates, seed 1, support view", () => {
    const b = loaded().bootstrap;
    expect(b.status).toBe("idle");
    expect(b.replicates).toBe(100);
    expect(b.seed).toBe(1);
    expect(b.view).toBe("support");
    expect(b.support).toBeNull();
    expect(b.consensus).toBeNull();
    expect(b.dropped).toBeNull();
    expect(b.settingsUsed).toBeNull();
    expect(b.jobId).toBeNull();
    expect(b.cancelJobId).toBeNull();
    expect(b.replicateIndex).toBeNull();
  });

  it("rerootDisplay defaults to true and toggles", () => {
    const s = loaded();
    expect(s.rerootDisplay).toBe(true);
    expect(reducer(s, { type: "toggleRerootDisplay" }).rerootDisplay).toBe(
      false,
    );
  });

  it("bootstrapRequested snapshots settingsUsed and enters estimating", () => {
    let s = reducer(loaded(), {
      type: "setBootstrapSettings",
      patch: { replicates: 250, seed: 9 },
    });
    s = reducer(s, { type: "bootstrapRequested", jobId: 3 });
    expect(s.bootstrap.status).toBe("estimating");
    expect(s.bootstrap.jobId).toBe(3);
    expect(s.bootstrap.settingsUsed).toEqual({ replicates: 250, seed: 9 });
    expect(s.bootstrap.total).toBe(250);
  });

  it("progress/done update support and move to done", () => {
    const s = done();
    expect(s.bootstrap.status).toBe("done");
    expect(s.bootstrap.support).not.toBeNull();
    expect(s.bootstrap.consensus).not.toBeNull();
    expect(s.bootstrap.dropped).not.toBeNull();
    expect(s.bootstrap.jobId).toBeNull();
    expect(s.bootstrap.settingsUsed).toEqual({ replicates: 100, seed: 1 });
  });

  it("bootstrapFailed stores the error", () => {
    const e: NeoError = { kind: "BootstrapFailed", failed: 100, total: 100 };
    const s = reducer(running(), {
      type: "bootstrapFailed",
      jobId: 7,
      error: e,
    });
    expect(s.bootstrap.status).toBe("error");
    expect(s.bootstrap.error).toEqual(e);
    expect(s.bootstrap.jobId).toBeNull();
  });

  it("bootstrapCancelled stops a running job", () => {
    const s = reducer(running(), { type: "bootstrapCancelled" });
    expect(s.bootstrap.status).toBe("cancelled");
    expect(s.bootstrap.jobId).toBeNull();
    expect(s.bootstrap.cancelJobId).toBeNull();
  });

  it("ignores messages for a job that isn't current", () => {
    const s = reducer(running(), {
      type: "bootstrapProgress",
      jobId: 99,
      done: 90,
      total: 100,
      failed: 0,
      etaMs: 1,
      support: SUPPORT_TREE(),
    });
    expect(s.bootstrap.done).toBe(40);
    expect(s.bootstrap.status).toBe("running");
  });

  it("setBootstrapSettings clamps replicates and keeps done results", () => {
    let s = done();
    s = reducer(s, {
      type: "setBootstrapSettings",
      patch: { replicates: 5 },
    });
    expect(s.bootstrap.replicates).toBe(10);
    s = reducer(s, {
      type: "setBootstrapSettings",
      patch: { replicates: 5000 },
    });
    expect(s.bootstrap.replicates).toBe(1000);
    // Review Focus 3: results stay; settingsUsed keeps the run's values.
    expect(s.bootstrap.status).toBe("done");
    expect(s.bootstrap.support).not.toBeNull();
    expect(s.bootstrap.settingsUsed).toEqual({ replicates: 100, seed: 1 });
  });

  it("clear_on_data_change: data/model changes clear results and request a cancel", () => {
    const actions = [
      { type: "setSim", patch: { seed: 9 } },
      { type: "setAnalysis", patch: { correction: "K80" } },
      { type: "setBranchScale", scale: 0.5 },
      {
        type: "importAlignment",
        alignment: {
          labels: ["x1", "x2", "x3", "x4"],
          seqs: [
            [65, 67, 71, 84],
            [65, 67, 71, 84],
            [65, 67, 71, 84],
            [65, 67, 71, 84],
          ],
          alphabet: "dna" as const,
        },
      },
      { type: "importTree", tree: tree("((A:0.1,B:0.1):0.1,C:0.2);") },
    ] as const;
    for (const a of actions) {
      const s = reducer(running(), a as never);
      expect(
        s.bootstrap.status,
        `status after ${a.type}`,
      ).toBe("idle");
      expect(s.bootstrap.support).toBeNull();
      expect(s.bootstrap.consensus).toBeNull();
      expect(s.bootstrap.jobId).toBeNull();
      expect(s.bootstrap.cancelJobId).toBe(7);
      expect(s.bootstrap.settingsUsed).toBeNull();
    }
    // `load` resets to defaults entirely.
    const s = reducer(done(), {
      type: "load",
      exercise: exercise(),
      source: "lesson",
    });
    expect(s.bootstrap.status).toBe("idle");
    expect(s.bootstrap.support).toBeNull();
    expect(s.bootstrap.jobId).toBeNull();
  });

  it("setAlphabet changing the data also clears a running job", () => {
    const s = reducer(running(), {
      type: "setAlphabet",
      alphabet: "protein",
    });
    expect(s.bootstrap.status).toBe("idle");
    expect(s.bootstrap.cancelJobId).toBe(7);
  });

  it("Review Focus 2: navigation leaves a running job untouched", () => {
    const s0 = running();
    const before = s0.bootstrap;
    const actions = [
      { type: "step", to: 2 },
      { type: "setMode", mode: "math" as const },
      { type: "setMatrixView", view: "q" as const },
      { type: "setBootstrapView", view: "majority" as const },
      { type: "setReplicateIndex", index: 4 },
      { type: "toggleRerootDisplay" },
      { type: "hover", cell: { i: 0, j: 1 } },
    ];
    let s = s0;
    for (const a of actions) {
      s = reducer(s, a as never);
      expect(s.bootstrap.status, `status after ${a.type}`).toBe("running");
      expect(s.bootstrap.done, `done after ${a.type}`).toBe(40);
      expect(s.bootstrap.total, `total after ${a.type}`).toBe(100);
      expect(s.bootstrap.jobId, `jobId after ${a.type}`).toBe(7);
    }
    expect(s.bootstrap.view).toBe("majority");
    expect(s.bootstrap.replicateIndex).toBe(4);
    expect(s.rerootDisplay).toBe(false);
    // Progress fields never changed hands.
    expect(s.bootstrap.support).toBe(before.support);
  });
});
