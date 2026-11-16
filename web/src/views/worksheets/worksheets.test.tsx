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
import { decode, encode } from "../../state/url";
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
import { joinContext } from "./steps";
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

  it("names no cluster in joins after the first — the names are write-in blanks", async () => {
    // Fix round 1, R1: listing the join-k≥2 active clusters (or labelling
    // that join's tables with them) tells the student which pair the
    // previous join merged. Join 1 keeps the original names; later
    // joins show "Clusters in play:" with a ruled blank, the same grid
    // shape with empty header cells, and no surviving-cluster label —
    // only new-node names ("Branch length to u2") may stay.
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const id of ["nj-by-hand", "upgma-vs-nj-matrix"]) {
      setUrl(`/?worksheet=${id}&kind=paper`);
      const { unmount } = render(<WorksheetPage id={id} kind="paper" />);
      await screen.findByRole("heading", {
        level: 2,
        name: "1. The distance matrix",
      });
      const ex = loadExerciseFile(`${id}.json`);
      const sheet = paperSheet(ex, `?lesson=${id}`);
      if (sheet === null) throw new Error(`${id}: sheet missing`);
      const dm = engine.matrixToDistances(sheet.matrix);
      if (!dm.ok) throw new Error("dm failed");
      const run = worksheetRun(dm.value, sheet.method);
      if (!run.ok) throw new Error("run failed");
      const join1Header = new Set(sheet.matrix.names);
      for (const j of run.value.joins.slice(1)) {
        const ctx = joinContext(run.value, j.step);
        const section = document
          .getElementById(`ws-join-${j.step}`)!
          .closest("section")!;
        // Same-shaped grids, but every header cell is a write-in blank
        // and no u<n> appears inside a table.
        const tables = section.querySelectorAll("table");
        expect(tables.length, `${id} join ${j.step}`).toBeGreaterThan(0);
        for (const table of tables) {
          for (const th of table.querySelectorAll("th")) {
            expect(
              (th.textContent ?? "").trim(),
              `${id} join ${j.step} header`,
            ).toBe("");
          }
          expect(
            table.textContent,
            `${id} join ${j.step} table`,
          ).not.toMatch(/u\d/);
        }
        // "Clusters in play:" is a ruled blank, not the name list.
        const cp = section.querySelector(".ws-clusters");
        expect(
          cp?.textContent?.replace(/\s+/g, " ").trim(),
          `${id} join ${j.step} clusters line`,
        ).toBe("Clusters in play:");
        // No surviving-cluster label the key shows for this join may
        // appear — join-1 header names and the new-node name are exempt.
        for (const n of ctx.active) {
          if (join1Header.has(n)) continue;
          expect(
            section.textContent,
            `${id} join ${j.step} names ${n}`,
          ).not.toMatch(new RegExp(`\\b${esc(n)}\\b`));
        }
      }
      unmount();
    }
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

  it("join 2's closest pair is tied with the join — 'also correct', no mistake", async () => {
    // Fix round 1, R2: at nj-by-hand join 2 the closest pair d–e is
    // in JoinFacts.tied — picking it is a correct answer, so the key
    // says so and no mistake line exists for it.
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
    setUrl("/?key=nj-by-hand&kind=paper");
    render(<KeyPage id="nj-by-hand" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const join2 = document
      .getElementById("wk-join-2")!
      .closest("section")!;
    expect(join2.textContent).toContain(
      "Closest pair: d–e — tied with the join, also correct.",
    );
    const join1 = document
      .getElementById("wk-join-1")!
      .closest("section")!;
    expect(join1.textContent).toContain("the join is not the closest pair");
    const mistakes = document.querySelector(".ws-mistakes")!;
    expect(mistakes.textContent).toContain("Join 1: picking d–e");
    expect(mistakes.textContent).not.toContain("Join 2:");
  });

  it("the final join gets no closest-pair verdict and no mistake line", async () => {
    // Fix round 1, R3: the final three-way join offers no choice —
    // no verdict on it and no mistake names it.
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
    setUrl("/?key=nj-by-hand&kind=paper");
    render(<KeyPage id="nj-by-hand" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const join3 = document
      .getElementById("wk-join-3")!
      .closest("section")!;
    expect(join3.textContent).not.toContain("Closest pair");
    expect(join3.textContent).not.toContain("not the closest pair");
    const mistakes = document.querySelector(".ws-mistakes");
    expect(mistakes?.textContent ?? "").not.toContain("Join 3:");
  });

  it("labels every join table — Distances / Q values (NJ), Cluster averages (UPGMA)", async () => {
    // Fix round 1, R4: each join's tables carry a visible caption
    // associated with the table.
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
    setUrl("/?key=nj-by-hand&kind=paper");
    const { unmount } = render(<KeyPage id="nj-by-hand" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const njCaps = [...document.querySelectorAll("table caption")].map(
      (c) => c.textContent,
    );
    expect(njCaps).toContain("Distances");
    expect(njCaps).toContain("Q values");
    unmount();

    setUrl("/?key=upgma-fails&kind=paper");
    render(<KeyPage id="upgma-fails" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const upgmaCaps = [...document.querySelectorAll("table caption")].map(
      (c) => c.textContent,
    );
    expect(upgmaCaps).toContain("Cluster averages");
    expect(upgmaCaps).not.toContain("Q values");
  });

  it("renders no table value with a trailing .000", async () => {
    // Fix round 1, R5: the same formatter serves every table — the
    // final join's matrix showed 3.000/2.500/1.500 where the other
    // tables showed 3 / 2.5.
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
    setUrl("/?key=nj-by-hand&kind=paper");
    const { container } = render(<KeyPage id="nj-by-hand" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    for (const td of container.querySelectorAll("table td")) {
      expect(td.textContent ?? "").not.toMatch(/\d+\.000\b/);
    }
    expect(bodyText()).not.toMatch(/\d+\.000\b/);
  });
});

describe("custom exercise link", () => {
  it("opens the exercise, not the worksheet route — and round-trips", async () => {
    // Fix round 1, R6: the sheet's link/QR must land on the exercise
    // itself; resolving "#x=…" against the worksheet URL re-opened the
    // sheet.
    const ex = loadExerciseFile("nj-by-hand.json");
    const hash = encode({ v: 3, x: ex, step: 0, mode: "concept" });
    setUrl(`/?worksheet=custom&kind=paper${hash}`);
    render(<WorksheetPage id="custom" kind="paper" />);
    await screen.findByRole("heading", {
      level: 2,
      name: "1. The distance matrix",
    });
    const href = document
      .querySelector(".ws-link-text a")!
      .getAttribute("href")!;
    const u = new URL(href);
    expect(u.search).toBe("");
    expect(u.hash).toMatch(/^#x=/);
    const d = decode(href);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.state.x?.id).toBe("nj-by-hand");
      expect(d.state.x).toEqual(ex);
    }
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
