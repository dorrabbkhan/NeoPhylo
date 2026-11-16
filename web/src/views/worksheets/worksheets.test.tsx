// Worksheet page, key page and instructor-gate tests (v1.4c plan
// Task 11, spec §7.2). The pinned behaviours: the student sheet never
// shows a key value (in text or hidden DOM), the gate grants once per
// session with the exact storage key, paper is refused for >8 taxa
// with a pointer to the in-app kind, and nothing rendered contains
// NaN/Infinity/undefined.
//
// fetch is stubbed to serve exercises/<id>.json off disk (cwd = web/),
// like the vite exercises plugin — the page tests then run on the
// shipped lessons and labs.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fmt } from "../../explain/math";
import type { Exercise } from "../../engine/generated/Exercise";
import { engine } from "../../engine/index";
import { encode } from "../../state/url";
import {
  companionKey,
  companionSheet,
  paperSheet,
  worksheetRun,
} from "../../worksheets/build";

import { InstructorGate } from "./InstructorGate";
import { INSTRUCTOR_KEY } from "./instructor";
import { KeyPage } from "./KeyPage";
import { worksheetHref } from "./load";
import { WorksheetPage } from "./WorksheetPage";

const EXERCISES = resolve("..", "exercises");

function stubLessonFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const m = /^\/exercises\/([\w.-]+\.json)$/.exec(url);
      const ok = m !== null;
      const body = ok ? readFileSync(resolve(EXERCISES, m![1]), "utf8") : "";
      return Promise.resolve({
        ok,
        status: ok ? 200 : 404,
        text: () => Promise.resolve(body),
      } as Response);
    }),
  );
}

function loadExerciseFile(name: string): Exercise {
  const r = engine.loadExercise(
    readFileSync(resolve(EXERCISES, name), "utf8"),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

/** A seeded location helper: jsdom's window.location via history. */
function setUrl(url: string) {
  history.replaceState(null, "", url);
}

beforeEach(() => {
  window.sessionStorage.clear();
  stubLessonFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUrl("/");
  window.sessionStorage.clear();
});

const FORBIDDEN = /NaN|Infinity|undefined/;

function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("InstructorGate", () => {
  it("shows the labelled modal and no key content before the grant", () => {
    render(
      <InstructorGate workHref="?worksheet=x&kind=app">
        <p>secret answer</p>
      </InstructorGate>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("ws-gate-title");
    expect(bodyText()).toContain(
      "Answer keys are for instructors. Students: work the sheet first.",
    );
    // The key is not merely hidden — it is not in the DOM at all.
    expect(bodyText()).not.toContain("secret answer");
  });

  it("grants once per session under the exact storage key", () => {
    const { unmount } = render(
      <InstructorGate workHref="?worksheet=x&kind=app">
        <p>secret answer</p>
      </InstructorGate>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "I'm an instructor" }),
    );
    expect(bodyText()).toContain("secret answer");
    expect(window.sessionStorage.getItem(INSTRUCTOR_KEY)).toBe("1");
    unmount();
    // A second gate in the same session shows the children directly.
    render(
      <InstructorGate workHref="?worksheet=x&kind=app">
        <p>secret answer</p>
      </InstructorGate>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bodyText()).toContain("secret answer");
  });

  it("shows the dialog every time when storage throws", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const { unmount } = render(
      <InstructorGate workHref="?worksheet=x&kind=app">
        <p>secret answer</p>
      </InstructorGate>,
    );
    expect(screen.getByRole("dialog")).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "I'm an instructor" }),
    );
    // The click still reveals this mount (in-memory state), but the
    // grant cannot persist — the next mount asks again.
    expect(bodyText()).toContain("secret answer");
    unmount();
    render(
      <InstructorGate workHref="?worksheet=x&kind=app">
        <p>secret answer</p>
      </InstructorGate>,
    );
    expect(screen.getByRole("dialog")).not.toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("WorksheetPage kind=paper", () => {
  it("renders nj-by-hand's sheet: matrix, join blocks, blanks, link and QR", async () => {
    setUrl("/?worksheet=nj-by-hand&kind=paper");
    render(<WorksheetPage id="nj-by-hand" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    // The shipped matrix prints, filled.
    const matrix = screen.getByRole("table", {
      name: /distance matrix$/,
    });
    expect(matrix.textContent).toContain("5");
    // One block per hand-worked join (5 taxa → n−2 joins, including
    // NJ's final three-way join).
    const ex = loadExerciseFile("nj-by-hand.json");
    const sheet = paperSheet(ex, "?lesson=nj-by-hand");
    if (sheet === null) throw new Error("sheet missing");
    expect(sheet.handSteps).toBe(3);
    const joinHeads = screen
      .getAllByRole("heading", { level: 2 })
      .filter((h) => /Join \d/.test(h.textContent ?? ""));
    expect(joinHeads.length).toBe(3);
    // Blanks, not answers.
    expect(document.querySelectorAll(".ws-blank").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { level: 2, name: /Finish the tree/ }),
    ).not.toBeNull();
    expect(
      document.querySelector("svg.ws-qr"),
      "a QR code for the exercise link",
    ).not.toBeNull();
    expect(bodyText()).toContain("?lesson=nj-by-hand");
    expect(bodyText()).not.toMatch(FORBIDDEN);
  });

  it("contains no key value in text and no hidden answer nodes", async () => {
    setUrl("/?worksheet=nj-by-hand&kind=paper");
    const { container } = render(
      <WorksheetPage id="nj-by-hand" kind="paper" />,
    );
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const ex = loadExerciseFile("nj-by-hand.json");
    const sheet = paperSheet(ex, "?lesson=nj-by-hand");
    if (sheet === null) throw new Error("sheet missing");
    const dm = engine.matrixToDistances(sheet.matrix);
    if (!dm.ok) throw new Error("dm failed");
    const run = worksheetRun(dm.value, sheet.method);
    if (!run.ok) throw new Error("run failed");
    // Values that also appear in the printed matrix can't leak — only
    // the genuinely key-only numbers are checked.
    const shown = new Set(
      sheet.matrix.lower.map((v) => fmt(v)),
    );
    for (const j of run.value.joins) {
      for (const v of [
        ...(j.row_sums ?? []),
        j.len_i,
        j.len_j,
        ...j.new_distances.map(([, v]) => v),
      ]) {
        const s = fmt(v);
        if (shown.has(s) || s.length < 4) continue;
        expect(
          container.textContent,
          `key value ${s} must not appear`,
        ).not.toContain(s);
      }
      // The joined pair's names as a "a–b" pair must not appear.
      expect(container.textContent).not.toContain(
        `${j.chosen[0]}–${j.chosen[1]}`,
      );
    }
    // No hidden answer nodes: every aria-hidden element is a blank or
    // a rule with empty text.
    for (const el of container.querySelectorAll("[aria-hidden='true']")) {
      expect(el.textContent ?? "").toBe("");
    }
    // The step matrices beyond join 1 would reveal joins — only one
    // filled table (the input matrix) may exist.
    const filled = container.querySelectorAll(
      "table.ws-matrix td:not(.ws-cell-blank)",
    );
    expect(filled.length).toBe(10); // strict lower triangle of 5 taxa
  });

  it("says a >8-taxon exercise has only the in-app worksheet", async () => {
    setUrl("/?worksheet=seqboot-consense&kind=paper");
    render(<WorksheetPage id="seqboot-consense" kind="paper" />);
    await screen.findByText(/too many taxa for a paper worksheet/);
    const link = screen.getByRole("link", {
      name: "Open the in-app worksheet",
    });
    expect(link.getAttribute("href")).toBe(
      "?worksheet=seqboot-consense&kind=app",
    );
  });

  it("shows a clear not-found message for an unknown id", async () => {
    setUrl("/?worksheet=no-such&kind=paper");
    render(<WorksheetPage id="no-such" kind="paper" />);
    await screen.findByText("Worksheet not available");
    expect(bodyText()).toContain("no lesson or lab named");
  });

  it("serves a custom matrix exercise through #x=", async () => {
    const ex = loadExerciseFile("nj-by-hand.json");
    const hash = encode({ v: 3, x: ex, step: 0, mode: "concept" });
    setUrl(`/?worksheet=custom&kind=paper${hash}`);
    render(<WorksheetPage id="custom" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    expect(bodyText()).toContain(ex.title);
    expect(document.querySelector("svg.ws-qr")).not.toBeNull();
  });
});

describe("WorksheetPage kind=app", () => {
  it("renders one item per prompt with no answers", async () => {
    setUrl("/?worksheet=nj-by-hand&kind=app");
    const { container } = render(
      <WorksheetPage id="nj-by-hand" kind="app" />,
    );
    await screen.findByText(/fill this in while you work/i);
    const ex = loadExerciseFile("nj-by-hand.json");
    const sheet = companionSheet(ex);
    const items = container.querySelectorAll(".ws-item");
    expect(items.length).toBe(sheet.items.length);
    expect(container.querySelectorAll(".ws-answer").length).toBe(0);
    // Ruled writing space, not filled answers.
    expect(container.querySelectorAll(".ws-rule").length).toBeGreaterThan(0);
    expect(bodyText()).not.toMatch(FORBIDDEN);
  });
});

describe("KeyPage", () => {
  it("asks the gate once, then shows the paper key's engine values", async () => {
    setUrl("/?key=nj-by-hand&kind=paper");
    render(<KeyPage id="nj-by-hand" kind="paper" />);
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "I'm an instructor" }),
    );
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const ex = loadExerciseFile("nj-by-hand.json");
    const sheet = paperSheet(ex, "?lesson=nj-by-hand");
    if (sheet === null) throw new Error("sheet missing");
    const dm = engine.matrixToDistances(sheet.matrix);
    if (!dm.ok) throw new Error("dm failed");
    const run = worksheetRun(dm.value, sheet.method);
    if (!run.ok) throw new Error("run failed");
    const j1 = run.value.joins[0];
    expect(bodyText()).toContain(
      `Joins: ${j1.chosen[0]}–${j1.chosen[1]}`,
    );
    // Row sums rendered.
    if (j1.row_sums !== null) {
      expect(bodyText()).toContain(`R(`);
      expect(bodyText()).toContain(fmt(j1.row_sums[0]));
    }
    // Mistakes list (nj-by-hand's first join is not the closest pair).
    expect(bodyText()).toContain("Common mistakes");
    expect(bodyText()).toContain("because their distance is smallest");
    // The finished tree.
    expect(
      document.querySelector("figure svg, svg[aria-label='The finished tree']"),
    ).not.toBeNull();
    expect(bodyText()).not.toMatch(FORBIDDEN);
  });

  it("does not ask the gate again in the same session", async () => {
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
    setUrl("/?key=nj-by-hand&kind=paper");
    render(<KeyPage id="nj-by-hand" kind="paper" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
  });

  it("renders a bootstrap lab's companion key with the caption", async () => {
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
    setUrl("/?key=seqboot-consense&kind=app");
    render(<KeyPage id="seqboot-consense" kind="app" />);
    await screen.findByText(
      "Your numbers from MEGA or PHYLIP will differ by sampling noise.",
    );
    expect(bodyText()).toContain("replicate trees");
    expect(bodyText()).not.toMatch(FORBIDDEN);
  });
});

describe("worksheetHref", () => {
  it("keeps the #x= fragment for custom exercises", () => {
    setUrl("/?key=custom&kind=paper#x=abc123");
    expect(worksheetHref("custom", "paper")).toBe(
      "?worksheet=custom&kind=paper#x=abc123",
    );
    expect(worksheetHref("nj-by-hand", "paper")).toBe(
      "?worksheet=nj-by-hand&kind=paper",
    );
  });
});

describe("companion sheet/key parity", () => {
  it("the app sheet has no answer text the key would show", async () => {
    const ex = loadExerciseFile("nj-by-hand.json");
    const sheet = companionSheet(ex);
    const key = companionKey(sheet, ex, { joins: null, bootstrap: null });
    setUrl("/?worksheet=nj-by-hand&kind=app");
    const { container } = render(
      <WorksheetPage id="nj-by-hand" kind="app" />,
    );
    await screen.findByText(/fill this in while you work/i);
    for (const answer of key.answers) {
      if (answer === null) continue;
      expect(container.textContent).not.toContain(answer);
    }
    await waitFor(() => expect(bodyText()).not.toMatch(FORBIDDEN));
  });
});
