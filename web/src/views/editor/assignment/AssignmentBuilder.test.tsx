// The assignment builder (v1.5 plan Task 7, spec §6) — component
// tests for the parts the e2e can't reach quickly:
//
// - the owner's variation ruling (PR #187, chat 2026-11-25): content
//   whose prose names taxa (engine `prose_names_taxa`) defaults the
//   toggle OFF and warns on enable, listing the 1-based prompt
//   numbers — `nj-basics` names taxa in prompt 2, `upgma-vs-nj-matrix`
//   does not;
// - the draft restore a reload depends on (spec §9.1);
// - the spec's hard refusals: >15 graded tasks, a >250-char
//   completion code, and the paste-your-own content path a library
//   card can't seed.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../../../editor/draft";
import type { GradedTask } from "../../../engine/generated/GradedTask";
import type { TaskRef } from "../../../engine/generated/TaskRef";

import { AssignmentBuilder } from "./AssignmentBuilder";
import { defaultBuilderDraft } from "./builder";
import type { BuilderDraft } from "./builder";

const VARIATION = "Each student gets their own variation";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** A stored builder draft — what a reload leaves behind. */
function seedDraft(patch: Partial<BuilderDraft>): void {
  window.localStorage.setItem(
    "neophylo:draft:assignment",
    JSON.stringify({ ...defaultBuilderDraft(), ...patch }),
  );
}

const numeric = (step: number): TaskRef => ({
  kind: "numeric",
  step,
  quantity: "q_value",
  role: "chosen",
});

describe("AssignmentBuilder — variation default (owner decision 2026-11-25)", () => {
  it("nj-basics: prose names taxa → variation off; enabling warns listing prompt 2", async () => {
    render(<AssignmentBuilder initialBuiltin="nj-basics" />);
    const toggle = (await screen.findByRole("checkbox", {
      name: VARIATION,
    })) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(false));
    fireEvent.click(toggle);
    const warning = await screen.findByText(/notes name specific taxa/i);
    expect(warning.textContent).toMatch(/prompt 2/i);
  });

  it("upgma-vs-nj-matrix: no naming prose → variation on, no warning", async () => {
    render(<AssignmentBuilder initialBuiltin="upgma-vs-nj-matrix" />);
    const toggle = (await screen.findByRole("checkbox", {
      name: VARIATION,
    })) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(
      screen.queryByText(/notes name specific taxa/i),
    ).toBeNull();
    // The matrix is fixed data — variation relabels but every
    // student's numbers are the same (spec §6's notice).
    expect(
      await screen.findByText(/every student gets the same data/i),
    ).toBeTruthy();
  });
});

describe("AssignmentBuilder — draft restore (spec §9.1)", () => {
  it("a stored draft restores title, mode and checked tasks", async () => {
    seedDraft({
      content: { kind: "builtin", id: "nj-basics" },
      title: "Homework 3",
      mode: "test",
      tasks: [
        { task: { kind: "predict_pair", step: 3 }, points: 1 },
        { task: numeric(1), points: 3 },
      ],
    });
    render(<AssignmentBuilder />);
    const title = await screen.findByRole("textbox", {
      name: "Assignment title",
    });
    expect((title as HTMLInputElement).value).toBe("Homework 3");
    expect(
      (
        (await screen.findByRole("radio", {
          name: /^test/i,
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("checkbox", {
            name: /Predict the pair joined at step 3/i,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});

describe("AssignmentBuilder — spec refusals", () => {
  it("refuses more than 15 graded tasks with the reason", async () => {
    seedDraft({
      content: { kind: "builtin", id: "nj-basics" },
      title: "HW",
      tasks: Array.from({ length: 16 }, (_, i): GradedTask => ({
        task: numeric((i % 5) + 1),
        points: 1,
      })),
    });
    render(<AssignmentBuilder />);
    expect(await screen.findByText(/at most 15/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Copy link",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("refuses a worst-case completion code over 250 chars with the count", async () => {
    seedDraft({
      content: { kind: "builtin", id: "nj-basics" },
      title: "HW",
      tasks: Array.from({ length: 8 }, (_, i): GradedTask => ({
        task: {
          kind: "numeric",
          step: (i % 5) + 1,
          quantity: (["q_value", "branch_length", "new_distance", "corrected_distance"] as const)[i % 4],
          role: "chosen",
        },
        points: 1,
      })),
    });
    render(<AssignmentBuilder />);
    expect(await screen.findByText(/250/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Copy link",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("AssignmentBuilder — sample students (spec §6)", () => {
  it("three sample students get different data and the engine's answers", async () => {
    seedDraft({
      content: { kind: "builtin", id: "nj-basics" },
      title: "HW",
      tasks: [{ task: { kind: "predict_pair", step: 1 }, points: 1 }],
    });
    render(<AssignmentBuilder />);
    const cards = await waitFor(() => {
      const c = screen.getAllByRole("article");
      expect(c).toHaveLength(3);
      return c;
    });
    const prints = cards.map((c) => c.textContent ?? "");
    // Every card shows the served data order — three students, three
    // different shuffles (deterministic per assignment id + name).
    expect(new Set(prints).size).toBe(3);
    for (const c of cards) {
      expect(c.textContent).toMatch(/Predict the pair joined at step 1/);
    }
  });
});

describe("AssignmentBuilder — the exercise in the editor draft", () => {
  it("resolves the stored exercise draft as content", async () => {
    window.localStorage.setItem(
      "neophylo:draft:exercise",
      JSON.stringify({
        v: 1,
        n: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
        s: { ...DEFAULT_SETTINGS, id: "draft-ex", title: "Draft exercise" },
        p: [],
        x: null,
        r: {},
      }),
    );
    render(<AssignmentBuilder />);
    const select = await screen.findByRole("combobox", {
      name: "Assignment content",
    });
    fireEvent.change(select, {
      target: { value: "exercise-draft" },
    });
    // The draft's own title seeds the assignment title.
    expect(
      await screen.findByDisplayValue(/Draft exercise/i),
    ).toBeTruthy();
  });
});
