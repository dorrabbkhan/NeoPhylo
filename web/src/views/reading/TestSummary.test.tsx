// TestSummary tests (v1.4d plan Task 8, spec §4.4): the finish screen
// shows the score and each item's engine explanation — never a
// TypeScript-computed correctness of its own.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../../engine/index";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import type { Response } from "../../engine/generated/Response";

import { TestSummary } from "./TestSummary";

function loadDemo(): ReadingSet {
  const r = engine.loadReadingSet(
    readFileSync(
      resolve("..", "exercises", "reading", "trees-demo.json"),
      "utf8",
    ),
  );
  if (!r.ok) throw new Error("demo set refused");
  return r.value;
}

const DEMO = loadDemo();

afterEach(cleanup);

describe("TestSummary", () => {
  it("reports the score and one explanation per item", () => {
    const set: ReadingSet = {
      ...DEMO,
      mode: "test",
      items: DEMO.items.slice(0, 2),
    };
    const responses: (Response | null)[] = [
      { kind: "choice", index: 2 }, // right — Tree 3 differs
      { kind: "choice", index: 0 }, // wrong — the two drawings agree
    ];
    render(
      <TestSummary set={set} responses={responses} onRestart={() => {}} />,
    );
    expect(screen.getByText(/1 of 2/i)).toBeTruthy();
    // One verdict+explanation block per item.
    const items = screen.getAllByText(/correct/i);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // The explanations name the trees — engine-authored text.
    expect(screen.getByText(/mammals-diff/i)).toBeTruthy();
  });

  it("marks unanswered items as incorrect", () => {
    const set: ReadingSet = {
      ...DEMO,
      mode: "test",
      items: DEMO.items.slice(0, 2),
    };
    render(
      <TestSummary
        set={set}
        responses={[null, null]}
        onRestart={() => {}}
      />,
    );
    expect(screen.getByText(/0 of 2/i)).toBeTruthy();
    expect(screen.getAllByText(/not answered|no answer/i).length).toBe(2);
  });

  it("Start again runs the restart callback", () => {
    const onRestart = vi.fn();
    render(
      <TestSummary
        set={{ ...DEMO, items: DEMO.items.slice(0, 1) }}
        responses={[null]}
        onRestart={onRestart}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /start again|restart|try again/i }),
    );
    expect(onRestart).toHaveBeenCalled();
  });
});
