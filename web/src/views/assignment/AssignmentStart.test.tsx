// AssignmentStart integration tests (v1.5 plan Task 8, spec §5.6,
// §7.1–7.3): the start page, the graded-task gate inside the lesson,
// practice/test modes, Finish's code and reload resume — all against
// the real wasm engine (checkTask/taskKey/encodeCode/decodeCode).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engine } from "../../engine";
import type { TaskRef } from "../../engine/generated/TaskRef";
import {
  encodeAssignmentLink,
  type AssignmentFile,
} from "../../assess/url";

import { AssignmentStart } from "./AssignmentStart";

const NJ_BASICS = JSON.parse(
  readFileSync(resolve("..", "exercises", "nj-basics.json"), "utf8"),
) as unknown;

const PAIR1: TaskRef = { kind: "predict_pair", step: 1 };
const QNUM1: TaskRef = {
  kind: "numeric",
  step: 1,
  quantity: "q_value",
  role: "chosen",
};

function file(mode: "practice" | "test", tasks: TaskRef[]): AssignmentFile {
  return {
    schema_version: 1,
    kind: "assignment",
    id: `t8-${mode}-${tasks.length}`,
    title: "Test assignment",
    content: { exercise: NJ_BASICS },
    id_prompt: { label: "student number", rule: "trim_lower" },
    mode,
    variation: true,
    tasks: tasks.map((task) => ({ task })),
  };
}

let resolvedJson = "";

function setLink(f: AssignmentFile) {
  window.history.replaceState(null, "", `/${encodeAssignmentLink(f)}`);
}

/** The variant + accepted answers the wasm engine computes — the
 *  tests never judge answers themselves. */
async function variantAndKey(id: string, task: TaskRef) {
  const mk = engine.makeVariant(resolvedJson, id);
  expect(mk.ok).toBe(true);
  if (!mk.ok) throw new Error("makeVariant failed");
  const key = engine.taskKey(mk.value, task);
  expect(key.ok).toBe(true);
  if (!key.ok) throw new Error("taskKey failed");
  return { variant: mk.value, key: key.value };
}

const idInput = () =>
  screen.getByLabelText(/student number/i) as HTMLInputElement;
const startBtn = () => screen.getByRole("button", { name: "Start" });
const nextButton = () =>
  screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement;
const cell = (i: number, j: number) =>
  document.querySelector(`[data-i="${i}"][data-j="${j}"]`)!;
const clickCell = (i: number, j: number) =>
  fireEvent.keyDown(cell(i, j), { key: "Enter" });

async function enter(f: AssignmentFile, id: string) {
  setLink(f);
  // Resolve once so the tests can ask the engine for keys.
  const { resolveAssignmentLink } = await import("../../assess/url");
  const r = await resolveAssignmentLink(window.location.href);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("link failed");
  resolvedJson = r.value.json;
  render(<AssignmentStart embed={false} />);
  await screen.findByRole("button", { name: "Start" });
  fireEvent.change(idInput(), { target: { value: id } });
  fireEvent.click(startBtn());
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe("assignment start page", () => {
  it("shows the title and ID prompt; an empty id is refused", async () => {
    setLink(file("practice", [PAIR1]));
    render(<AssignmentStart embed={false} />);
    await screen.findByRole("heading", { name: "Test assignment" });
    fireEvent.click(startBtn());
    expect(screen.getByRole("alert").textContent).toContain(
      "student number",
    );
  });

  it("a broken link shows the load error, not a crash", async () => {
    window.history.replaceState(null, "", "/#a=zzz");
    render(<AssignmentStart embed={false} />);
    await screen.findByRole("alert");
  });
});

describe("practice mode — predict_pair gating", () => {
  it("gates Next until answered, checks wrong then right, commits on advance", async () => {
    await enter(file("practice", [PAIR1]), "sara");
    // The graded card sits at position 0 and Next is gated.
    await screen.findByText(/Predict the pair joined at step 1/);
    expect(nextButton().disabled).toBe(true);
    // The answer cell is unmarked while the task is open.
    expect(
      document.querySelector('[role="gridcell"][aria-selected="true"]'),
    ).toBeNull();

    const { key } = await variantAndKey("sara", PAIR1);
    if (key.kind !== "pairs") throw new Error("expected pairs");
    const [ra, rb] = key.value[0];
    // A wrong pick first — two tips not in the accepted list.
    const wrong: [number, number] =
      ra === 0 && rb === 1 ? [2, 3] : [0, 1];
    clickCell(wrong[0], wrong[1]);
    const check = screen.getByRole("button", { name: "Check" });
    fireEvent.click(check);
    expect(screen.getByText("Not quite — try again.")).toBeTruthy();
    // Retry: the correct cell answers and the verdict flips.
    clickCell(ra, rb);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("Correct.")).toBeTruthy();

    // Next commits: the card locks and position 1 has no gate.
    fireEvent.click(nextButton());
    await screen.findByText(/step 1 of/);
    expect(screen.queryByText(/Predict the pair joined/)).toBeNull();
  });
});

describe("numeric task hiding", () => {
  it("hides the explanation and the Q view while open", async () => {
    await enter(file("test", [QNUM1]), "sara");
    await screen.findByText(/Q-value/);
    // The explanation is withheld ("Make your prediction first") —
    // it names the pending pair and shows Q values.
    expect(
      screen.getByText(/Make your prediction first/),
    ).toBeTruthy();
    // The distance matrix stays visible (the inputs stay on screen).
    expect(
      screen.getByRole("grid", { name: "Distance matrix" }),
    ).toBeTruthy();
    // …but no cell is marked the answer.
    expect(
      document.querySelector('[role="gridcell"][aria-selected="true"]'),
    ).toBeNull();
    // The Q toggle is gated — the Q matrix would hand the answer.
    const qToggle = screen.getByRole("switch", {
      name: /Distance \/ Q/,
    }) as HTMLButtonElement;
    expect(qToggle.disabled).toBe(true);

    // Answer with the engine's own value; the lesson's own
    // predict_pair prompt also gates this position — answer it too.
    const { key } = await variantAndKey("sara", QNUM1);
    if (key.kind !== "number") throw new Error("expected number");
    fireEvent.change(
      screen.getByLabelText(/your answer/i),
      { target: { value: (key.value / 1000).toFixed(3) } },
    );
    const pk = await variantAndKey("sara", PAIR1);
    if (pk.key.kind !== "pairs") throw new Error("expected pairs");
    clickCell(pk.key.value[0][0], pk.key.value[0][1]);
    expect(nextButton().disabled).toBe(false);
    fireEvent.click(nextButton());
    await screen.findByText(/step 1 of/);
    // Committed: the explanation returns.
    expect(
      screen.queryByText(/Make your prediction first/),
    ).toBeNull();
  });
});

describe("test mode", () => {
  it("shows no verdict before Finish and no score question after", async () => {
    await enter(file("test", [PAIR1]), "sara");
    await screen.findByText(/Predict the pair joined at step 1/);
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
    const { key } = await variantAndKey("sara", PAIR1);
    if (key.kind !== "pairs") throw new Error("expected pairs");
    clickCell(key.value[0][0], key.value[0][1]);
    expect(screen.queryByText("Correct.")).toBeNull();
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText(/NP1-/);
    expect(
      screen.getByText(/answers are recorded in the completion code/i),
    ).toBeTruthy();
  });
});

describe("finish and code", () => {
  it("the code decodes to first=wrong, last=right, attempts=2", async () => {
    await enter(file("practice", [PAIR1]), "sara");
    await screen.findByText(/Predict the pair/);
    const { key } = await variantAndKey("sara", PAIR1);
    if (key.kind !== "pairs") throw new Error("expected pairs");
    const [ra, rb] = key.value[0];
    const wrong: [number, number] =
      ra === 0 && rb === 1 ? [2, 3] : [0, 1];
    clickCell(wrong[0], wrong[1]);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    clickCell(ra, rb);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const codeEl = await screen.findByText(/NP1-/);
    const code = codeEl.textContent!;
    const dec = engine.decodeCode(code);
    expect(dec.ok).toBe(true);
    if (!dec.ok) throw new Error("decode failed");
    const at = dec.value.attempts[0];
    expect(at.attempts).toBe(2);
    expect(at.first).toEqual({ kind: "pair", value: wrong });
    expect(at.last).toEqual({ kind: "pair", value: [ra, rb] });
    // Practice shows the score.
    expect(screen.getByText(/Score:/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Copy/ }),
    ).toBeTruthy();
  });

  it("reopening the link restores the same code", async () => {
    const f = file("practice", [PAIR1]);
    await enter(f, "sara");
    await screen.findByText(/Predict the pair/);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const code = (await screen.findByText(/NP1-/)).textContent;
    cleanup();
    render(<AssignmentStart embed={false} />);
    const again = await screen.findByText(/NP1-/);
    expect(again.textContent).toBe(code);
  });
});

describe("storage blocked", () => {
  it("still finishes and shows the notice", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await enter(file("practice", [PAIR1]), "sara");
    await screen.findByText(/progress won't survive a reload/i);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText(/NP1-/);
    vi.restoreAllMocks();
  });
});
