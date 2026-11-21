// docs/instructor-guide.md link and plan checks (v1.4c plan Task 13,
// spec §7.5 "a repo test checks every library link in the guide
// exists" plus the plan's timing rule; v1.4d Task 14 added the
// `?read=` form). Every `[text](href)` in the guide must be one of the
// internal `?route` forms links.ts knows AND resolve to a real lesson,
// lab, reading set, worksheet/key target or bare route — an unknown
// link form fails here, not in the page. The plan lists must link
// only to library items and sum to their slot ± 5 from the same
// registry minutes GuidePage displays (meta.minutes for lessons,
// lab.minutes ?? meta.minutes for labs, the reading registry's
// meta.minutes for `?read=` sets).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { engine } from "../../engine/index";
import type { Exercise } from "../../engine/generated/Exercise";
import { listLabs, loadLab } from "../../labs/registry";
import { LESSONS } from "../../lessons/catalog";
import {
  markdownLinks,
  parseInternalHref,
  planItemHrefs,
} from "../../links";
import {
  listReadingSets,
  loadBuiltinReadingSet,
} from "../../reading/registry";
import type { ReadingSetSummary } from "../../reading/registry";
import { exerciseMetas, buildItems } from "../library/items";
import { paperSheet } from "../../worksheets/build";
import { readingKey, readingSheet } from "../../worksheets/reading";

const GUIDE = resolve("..", "docs", "instructor-guide.md");
const SOURCE = readFileSync(GUIDE, "utf8");

// The lesson files loadExercise needs for a paperSheet check — the
// same glob build.test.ts uses (a lesson's Exercise, engine-parsed).
const LESSON_FILES = import.meta.glob<string>(
  "../../../../exercises/*.json",
  { query: "?raw", import: "default", eager: true },
);

// Every shipped reading file, top-level and coverage — the same two
// trees loadBuiltinReadingSet resolves. Parsed for their `title` so
// the link-text check covers `?read=` links too (manifest.json is
// skipped by the kind check).
const READING_FILES = import.meta.glob<string>(
  [
    "../../../../exercises/reading/*.json",
    "../../../../exercises/reading/coverage/*.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

function stem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

const readingTitles = new Map<string, string>();
for (const [path, text] of Object.entries(READING_FILES)) {
  try {
    const d = JSON.parse(text) as { kind?: string; title?: unknown };
    if (d.kind === "reading" && typeof d.title === "string") {
      readingTitles.set(stem(path), d.title);
    }
  } catch {
    // not a reading set (the coverage manifest) — nothing to check
  }
}

function loadLessonFile(id: string): Exercise | null {
  const text = LESSON_FILES[`../../../../exercises/${id}.json`];
  if (text === undefined) return null;
  const r = engine.loadExercise(text);
  return r.ok ? r.value : null;
}

const blocks = SOURCE.split(/\n{2,}/)
  .map((b) => b.trim())
  .filter((b) => b !== "");

const lessonIds = new Set(LESSONS.map((l) => l.id));
const labIds = new Set(listLabs().map((l) => l.id));

/** The registry minutes the page shows for a linked item — the same
 * resolution the library cards use: buildItems() for lessons and
 * labs, listReadingSets() meta.minutes for reading sets. */
const minutesById = new Map(
  buildItems()
    .filter((i) => i.minutes !== undefined)
    .map((i) => [i.id, i.minutes as number]),
);

/** The library-listed reading sets (registry summaries) — the cards
 * a `?read=` plan item must resolve to, and their meta.minutes. */
let readingListedIds = new Set<string>();
beforeAll(async () => {
  const readingSets: ReadingSetSummary[] = await listReadingSets();
  readingListedIds = new Set(readingSets.map((s) => s.id));
  for (const s of readingSets) {
    if (s.meta?.minutes !== undefined) minutesById.set(s.id, s.meta.minutes);
  }
});

/** The guide's plan sections, in document order: the first
 * all-link ordered list after each `##` heading containing "plan". */
function plans(): { heading: string; hrefs: string[] }[] {
  const out: { heading: string; hrefs: string[] }[] = [];
  let heading: string | null = null;
  let found = false;
  for (const b of blocks) {
    const h = /^#{2}\s+(.+)$/.exec(b);
    if (h !== null) {
      heading = h[1];
      found = false;
      continue;
    }
    const hrefs = planItemHrefs(b);
    if (hrefs !== null && !found && heading !== null && /plan/i.test(heading)) {
      out.push({ heading, hrefs });
      found = true;
    }
  }
  return out;
}

describe("guide internal links", () => {
  it("every [text](href) is a known internal form and resolves", async () => {
    const links = markdownLinks(SOURCE);
    expect(links.length).toBeGreaterThan(0);
    for (const { text, href } of links) {
      const t = parseInternalHref(href);
      expect(t, `unknown link form [${text}](${href})`).not.toBeNull();
      if (t === null) continue;
      switch (t.route) {
        case "lesson":
          expect(
            lessonIds.has(t.id ?? ""),
            `?lesson=${t.id} is not a catalog lesson`,
          ).toBe(true);
          break;
        case "lab":
          expect(
            labIds.has(t.id ?? ""),
            `?lab=${t.id} is not a registry lab`,
          ).toBe(true);
          break;
        case "read": {
          const r = await loadBuiltinReadingSet(t.id ?? "");
          expect(
            r.ok,
            `?read=${t.id} is not a shipped reading set`,
          ).toBe(true);
          break;
        }
        case "worksheet":
        case "key": {
          const id = t.id ?? "";
          const reading = await loadBuiltinReadingSet(id);
          expect(
            lessonIds.has(id) || labIds.has(id) || reading.ok,
            `?${t.route}=${id} matches no lesson, lab or reading set`,
          ).toBe(true);
          if (t.kind === "paper") {
            if (reading.ok) {
              const ok =
                t.route === "worksheet"
                  ? readingSheet(reading.value, href).items.length > 0
                  : readingKey(reading.value).ok;
              expect(
                ok,
                `?${t.route}=${id}&kind=paper has no paper sheet`,
              ).toBe(true);
            } else {
              const lab = labIds.has(id) ? loadLab(id) : null;
              const src =
                lab !== null && lab.ok ? lab.value : loadLessonFile(id);
              expect(
                src !== null && paperSheet(src, href) !== null,
                `?${t.route}=${id}&kind=paper has no paper sheet`,
              ).toBe(true);
            }
          }
          break;
        }
        // library/labs/editor are routes, not ids — form was checked
        // by parseInternalHref already.
        default:
          break;
      }
    }
  });

  it("link text on item links is the registry title (no drift)", () => {
    const titles = new Map<string, string>();
    for (const l of LESSONS) titles.set(l.id, l.title);
    for (const l of listLabs()) titles.set(l.id, l.title);
    for (const [id, title] of readingTitles) titles.set(id, title);
    for (const { text, href } of markdownLinks(SOURCE)) {
      const t = parseInternalHref(href);
      if (t === null || t.id === undefined) continue;
      if (t.route !== "lesson" && t.route !== "lab" && t.route !== "read") {
        continue;
      }
      expect(text, `link text for ${t.id}`).toBe(titles.get(t.id));
    }
  });
});

describe("guide plans", () => {
  it("has exactly the three plan lists", () => {
    expect(plans().map((p) => p.heading)).toEqual([
      expect.stringMatching(/50-minute/i),
      expect.stringMatching(/hour lab plan/i),
      expect.stringMatching(/tree-reading/i),
    ]);
  });

  it("every plan item links to an existing library item", () => {
    for (const { hrefs } of plans()) {
      for (const href of hrefs) {
        const t = parseInternalHref(href);
        expect(t, `plan link ${href}`).not.toBeNull();
        if (t === null) continue;
        expect(["lesson", "lab", "read"]).toContain(t.route);
        expect(
          lessonIds.has(t.id ?? "") ||
            labIds.has(t.id ?? "") ||
            readingListedIds.has(t.id ?? ""),
          `plan item ${href} is not in the library`,
        ).toBe(true);
      }
    }
  });

  // The slot is the hard ceiling — a plan must not run over. Totals
  // come from the registries, never from typed text.
  it.each([
    { match: /50-minute class plan/i, slot: 50 },
    { match: /hour lab plan/i, slot: 180 },
    { match: /tree-reading class plan/i, slot: 50 },
  ])(
    "the $match plan totals its slot ± 5 minutes from registry minutes",
    ({ match, slot }) => {
      const plan = plans().find((p) => match.test(p.heading));
      expect(plan, `no plan heading matches ${match}`).toBeDefined();
      const total = (plan?.hrefs ?? []).reduce(
        (sum, href) =>
          sum + (minutesById.get(parseInternalHref(href)?.id ?? "") ?? 0),
        0,
      );
      expect(
        Math.abs(total - slot),
        `plan "${plan?.heading}" sums to ${total}`,
      ).toBeLessThanOrEqual(5);
      expect(total, `plan "${plan?.heading}" sums to ${total}`).toBeLessThanOrEqual(
        slot,
      );
      expect(
        total,
        `plan "${plan?.heading}" sums to ${total}`,
      ).toBeGreaterThanOrEqual(slot - 5);
    },
  );

  it("every plan item has a registry minutes value to display", () => {
    for (const { hrefs } of plans()) {
      for (const href of hrefs) {
        const id = parseInternalHref(href)?.id ?? "";
        expect(minutesById.has(id), `${id} has no minutes`).toBe(true);
      }
    }
  });
});

// The §4.2/§7.5 rule: the guide must show lab.minutes where both it
// and meta.minutes exist — buildItems() already does; this pins that
// the two sources agree with what listLabs reports for plan labs.
it("plan lab minutes match lab.minutes ?? meta.minutes", () => {
  const metas = exerciseMetas();
  const labs = new Map(listLabs().map((l) => [l.id, l]));
  for (const { hrefs } of plans()) {
    for (const href of hrefs) {
      const t = parseInternalHref(href);
      if (t?.route !== "lab" || t.id === undefined) continue;
      const want = labs.get(t.id)?.minutes ?? metas.get(t.id)?.minutes;
      expect(minutesById.get(t.id), `${t.id} minutes`).toBe(want);
    }
  }
});
