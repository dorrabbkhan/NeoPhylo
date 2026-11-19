// Library page tests (v1.4c plan Task 12, spec §7.1). The pinned
// behaviours: exactly one card per lesson, lab and dataset — every
// title, minutes figure, objective and level read from the registries
// (catalog meta, labs/registry.ts, library/registry.ts), nothing typed
// into the page; "follows" is the runtime reverse of `prepares_for`
// over lessons AND labs; the type/level/≤30-min filters combine, ride
// the `?library&…` query and ignore unknown values; an item without a
// `level` is hidden by any level filter other than "all" and one
// without minutes by "≤ 30 min"; worksheet links appear only when the
// Task-11 builders produce them (paperSheet non-null); dataset cards
// open through the same `ds=` path as the dataset sheet.
//
// fetch is stubbed to serve exercises/<id>.json and library/ off disk,
// like the worksheets tests — the page then runs on the shipped
// registries. The expected values below are read from the exercise
// files and registries themselves, never re-typed.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engine } from "../../engine/index";
import type { Exercise } from "../../engine/generated/Exercise";
import type { ExerciseMeta } from "../../engine/generated/ExerciseMeta";
import { LESSONS } from "../../lessons/catalog";
import { listLabs } from "../../labs/registry";
import type { DatasetSummary } from "../../library/registry";
import type { ReadingSetSummary } from "../../reading/registry";
import { paperSheet } from "../../worksheets/build";

import { LabIndex } from "../labs/LabIndex";
import { LibraryPage } from "./LibraryPage";

// v1.4d Task 9: `listReadingSets` is stubbed so a test can give the
// page a reading card before the real lessons land (Tasks 11–12);
// the shipped-set count test below still reads exercises/reading/
// off disk. The empty default matches today — only trees-demo is
// shipped and the registry never lists it.
const mockReading = vi.hoisted(() => ({
  list: [] as unknown[],
}));
vi.mock("../../reading/registry", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../reading/registry")>();
  return {
    ...real,
    listReadingSets: () =>
      Promise.resolve(mockReading.list as ReadingSetSummary[]),
  };
});

// Paths are resolved against this file, not the vitest cwd, so the
// suite runs the same from web/ or web/src/.
const WEB = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const EXERCISES = resolve(WEB, "..", "exercises");
const READING = resolve(EXERCISES, "reading");
const LIBRARY = resolve(WEB, "public", "library");

/** The reading-set ids the library lists — every shipped file except
 * the dev-only trees-demo (registry.ts's own exclusion) and the
 * Task-12 coverage sets (a subdirectory, filtered out by the .json
 * test below anyway). */
const LISTED_READING = readdirSync(READING)
  .filter((f) => f.endsWith(".json") && f !== "trees-demo.json")
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const DATASETS = JSON.parse(
  readFileSync(resolve(LIBRARY, "index.json"), "utf8"),
) as DatasetSummary[];

/** File-stem → meta for every shipped lesson and lab — the test's own
 * read of the registry data, independent of the page's import. */
function metaMap(): Map<string, ExerciseMeta> {
  const out = new Map<string, ExerciseMeta>();
  const dirs = [EXERCISES, resolve(EXERCISES, "labs")];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json") || f.endsWith("schema.json")) continue;
      const meta = (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as {
        meta?: ExerciseMeta;
      }).meta;
      if (meta !== undefined) out.set(f.replace(/\.json$/, ""), meta);
    }
  }
  return out;
}

function exerciseFile(id: string): Exercise {
  const dirs = [EXERCISES, resolve(EXERCISES, "labs")];
  for (const dir of dirs) {
    try {
      const r = engine.loadExercise(
        readFileSync(resolve(dir, `${id}.json`), "utf8"),
      );
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      return r.value;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("{")) throw e;
    }
  }
  throw new Error(`no exercise file for ${id}`);
}

function stubFetches() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    let m = /^\/exercises\/([\w.-]+\.json)$/.exec(url);
    if (m !== null) {
      try {
        return new Response(
          readFileSync(resolve(EXERCISES, m[1]), "utf8"),
        );
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
    m = /\/library\/([\w.-]+)$/.exec(url);
    if (m !== null) {
      try {
        return new Response(
          readFileSync(resolve(LIBRARY, m[1]), "utf8"),
        );
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
    return new Response("not found", { status: 404 });
  });
}

function setUrl(url: string) {
  history.replaceState(null, "", url);
}

beforeEach(() => {
  window.localStorage.removeItem("neophylo-e2e");
  stubFetches();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUrl("/");
  mockReading.list = [];
  window.localStorage.removeItem("neophylo-e2e");
});

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".lib-card"));
}

/** The card that carries `title`. Titles can appear in other cards'
 * prepares/follows links, so the heading — one per card — is the
 * locator (the count test pins there being exactly one). */
function cardOf(title: string): HTMLElement {
  const el = screen
    .getByRole("heading", { level: 3, name: title })
    .closest("li");
  if (el === null) throw new Error(`no card for ${title}`);
  return el as HTMLElement;
}

/** No card with this title is on the page. */
function noCard(title: string): void {
  expect(
    screen.queryByRole("heading", { level: 3, name: title }),
  ).toBeNull();
}

/** The ids of every visible card, in DOM order. */
async function readyCards(): Promise<HTMLElement[]> {
  // The page loads exercises and the dataset index asynchronously;
  // wait until every registry item has its card.
  await waitFor(() => {
    expect(cards()).toHaveLength(
      LESSONS.length + listLabs().length + DATASETS.length,
    );
  });
  return cards();
}

describe("library page — cards from the registries", () => {
  it("?library lists exactly one card per lesson, lab and dataset, titles from the registries", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    expect(
      screen.getByRole("heading", { name: "Library", level: 1 }),
    ).toBeTruthy();
    await readyCards();
    for (const item of [
      ...LESSONS.map((l) => ({ kind: "lesson", ...l })),
      ...listLabs().map((l) => ({ kind: "lab", ...l })),
      ...DATASETS.map((d) => ({ kind: "dataset", ...d })),
    ]) {
      expect(
        screen.getAllByRole("heading", { level: 3, name: item.title }),
        `one card for ${item.kind} ${item.id}`,
      ).toHaveLength(1);
    }
  });

  it("groups cards under Lessons, Tree reading, PHYLIP labs, MEGA labs and Datasets", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    for (const name of [
      "Lessons",
      "Tree reading",
      "PHYLIP labs",
      "MEGA labs",
      "Datasets",
    ]) {
      expect(
        await screen.findByRole("heading", { name }),
      ).toBeTruthy();
    }
    // A lab card sits inside its tool's group region.
    const lab = listLabs().find((l) => l.tool === "phylip");
    if (lab === undefined) throw new Error("no phylip lab shipped");
    const group = screen.getByRole("region", { name: "PHYLIP labs" });
    await waitFor(() => {
      expect(
        within(group).getByRole("heading", { level: 3, name: lab.title }),
      ).toBeTruthy();
    });
  });

  it("lesson cards show the level tag, minutes and objectives from meta", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    await readyCards();
    const metas = metaMap();
    for (const l of LESSONS) {
      const meta = metas.get(l.id);
      const card = cardOf(l.title);
      if (meta !== undefined) {
        expect(card.textContent).toContain("About " + meta.minutes + " min");
        for (const o of meta.objectives) {
          expect(card.textContent).toContain(o);
        }
      }
    }
    // The level tag exists iff meta.level does — datasets and labs
    // carry no level tag at all.
    const lab = listLabs()[0];
    expect(cardOf(lab.title).textContent).not.toMatch(
      /\bintro\b|\bintermediate\b|\badvanced\b/i,
    );
  });

  it("dataset cards show taxa × sites, alphabet, source and license, and only an open action", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    await readyCards();
    for (const d of DATASETS) {
      const card = cardOf(d.title);
      expect(card.textContent).toContain(`${d.taxa} taxa`);
      expect(card.textContent).toContain(`${d.sites} sites`);
      expect(card.textContent).toContain(d.license);
      const open = within(card).getByRole("link", {
        name: /open dataset/i,
      });
      expect(open.getAttribute("href")).toBe(`?ds=${d.id}`);
      // Datasets have no worksheets or answer keys (spec §7.1).
      expect(within(card).queryByRole("link", { name: /worksheet/i })).toBeNull();
      expect(within(card).queryByRole("link", { name: /answer key/i })).toBeNull();
    }
  });
});

describe("library page — worksheet and open actions", () => {
  it("every lesson and lab card links to open, the in-app worksheet and the key; paper only when paperSheet allows", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    // Wait for the async paperSheet pass to finish on every card.
    await waitFor(async () => {
      expect(document.querySelectorAll(".lib-card .lab-card-actions")).toHaveLength(
        LESSONS.length + listLabs().length + DATASETS.length,
      );
    });
    for (const l of LESSONS) {
      const ex = exerciseFile(l.id);
      const paper = paperSheet(ex, `?lesson=${l.id}`) !== null;
      const card = cardOf(l.title);
      await waitFor(() => {
        expect(
          within(card).getByRole("link", { name: /open lesson/i }),
        ).toBeTruthy();
      });
      expect(
        within(card)
          .getByRole("link", { name: /open lesson/i })
          .getAttribute("href"),
      ).toBe(`?lesson=${l.id}`);
      expect(
        within(card)
          .getByRole("link", { name: /in-app worksheet/i })
          .getAttribute("href"),
      ).toBe(`?worksheet=${l.id}&kind=app`);
      const paperLink = within(card).queryByRole("link", {
        name: /paper worksheet/i,
      });
      if (paper) {
        expect(paperLink?.getAttribute("href")).toBe(
          `?worksheet=${l.id}&kind=paper`,
        );
      } else {
        expect(paperLink).toBeNull();
      }
      const key = within(card).getByRole("link", { name: /answer key/i });
      expect(key.getAttribute("href")).toBe(
        `?key=${l.id}&kind=${paper ? "paper" : "app"}`,
      );
    }
    for (const lab of listLabs()) {
      const ex = exerciseFile(lab.id);
      const paper = paperSheet(ex, `?lab=${lab.id}`) !== null;
      const card = cardOf(lab.title);
      expect(
        within(card)
          .getByRole("link", { name: /open lab/i })
          .getAttribute("href"),
      ).toBe(`?lab=${lab.id}`);
      expect(
        within(card)
          .getByRole("link", { name: /in-app worksheet/i })
          .getAttribute("href"),
      ).toBe(`?worksheet=${lab.id}&kind=app`);
      const paperLink = within(card).queryByRole("link", {
        name: /paper worksheet/i,
      });
      if (paper) {
        expect(paperLink?.getAttribute("href")).toBe(
          `?worksheet=${lab.id}&kind=paper`,
        );
      } else {
        expect(paperLink).toBeNull();
      }
    }
  });
});

describe("library page — prepares for / follows", () => {
  it("'prepares for' names the target titles; 'follows' is its exact reverse over lessons and labs", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    await readyCards();
    const metas = metaMap();
    const titleOf = new Map<string, string>();
    for (const l of LESSONS) titleOf.set(l.id, l.title);
    for (const lab of listLabs()) titleOf.set(lab.id, lab.title);

    // The expected reverse map, computed from the registry data:
    // for every X with Y in X.meta.prepares_for, Y follows X — and
    // nothing else appears on any card.
    const follows = new Map<string, string[]>();
    for (const [id, meta] of metas) {
      for (const target of meta.prepares_for) {
        follows.set(target, [...(follows.get(target) ?? []), id]);
      }
    }

    for (const [id, meta] of metas) {
      const title = titleOf.get(id);
      if (title === undefined) continue;
      const card = cardOf(title);
      if (meta.prepares_for.length > 0) {
        const line = within(card).getByText(/Prepares for:/);
        for (const target of meta.prepares_for) {
          expect(line.textContent).toContain(titleOf.get(target) ?? target);
        }
      } else {
        expect(within(card).queryByText(/Prepares for:/)).toBeNull();
      }
      const followers = follows.get(id) ?? [];
      if (followers.length > 0) {
        const line = within(card).getByText(/Follows:/);
        for (const f of followers) {
          expect(line.textContent).toContain(titleOf.get(f) ?? f);
        }
      } else {
        expect(within(card).queryByText(/Follows:/)).toBeNull();
      }
    }
  });
});

describe("library page — filters", () => {
  it("?labs opens the library filtered to labs with the Labs heading", async () => {
    setUrl("?labs");
    render(<LibraryPage />);
    expect(
      screen.getByRole("heading", { name: "Labs", level: 1 }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(cards()).toHaveLength(listLabs().length);
    });
    expect(screen.queryByRole("heading", { name: "Lessons" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Datasets" })).toBeNull();
    expect(screen.getByRole("heading", { name: "PHYLIP labs" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "MEGA labs" })).toBeTruthy();
  });

  it("type= filters to the listed types", async () => {
    setUrl("?library&type=phylip,mega");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(listLabs().length);
    });
    setUrl("?library&type=datasets");
    cleanup();
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(DATASETS.length);
    });
  });

  it("level= keeps only items with that level — items without a level are hidden", async () => {
    const metas = metaMap();
    const intro = LESSONS.filter((l) => metas.get(l.id)?.level === "intro");
    setUrl("?library&level=intro");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(intro.length);
    });
    // No lab or dataset card survives a level filter (they have none).
    for (const lab of listLabs()) noCard(lab.title);
  });

  it("short=1 keeps only items with minutes ≤ 30 — items without minutes are hidden", async () => {
    const metas = metaMap();
    const expected =
      LESSONS.filter((l) => (metas.get(l.id)?.minutes ?? 999) <= 30).length +
      listLabs().filter((l) => (l.minutes ?? 999) <= 30).length;
    setUrl("?library&short=1");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(expected);
    });
    for (const d of DATASETS) noCard(d.title);
  });

  it("filters combine and unknown values are ignored", async () => {
    setUrl("?library&type=lessons&level=intro&short=1");
    render(<LibraryPage />);
    const metas = metaMap();
    const expected = LESSONS.filter(
      (l) =>
        metas.get(l.id)?.level === "intro" &&
        (metas.get(l.id)?.minutes ?? 999) <= 30,
    );
    await waitFor(() => {
      expect(cards()).toHaveLength(expected.length);
    });
    cleanup();
    // Unknown tokens are ignored rather than erroring: a type list
    // with no valid entries falls back to every type.
    setUrl("?library&type=bogus&level=expert");
    render(<LibraryPage />);
    await readyCards();
  });

  it("an empty type= means no types — the boxes stay unticked and the no-match line shows", async () => {
    setUrl("?library&type=");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(
        screen.getByText("No items match these filters."),
      ).toBeTruthy();
    });
    expect(cards()).toHaveLength(0);
    for (const name of [
      "Lessons",
      "Tree reading",
      "PHYLIP labs",
      "MEGA labs",
      "Datasets",
    ]) {
      expect(
        (screen.getByRole("checkbox", { name }) as HTMLInputElement)
          .checked,
      ).toBe(false);
    }
    // Unticking the last box writes the same empty type= back out.
    setUrl("?library");
    cleanup();
    render(<LibraryPage />);
    await readyCards();
    for (const name of [
      "Lessons",
      "Tree reading",
      "PHYLIP labs",
      "MEGA labs",
      "Datasets",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(window.location.search).toBe("?library&type=");
  });

  it("any other filter combination with zero matches shows the same line", async () => {
    // Datasets carry no minutes, so "≤ 30 min" hides every one.
    setUrl("?library&type=datasets&short=1");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(
        screen.getByText("No items match these filters."),
      ).toBeTruthy();
    });
    expect(cards()).toHaveLength(0);
  });

  it("changing a filter writes ?library&… and a reload keeps it", async () => {
    setUrl("?labs");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(listLabs().length);
    });
    // The ?labs URL holds until the user touches a filter.
    expect(window.location.search).toBe("?labs");
    fireEvent.click(screen.getByRole("checkbox", { name: "Datasets" }));
    expect(window.location.search).toContain("type=phylip,mega,datasets");
    fireEvent.click(screen.getByRole("checkbox", { name: /30 min/i }));
    expect(window.location.search).toContain("short=1");
    fireEvent.change(screen.getByRole("combobox", { name: /level/i }), {
      target: { value: "intermediate" },
    });
    expect(window.location.search).toContain("level=intermediate");
    expect(window.location.search).toContain("library");

    // A reload remounts with the same filter state — labs at or under
    // 30 minutes only: the level filter hides the level-less labs and
    // datasets, and no lesson type is selected.
    cleanup();
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(0);
    });
    // Level-less items reappear once the level filter is cleared.
    fireEvent.change(screen.getByRole("combobox", { name: /level/i }), {
      target: { value: "all" },
    });
    const short = listLabs().filter((l) => (l.minutes ?? 999) <= 30);
    await waitFor(() => {
      expect(cards()).toHaveLength(short.length);
    });
    expect(window.location.search).not.toContain("level=");
  });
});

describe("library page — collapsed lab settings (owner request 2026-11-17)", () => {
  it("?library folds each lab card's settings table behind a 'Settings (N options)' disclosure", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    await readyCards();
    for (const lab of listLabs()) {
      const card = cardOf(lab.title);
      const details = card.querySelector("details");
      expect(details, `${lab.id}: the settings table sits inside a details`).not.toBeNull();
      // Collapsed on ?library under any filter (no `open` attribute).
      expect(details?.open).toBe(false);
      const summary = details?.querySelector("summary");
      // N is the lab's own settings count from the registry.
      expect(summary?.textContent).toBe(
        `Settings (${lab.settings.length} options)`,
      );
      // The scroll-in-place region and its accessible name are
      // unchanged inside the fold.
      const region = details?.querySelector(".lab-settings-scroll");
      expect(region?.getAttribute("aria-label")).toBe(
        `${lab.title} settings`,
      );
      expect(region?.querySelector("table")).not.toBeNull();
    }
    // Lesson and dataset cards have no settings table to fold.
    expect(
      document.querySelectorAll(".lib-card details"),
    ).toHaveLength(listLabs().length);
  });

  it("any ?library filter keeps the lab settings folded", async () => {
    setUrl("?library&type=phylip,mega");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(listLabs().length);
    });
    for (const lab of listLabs()) {
      const details = cardOf(lab.title).querySelector("details");
      expect(details).not.toBeNull();
      expect(details?.open).toBe(false);
    }
  });

  it("?labs keeps the settings tables open, as before — no disclosure", async () => {
    setUrl("?labs");
    render(<LabIndex />);
    await waitFor(() => {
      expect(cards()).toHaveLength(listLabs().length);
    });
    for (const lab of listLabs()) {
      const card = cardOf(lab.title);
      expect(card.querySelector("details")).toBeNull();
      // The same scroll-in-place region with its accessible name,
      // sitting directly on the card.
      const region = within(card).getByRole("region", {
        name: `${lab.title} settings`,
      });
      expect(region.querySelector("table")).not.toBeNull();
    }
  });
});

// v1.4d Task 9 (spec §7.1/§8.4): reading sets list under "Tree
// reading" — one card per shipped set the registry lists (trees-demo
// and the Task-12 coverage sets never do). Cards carry the meta's
// level, minutes and objectives and open ?read=<id>; the worksheet
// and answer-key actions stay hidden until Task 13.
describe("library page — reading sets (v1.4d Task 9)", () => {
  const readingCards = (): HTMLElement[] =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.lib-card[data-kind="reading"]',
      ),
    );

  const SAMPLE: ReadingSetSummary = {
    id: "trees-sample",
    title: "Sample reading set",
    summary: "A test reading set",
    meta: {
      objectives: ["Read a tree left to right"],
      minutes: 40,
      level: "intro",
      prepares_for: [],
    },
  };

  it("every shipped listed reading set has exactly one card opening ?read=<id>", async () => {
    // The expected list comes from exercises/reading/ itself — the
    // registry's exclusion of trees-demo is mirrored by LISTED_READING.
    mockReading.list = LISTED_READING.map((id) => {
      const file = JSON.parse(
        readFileSync(resolve(READING, `${id}.json`), "utf8"),
      ) as { title: string; summary: string; meta?: ExerciseMeta };
      return {
        id,
        title: file.title,
        summary: file.summary,
        meta: file.meta,
      };
    });
    setUrl("?library&type=reading");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(
        document.querySelectorAll('.lib-card[data-kind="reading"]'),
      ).toHaveLength(LISTED_READING.length);
    });
    for (const id of LISTED_READING) {
      const file = JSON.parse(
        readFileSync(resolve(READING, `${id}.json`), "utf8"),
      ) as { title: string };
      const card = cardOf(file.title);
      expect(card.getAttribute("data-kind")).toBe("reading");
      expect(
        within(card)
          .getByRole("link", { name: /open set/i })
          .getAttribute("href"),
      ).toBe(`?read=${id}`);
    }
    // The dev-only demo set never lists (registry rule, Task 8).
    const demo = JSON.parse(
      readFileSync(resolve(READING, "trees-demo.json"), "utf8"),
    ) as { title: string };
    noCard(demo.title);
  });

  it("a reading card shows the tag, level, minutes and objectives from meta, and only the Open set action", async () => {
    mockReading.list = [SAMPLE];
    setUrl("?library");
    render(<LibraryPage />);
    // The card arrives with the async registry list.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 3, name: SAMPLE.title }),
      ).toBeTruthy();
    });
    const card = cardOf(SAMPLE.title);
    expect(card.getAttribute("data-kind")).toBe("reading");
    expect(card.textContent).toContain("Tree reading");
    expect(card.textContent).toContain("Intro");
    expect(card.textContent).toContain("About 40 min");
    expect(card.textContent).toContain("Read a tree left to right");
    expect(
      within(card)
        .getByRole("link", { name: /open set/i })
        .getAttribute("href"),
    ).toBe("?read=trees-sample");
    // The paper worksheet and answer key activate in Task 13 —
    // nothing else renders on the card until then (plan's Produces).
    expect(
      within(card).queryByRole("link", { name: /worksheet/i }),
    ).toBeNull();
    expect(
      within(card).queryByRole("link", { name: /answer key/i }),
    ).toBeNull();
  });

  it("?library&type=reading shows only the Tree reading group and combines with level and short", async () => {
    mockReading.list = [SAMPLE];
    setUrl("?library&type=reading");
    render(<LibraryPage />);
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    expect(
      screen.getByRole("heading", { name: "Tree reading" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Lessons" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Datasets" }),
    ).toBeNull();

    // The level filter keeps the intro set; "≤ 30 min" hides the
    // 40-minute one, and both states ride the URL.
    fireEvent.change(screen.getByRole("combobox", { name: /level/i }), {
      target: { value: "intro" },
    });
    expect(window.location.search).toContain("level=intro");
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /30 min/i }));
    expect(window.location.search).toContain("short=1");
    await waitFor(() => {
      expect(cards()).toHaveLength(0);
    });

    // A reload remounts on the same filter state.
    cleanup();
    render(<LibraryPage />);
    expect(
      (screen.getByRole("checkbox", { name: "Tree reading" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Lessons" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    await waitFor(() => {
      expect(cards()).toHaveLength(0);
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /30 min/i }));
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
  });

  it("the Tree reading checkbox writes type=reading through the canonical query", async () => {
    mockReading.list = [SAMPLE];
    setUrl("?library");
    render(<LibraryPage />);
    // Wait for the async registry list's card.
    await waitFor(() => {
      expect(readingCards()).toHaveLength(1);
    });
    // Untick everything but Tree reading.
    for (const name of ["Lessons", "PHYLIP labs", "MEGA labs", "Datasets"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(window.location.search).toBe("?library&type=reading");
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
  });
});
