// Numbers-in-text check (v1.4c plan Task 10, spec §8.2): no number
// derived from data may appear in new lesson text — every value a
// student sees must be computed by the engine. New exercise files are
// scanned for digits in prompt/note text (concept, math, reveal), the
// title, the summary and meta.objectives; a match fails unless it is
// one of the explicitly allowlisted patterns below. The pre-v1.4c
// files — which do quote numbers, e.g. cytochrome-c's distances and
// bootstrap-basics' replicate counts — are exempted by name and stay
// unchanged.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const EXERCISES = resolve("..", "exercises");

interface PromptText {
  at_step: number;
  concept: string;
  math: string | null;
  reveal: string | null;
}

interface LessonText {
  id: string;
  title: string;
  summary: string;
  prompts: PromptText[];
  meta?: { objectives?: string[] };
}

// Files written before this rule existed (v1–v1.4b): they may keep
// their quoted numbers. Anything new is scanned automatically — a new
// exercises/*.json is checked unless it is named here.
const EXEMPT = new Set([
  "bootstrap-basics",
  "cytochrome-c",
  "nj-basics",
  "protein-models",
  "saturation",
  "upgma-fails",
]);

// Digit sequences that are not data numbers, spelled out one by one —
// keep this list minimal and explicit:
//   /n−2/   the "(n−2)" term of NJ's Q formula (a formula constant,
//           not a data value), written with the same minus sign the
//           other lessons use.
const ALLOWED_PATTERNS = [/n−2/g];

const digitsOutsideAllowlist = (text: string): string | null => {
  const stripped = ALLOWED_PATTERNS.reduce(
    (t, re) => t.replace(re, ""),
    text,
  );
  return stripped.match(/\d+/)?.[0] ?? null;
};

const scannedIds = () =>
  readdirSync(EXERCISES)
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
    .map((f) => f.replace(/\.json$/, ""))
    .filter((id) => !EXEMPT.has(id))
    .sort();

describe("lesson content: no data numbers in new text (§8.2)", () => {
  it("the scanned set is exactly the v1.4c lessons (plus any future file)", () => {
    // Pinning the expectation keeps the scan from quietly shrinking:
    // a new file must be scanned (good) or exempted (visible here).
    expect(scannedIds()).toEqual(["nj-by-hand", "upgma-vs-nj-matrix"]);
  });

  it.each(scannedIds())("%s has no digits outside the allowlist", (id) => {
    const ex = JSON.parse(
      readFileSync(resolve(EXERCISES, `${id}.json`), "utf8"),
    ) as LessonText;
    const fields: [string, string | null][] = [
      ["title", ex.title],
      ["summary", ex.summary],
      ...(ex.meta?.objectives ?? []).map(
        (o, i): [string, string] => [`meta.objectives[${i}]`, o],
      ),
      ...ex.prompts.flatMap(
        (p): [string, string | null][] => [
          [`prompt@${p.at_step}.concept`, p.concept],
          [`prompt@${p.at_step}.math`, p.math],
          [`prompt@${p.at_step}.reveal`, p.reveal],
        ],
      ),
    ];
    for (const [field, text] of fields) {
      if (text == null) continue;
      const found = digitsOutsideAllowlist(text);
      expect(
        found,
        `${id} ${field} contains digit(s) ${JSON.stringify(found)}: ${text}`,
      ).toBeNull();
    }
  });
});
