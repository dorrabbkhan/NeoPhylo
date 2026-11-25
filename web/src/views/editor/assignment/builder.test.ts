// Assignment-builder helper tests (v1.5 plan Task 7, spec §6/§5.3).
// The pins: task labels are plain words ("Q-value of the pair joined
// at step 2"), the builder refuses >15 graded tasks and a worst-case
// completion code over 250 characters with the reason shown, and a
// `builtin` content block probes the engine with the served file
// text injected (never saved into the link).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { engine } from "../../../engine/index";
import type { GradedTask } from "../../../engine/generated/GradedTask";
import type { TaskRef } from "../../../engine/generated/TaskRef";

import {
  assignmentFile,
  defaultBuilderDraft,
  formatAccepted,
  joinCount,
  probeJson,
  refusals,
  resolveContent,
  servedLabels,
  taskLabel,
  validateBuilderDraft,
} from "./builder";

const numericTask = (step: number): TaskRef => ({
  kind: "numeric",
  step,
  quantity: "q_value",
  role: "chosen",
});

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("taskLabel — plain-word task names (spec §6)", () => {
  it("names predict_pair, predict_branch and numeric tasks by step, quantity and role", () => {
    expect(taskLabel({ kind: "predict_pair", step: 2 }, null)).toBe(
      "Predict the pair joined at step 2",
    );
    expect(taskLabel({ kind: "predict_branch" }, null)).toBe(
      "Predict the least-supported grouping",
    );
    expect(taskLabel(numericTask(2), null)).toBe(
      "Q-value of the pair joined at step 2",
    );
    expect(
      taskLabel(
        {
          kind: "numeric",
          step: 1,
          quantity: "branch_length",
          role: "chosen_first_to_new",
        },
        null,
      ),
    ).toBe(
      "Branch length of the first member's branch to the new node at step 1",
    );
    expect(
      taskLabel(
        { kind: "numeric", step: 3, quantity: "new_distance", role: "closest_raw" },
        null,
      ),
    ).toBe("New distance of the closest pair at step 3");
  });
});

describe("resolveContent — a built-in lesson (spec §6)", () => {
  it("loads the served file, records its hash and knows the title", async () => {
    const r = await resolveContent({ kind: "builtin", id: "nj-basics" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.exercise?.id).toBe("nj-basics");
    expect(r.value.reading).toBeNull();
    expect(r.value.title).toContain("Neighbor-Joining");
    const authored = r.value.authored;
    expect("builtin" in authored && authored.builtin).toBe("nj-basics");
    if ("builtin" in authored) {
      const hash = engine.contentHash(r.value.fileText ?? "");
      expect(hash.ok).toBe(true);
      if (hash.ok) expect(authored.content_hash).toBe(hash.value);
    }
    expect(r.value.fileText).not.toBeNull();
  });

  it("reports an unknown built-in id", async () => {
    const r = await resolveContent({ kind: "builtin", id: "no-such" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no-such/);
  });

  it("a pasted exercise file embeds the file object as content", async () => {
    const file = {
      schema_version: 3,
      id: "tiny",
      title: "Tiny",
      alphabet: "dna",
      data: {
        kind: "embedded",
        fasta: ">A\nACGT\n>B\nACGA\n>C\nTCGT\n",
        source: { citation: "test", license: "CC0 1.0", accessions: [] },
      },
      analysis: { method: "NJ", correction: "JC69" },
      locked: [],
      prompts: [],
    };
    const r = await resolveContent({ kind: "file", file });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.exercise?.id).toBe("tiny");
    expect("exercise" in r.value.authored).toBe(true);
    expect(r.value.fileText).toBeNull();
  });
});

describe("assignmentFile / probeJson — the authored file vs the probe", () => {
  it("the authored builtin content keeps just id + hash; the probe injects file", async () => {
    const r = await resolveContent({ kind: "builtin", id: "nj-basics" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const draft = {
      ...defaultBuilderDraft(),
      content: { kind: "builtin", id: "nj-basics" } as const,
      title: "Homework 3",
      tasks: [{ task: { kind: "predict_pair", step: 1 } as TaskRef, points: 1 }],
    };
    const file = assignmentFile(draft, r.value, true);
    expect(file.kind).toBe("assignment");
    expect(file.content).toEqual(r.value.authored);
    // The saved shape never carries the served text…
    expect(JSON.stringify(file)).not.toContain("file");
    // …the probe JSON does, and the engine accepts it.
    const loaded = engine.loadAssignment(probeJson(file, r.value.fileText));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.content.kind).toBe("exercise");
      expect(loaded.value.variation).toBe(true);
    }
  });
});

describe("servedLabels / joinCount — what a variant shows", () => {
  it("a matrix exercise serves its names; join count is taxa − 1", async () => {
    const r = await resolveContent({
      kind: "builtin",
      id: "upgma-vs-nj-matrix",
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.exercise === null) return;
    const labels = servedLabels(r.value.content);
    expect(labels).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(joinCount(r.value.exercise)).toBe(5);
  });

  it("a simulated variant serves the permuted tip order", async () => {
    const r = await resolveContent({ kind: "builtin", id: "nj-basics" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const draft = {
      ...defaultBuilderDraft(),
      content: { kind: "builtin", id: "nj-basics" } as const,
      title: "x",
      tasks: [{ task: { kind: "predict_pair", step: 1 } as TaskRef, points: 1 }],
    };
    const file = assignmentFile(draft, r.value, true);
    const json = probeJson(file, r.value.fileText);
    const v = engine.makeVariant(json, "student-1");
    expect(v.ok).toBe(true);
    if (!v.ok || v.value.content.kind !== "exercise") return;
    const labels = servedLabels(v.value.content);
    expect(labels).toHaveLength(6);
    expect([...labels].sort()).toEqual(
      [...servedLabels(r.value.content)].sort(),
    );
  });
});

describe("formatAccepted — the engine answer in plain text", () => {
  it("pairs show names, numbers honour the precision table", () => {
    expect(
      formatAccepted(
        { kind: "pairs", value: [[0, 1]] },
        ["A", "B", "C"],
      ),
    ).toBe("A + B");
    const p = engine.precision();
    expect(p.ok).toBe(true);
    const decimals = p.ok
      ? (p.value.find(([q]) => q === "q_value")?.[1] ?? 2)
      : 2;
    expect(
      formatAccepted(
        { kind: "number", value: 125 * 10 ** decimals },
        [],
        decimals,
      ),
    ).toBe((125).toFixed(decimals));
  });
});

describe("refusals — what the builder refuses with the reason (spec §6)", () => {
  it("refuses more than 15 graded tasks", async () => {
    const tasks: GradedTask[] = Array.from({ length: 16 }, (_, i) => ({
      task: numericTask((i % 5) + 1),
      points: 1,
    }));
    const reasons = refusals({
      title: "HW",
      tasks,
      loadError: null,
      codeLen: null,
      hasContent: true,
    });
    expect(reasons.join(" ")).toMatch(/at most 15/);
  });

  it("refuses a worst-case completion code over 250 characters", () => {
    const reasons = refusals({
      title: "HW",
      tasks: [{ task: numericTask(1), points: 1 }],
      loadError: null,
      codeLen: 291,
      hasContent: true,
    });
    expect(reasons.join(" ")).toMatch(/291/);
    expect(reasons.join(" ")).toMatch(/250/);
  });

  it("refuses an empty task list and a missing title", () => {
    const reasons = refusals({
      title: "",
      tasks: [],
      loadError: null,
      codeLen: 100,
      hasContent: true,
    });
    expect(reasons.join(" ")).toMatch(/title/i);
    expect(reasons.join(" ")).toMatch(/at least one/);
  });
});

describe("validateBuilderDraft — the stored draft", () => {
  it("round-trips a full draft and rejects junk", () => {
    const d = defaultBuilderDraft();
    d.title = "Homework 3";
    d.tasks = [{ task: numericTask(1), points: 2 }];
    const parsed = validateBuilderDraft(JSON.parse(JSON.stringify(d)));
    expect(parsed).toEqual(d);
    expect(validateBuilderDraft(null)).toBeNull();
    expect(validateBuilderDraft({ v: 1 })).toBeNull();
    expect(
      validateBuilderDraft({ ...d, tasks: "nope" }),
    ).toBeNull();
  });
});
