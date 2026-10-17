// Guided-lesson prompt tests (plan Task 21, spec §6.2): the default
// lesson carries a predict_pair prompt at join step 1 (stepper position
// 0) and a note at join step 3 (position 2). While a predict prompt is
// unanswered the stepper is gated — buttons, slider and ←/→ — and the
// correct pair is not marked. A matrix-cell click or two leaf clicks
// answers it; the card shows "Correct" or reveals the right pair, then
// stepping works again.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { engine } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import type { NjStep } from "../engine/generated/NjStep";
import { defaultLessonJson } from "../lessons/default";
import { nodeName } from "../state/names";
import { initialSession, reducer } from "../state/session";
import { pressKey } from "../test/keys";
import { App } from "./App";

afterEach(cleanup);

const exercise = (): Exercise => {
  const r = engine.loadExercise(defaultLessonJson);
  if (!r.ok) throw new Error("default lesson failed to parse");
  return r.value;
};

/** The pair pending join `join` (1-based) will pick, as [cell indices,
 * cluster labels] into that step's active-cluster matrix. */
function joinAt(
  ex: Exercise,
  join: number,
): {
  chosen: [number, number];
  labels: [string, string];
} {
  const s = reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
  const trace = s.result!.trace!;
  if (!("Nj" in trace)) throw new Error("expected an NJ trace");
  const step: NjStep = trace.Nj.steps[join - 1];
  const [ci, cj] = step.chosen;
  const labels = [step.active[ci], step.active[cj]].map((id) =>
    nodeName(s.result!.tree, id),
  ) as [string, string];
  return { chosen: [ci, cj], labels };
}

const firstJoin = (ex: Exercise) => joinAt(ex, 1);

// The first predict_pair prompt's question text, from the lesson itself
// so the tests survive lesson rewording.
const firstQuestion = () => exercise().prompts[0].concept;

const grid = () => screen.getByRole("grid", { name: "Distance matrix" });
const cell = (i: number, j: number) =>
  grid().querySelector(`[data-i="${i}"][data-j="${j}"]`)!;

const nextButton = () =>
  screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement;
const prevButton = () =>
  screen.getByRole("button", { name: "Previous step" }) as HTMLButtonElement;
const slider = () => screen.getByRole("slider") as HTMLInputElement;

function leafText(title: string, label: string): Element {
  const svg = document.querySelector(`svg[aria-label="${title}"]`)!;
  const el = Array.from(svg.querySelectorAll("text")).find(
    (t) => t.textContent === label,
  );
  if (!el) throw new Error(`leaf "${label}" not found in ${title}`);
  return el;
}

describe("lesson prompts", () => {
  it("survives re-renders while the wasm session is loading", async () => {
    // Regression: an unstable `?? []` prompts default made the gate's
    // reset condition true forever, so any extra render during the
    // loading window (the browser's ResizeObserver fires one) looped
    // setState during render → "Too many re-renders".
    const { rerender } = render(<App />);
    rerender(<App />);
    rerender(<App />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await screen.findByText(firstQuestion());
  });

  it("gates the stepper at a predict_pair step until a pick", async () => {
    render(<App />);
    await screen.findByText(firstQuestion());
    expect(nextButton().disabled).toBe(true);
    expect(prevButton().disabled).toBe(true);
    expect(slider().disabled).toBe(true);
    // Arrow keys are gated too.
    await pressKey("ArrowRight");
    expect(screen.getByText(/step 0 of/)).toBeTruthy();
    // The answer is not marked while the question is open.
    expect(grid().querySelector('[aria-selected="true"]')).toBeNull();
  });

  it("shows Correct after picking the joining cell", async () => {
    const ex = exercise();
    const { chosen } = firstJoin(ex);
    render(<App exercise={ex} />);
    await screen.findByText(firstQuestion());
    fireEvent.keyDown(cell(chosen[0], chosen[1]), { key: "Enter" });
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(nextButton().disabled).toBe(false);
    // Stepping forward reveals the join that was just predicted.
    fireEvent.click(nextButton());
    expect(screen.getByText(/step 1 of/)).toBeTruthy();
  });

  it("reveals the right pair after a wrong pick", async () => {
    const ex = exercise();
    const { chosen, labels } = firstJoin(ex);
    render(<App exercise={ex} />);
    await screen.findByText(firstQuestion());
    let p = 0;
    let q = 1;
    while (p === chosen[0] && q === chosen[1]) {
      q += 1;
      if (q > 5) {
        p += 1;
        q = p + 1;
      }
    }
    fireEvent.click(cell(p, q));
    expect(
      screen.getByText(
        `Not quite: the answer is ${labels[0]} and ${labels[1]}.`,
      ),
    ).toBeTruthy();
    expect(nextButton().disabled).toBe(false);
  });

  it("accepts two leaf clicks as a pick", async () => {
    const ex = exercise();
    const { labels } = firstJoin(ex);
    render(<App exercise={ex} />);
    await screen.findByText(firstQuestion());
    fireEvent.click(leafText("Inferred tree", labels[0]));
    fireEvent.click(leafText("Inferred tree", labels[1]));
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(nextButton().disabled).toBe(false);
  });

  it("shows the closing note at the final step without gating", async () => {
    const ex = exercise();
    render(<App exercise={ex} />);
    await screen.findByText(firstQuestion());
    // Answer the predict_pair prompts at positions 0 and 2 (joins 1 and
    // 3); the closing note lives at the final position.
    for (const join of [1, 3]) {
      const { chosen } = joinAt(ex, join);
      fireEvent.keyDown(cell(chosen[0], chosen[1]), { key: "Enter" });
      fireEvent.click(nextButton());
      fireEvent.click(nextButton());
    }
    expect(screen.getByText(/step 4 of 4/)).toBeTruthy();
    const note = ex.prompts.find((p) => p.type === "note");
    expect(note).toBeDefined();
    expect(screen.getByText(note!.concept)).toBeTruthy();
    // At the end there is nowhere to go — Next stays disabled, but for
    // the boundary reason, not the gate (the note never gates).
    expect(nextButton().disabled).toBe(true);
    expect(prevButton().disabled).toBe(false);
  });

  it("disables a locked analysis.method select with the lesson tooltip", async () => {
    render(<App />);
    const method = (await screen.findByLabelText(
      "Tree-building method",
    )) as HTMLSelectElement;
    expect(method.disabled).toBe(true);
    expect(method.title).toBe("Fixed for this lesson.");
  });
});
