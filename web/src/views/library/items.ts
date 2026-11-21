// Library item assembly and URL filter helpers (spec §7.1). One card
// per lesson, lab and dataset; every field comes from the registries —
// lesson meta is glob-imported straight from the exercise files (the
// Task-12 plan call; the catalog stays light so this lands in the lazy
// library chunk), labs from labs/registry.ts and datasets from
// library/registry.ts listDatasets. "follows" is derived here as the
// reverse of meta.prepares_for over lessons AND labs — nothing else
// lists it. Filters ride ?library&type=…&level=…&short=1 via
// history.replaceState; unknown values are ignored.

import type { ExerciseMeta } from "../../engine/generated/ExerciseMeta";
import type { Level } from "../../engine/generated/Level";
import type { LabSummary } from "../../labs/registry";
import { listLabs } from "../../labs/registry";
import type { DatasetSummary } from "../../library/registry";
import { LESSONS } from "../../lessons/catalog";
import type { ReadingSetSummary } from "../../reading/registry";
import { keyHref, worksheetHref } from "../worksheets/load";

export type TypeKey = "lessons" | "reading" | "phylip" | "mega" | "datasets";

export const TYPE_ORDER: readonly TypeKey[] = [
  "lessons",
  "reading",
  "phylip",
  "mega",
  "datasets",
];

export const TYPE_GROUP: Record<TypeKey, string> = {
  lessons: "Lessons",
  reading: "Tree reading",
  phylip: "PHYLIP labs",
  mega: "MEGA labs",
  datasets: "Datasets",
};

const TYPE_TAG: Record<TypeKey, string> = {
  lessons: "Lesson",
  reading: "Tree reading",
  phylip: "PHYLIP lab",
  mega: "MEGA lab",
  datasets: "Dataset",
};

export const LEVEL_LABEL: Record<Level, string> = {
  intro: "Intro",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Card data for one registry item. Exercise-specific fields stay
 * undefined on dataset cards, and vice versa. */
export interface CardItem {
  /** Registry id — also the worksheet/key/open route id. */
  id: string;
  type: TypeKey;
  title: string;
  tag: string;
  /** Absent on items without a level (all labs and datasets today);
   * such items are hidden by any level filter but "all". */
  level?: Level;
  /** Absent on datasets and labs without minutes; "≤ 30 min" hides
   * those items. */
  minutes?: number;
  objectives: string[];
  /** Resolved id + title + open link, in the meta's order. */
  preparesFor: { id: string; title: string; href: string }[];
  /** The reverse of prepares_for over lessons and labs. */
  follows: { id: string; title: string; href: string }[];
  lab?: LabSummary;
  dataset?: DatasetSummary;
  /** The reading set behind a "Tree reading" card (v1.4d Task 9). */
  reading?: ReadingSetSummary;
  /** The dataset's "good for" line — datasets have no objectives. */
  goodFor?: string;
}

// `?raw` like labs/registry.ts: the meta key is optional, and a named
// `meta` import would fail the build on files without it. schema.json
// carries no meta, so it drops out below. The reading sets ride the
// same map (v1.4d Task 14): buildItems() stays lessons-and-labs, but
// exerciseMetas() lets the guide read `?read=` items' meta.minutes for
// its plan totals without a second glob of the shipped files.
const SHIPPED_META = import.meta.glob<string>(
  [
    "../../../../exercises/*.json",
    "../../../../exercises/labs/*.json",
    "../../../../exercises/reading/*.json",
  ],
  { eager: true, query: "?raw", import: "default" },
);
const FIXTURE_META = import.meta.glob<string>(
  "../../labs/__fixtures__/*.json",
  { eager: true, query: "?raw", import: "default" },
);

// The same e2e flag labs/registry.ts checks — kept as a local copy
// because the registry's helper is private.
function e2eEnabled(): boolean {
  try {
    return window.localStorage.getItem("neophylo-e2e") === "1";
  } catch {
    return false;
  }
}

function stemOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

function metaOf(text: string): ExerciseMeta | undefined {
  try {
    return (JSON.parse(text) as { meta?: ExerciseMeta }).meta;
  } catch {
    return undefined;
  }
}

/** Every exercise meta keyed by file stem — shipped lessons and labs
 * plus, under the e2e flag, the fixture exercises listLabs() adds. */
export function exerciseMetas(): Map<string, ExerciseMeta> {
  const out = new Map<string, ExerciseMeta>();
  for (const [path, text] of Object.entries(SHIPPED_META)) {
    const meta = metaOf(text);
    if (meta !== undefined) out.set(stemOf(path), meta);
  }
  if (e2eEnabled()) {
    for (const [path, text] of Object.entries(FIXTURE_META)) {
      const meta = metaOf(text);
      if (meta !== undefined) out.set(stemOf(path), meta);
    }
  }
  return out;
}

/** The static half of the library — lessons and labs — resolved
 * synchronously so the page renders immediately. Datasets arrive via
 * listDatasets() and the page appends them to the returned list order. */
export function buildItems(): CardItem[] {
  const labs = listLabs();
  const metas = exerciseMetas();
  const titleOf = new Map<string, string>();
  for (const l of LESSONS) titleOf.set(l.id, l.title);
  for (const lab of labs) titleOf.set(lab.id, lab.title);
  const labIds = new Set(labs.map((l) => l.id));
  const ref = (id: string): { id: string; title: string; href: string } => ({
    id,
    title: titleOf.get(id) ?? id,
    // prepares_for ids are lesson or lab ids (the schema test requires
    // them to exist); anything else still resolves as a lesson.
    href: `?${labIds.has(id) ? "lab" : "lesson"}=${encodeURIComponent(id)}`,
  });

  // "Follows X" is the reverse of X's prepares_for, over lessons and
  // labs only (datasets prepare for nothing).
  const follows = new Map<string, string[]>();
  const addFollows = (id: string): void => {
    for (const target of metas.get(id)?.prepares_for ?? []) {
      follows.set(target, [...(follows.get(target) ?? []), id]);
    }
  };
  for (const l of LESSONS) addFollows(l.id);
  for (const lab of labs) addFollows(lab.id);

  const items: CardItem[] = [];
  for (const l of LESSONS) {
    const meta = metas.get(l.id);
    items.push({
      id: l.id,
      type: "lessons",
      title: l.title,
      tag: TYPE_TAG.lessons,
      level: meta?.level,
      minutes: meta?.minutes,
      objectives: meta?.objectives ?? [],
      preparesFor: (meta?.prepares_for ?? []).map(ref),
      follows: (follows.get(l.id) ?? []).map(ref),
    });
  }
  for (const lab of labs) {
    const meta = metas.get(lab.id);
    const type: TypeKey = lab.tool === "mega" ? "mega" : "phylip";
    items.push({
      id: lab.id,
      type,
      title: lab.title,
      tag: TYPE_TAG[type],
      level: meta?.level,
      // §4.2: the library reads either source — the registry's
      // lab.minutes wins when both exist.
      minutes: lab.minutes ?? meta?.minutes,
      objectives: lab.objectives,
      preparesFor: (meta?.prepares_for ?? []).map(ref),
      follows: (follows.get(lab.id) ?? []).map(ref),
      lab,
    });
  }
  return items;
}

/** A reading-set index entry as a card (v1.4d Task 9, spec §8.4).
 * Level, minutes and objectives come from the set's meta; prepares-
 * for / follows stay empty — the plan asks only for the card fields
 * and the registry resolves ids asynchronously, after buildItems. */
export function readingItem(s: ReadingSetSummary): CardItem {
  return {
    id: s.id,
    type: "reading",
    title: s.title,
    tag: TYPE_TAG.reading,
    level: s.meta?.level,
    minutes: s.meta?.minutes,
    objectives: s.meta?.objectives ?? [],
    preparesFor: [],
    follows: [],
    reading: s,
  };
}

export interface CardAction {
  href: string;
  label: string;
}

/** A card's action links, in order (v1.4d Task 13): the open link for
 * the item's own route, then the worksheet and answer-key links its
 * kind carries. Datasets only open. Reading sets get the paper
 * worksheet and key — the plan's "paper worksheet, answer key"
 * actions, which this task activates; lessons and labs keep the
 * Task-11 in-app/paper pair gated on `paper`. */
export function cardActions(
  item: CardItem,
  paper: boolean | undefined,
): CardAction[] {
  if (item.dataset !== undefined) {
    return [
      {
        href: `?ds=${encodeURIComponent(item.id)}`,
        label: "Open dataset",
      },
    ];
  }
  if (item.reading !== undefined) {
    return [
      {
        href: `?read=${encodeURIComponent(item.id)}`,
        label: "Open set",
      },
      { href: worksheetHref(item.id, "paper"), label: "Paper worksheet" },
      { href: keyHref(item.id, "paper"), label: "Answer key" },
    ];
  }
  const open =
    item.lab !== undefined
      ? { href: `?lab=${encodeURIComponent(item.id)}`, label: "Open lab" }
      : {
          href: `?lesson=${encodeURIComponent(item.id)}`,
          label: "Open lesson",
        };
  const actions: CardAction[] = [
    open,
    { href: worksheetHref(item.id, "app"), label: "In-app worksheet" },
  ];
  if (paper === true) {
    actions.push({
      href: worksheetHref(item.id, "paper"),
      label: "Paper worksheet",
    });
  }
  if (paper !== undefined) {
    actions.push({
      href: keyHref(item.id, paper ? "paper" : "app"),
      label: "Answer key",
    });
  }
  return actions;
}

/** A dataset index entry as a card. */
export function datasetItem(d: DatasetSummary): CardItem {
  return {
    id: d.id,
    type: "datasets",
    title: d.title,
    tag: TYPE_TAG.datasets,
    objectives: [],
    goodFor: d.good_for === "" ? undefined : d.good_for,
    preparesFor: [],
    follows: [],
    dataset: d,
  };
}

export interface Filters {
  types: Set<TypeKey>;
  level: Level | "all";
  /** ≤ 30 min (spec §7.1's "short" filter). */
  short: boolean;
}

const ALL_TYPES = new Set<TypeKey>(TYPE_ORDER);

function isType(s: string): s is TypeKey {
  return (TYPE_ORDER as readonly string[]).includes(s);
}

/** Read the filter state from a query string. `?labs` means the two lab
 * types; an explicit `type=` comma list wins when both are present.
 * Unknown values are ignored — a non-empty `type=` list with no valid
 * entries falls back to every type, and unknown levels mean "all". The
 * one exception is the empty `type=` filtersQuery writes for the
 * all-boxes-unticked state: it means no types, so the selection
 * round-trips through a reload. */
export function parseFilters(
  search: string,
  fallbackTypes?: ReadonlySet<TypeKey>,
): Filters {
  const params = new URLSearchParams(search);
  const raw = params.get("type");
  let types: Set<TypeKey>;
  if (raw !== null) {
    const valid = raw.split(",").filter(isType);
    types =
      raw === ""
        ? new Set()
        : valid.length > 0
          ? new Set(valid)
          : new Set(ALL_TYPES);
  } else if (params.has("labs")) {
    types = new Set<TypeKey>(["phylip", "mega"]);
  } else {
    types =
      fallbackTypes !== undefined ? new Set(fallbackTypes) : new Set(ALL_TYPES);
  }
  const lv = params.get("level");
  const level: Level | "all" =
    lv === "intro" || lv === "intermediate" || lv === "advanced"
      ? lv
      : "all";
  return { types, level, short: params.get("short") === "1" };
}

/** The canonical `?library&…` query for a filter state. `?library` is
 * emitted as a bare flag; `type=` is only written when it narrows the
 * set (selecting all four types is the default, so nothing is
 * written). */
export function filtersQuery(f: Filters): string {
  const parts = ["library"];
  if (f.types.size < TYPE_ORDER.length) {
    parts.push(`type=${TYPE_ORDER.filter((t) => f.types.has(t)).join(",")}`);
  }
  if (f.level !== "all") parts.push(`level=${f.level}`);
  if (f.short) parts.push("short=1");
  return `?${parts.join("&")}`;
}

/** Apply the three filters. Items without a level are hidden by any
 * level filter but "all"; items without minutes are hidden by "≤ 30
 * min" — the spec says nothing to show, so nothing matches. */
export function matches(item: CardItem, f: Filters): boolean {
  if (!f.types.has(item.type)) return false;
  if (f.level !== "all" && item.level !== f.level) return false;
  if (f.short && (item.minutes === undefined || item.minutes > 30)) {
    return false;
  }
  return true;
}
