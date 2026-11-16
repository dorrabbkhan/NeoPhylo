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
import { paperSheet } from "../../worksheets/build";

import { LibraryPage } from "./LibraryPage";

// Paths are resolved against this file, not the vitest cwd, so the
// suite runs the same from web/ or web/src/.
const WEB = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const EXERCISES = resolve(WEB, "..", "exercises");
const LIBRARY = resolve(WEB, "public", "library");

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
      if (!f.endsWith(".json") || f === "schema.json") continue;
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

  it("groups cards under Lessons, PHYLIP labs, MEGA labs and Datasets", async () => {
    setUrl("?library");
    render(<LibraryPage />);
    for (const name of [
      "Lessons",
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
