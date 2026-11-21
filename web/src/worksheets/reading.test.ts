// Reading worksheet/key builder tests (v1.4d plan Task 13, spec §8.4).
// The pinned behaviours:
//
// - every built-in set's key item equals `readingAnswer` — the
//   explanation verbatim, the authored flag verbatim, and the rendered
//   answer carrying every accepted value (tips, letters, numbers,
//   option texts); TypeScript formats, it never derives
// - the student sheet's whole text contains no key text: no engine
//   explanation, no note_after, no "authored answer" label
// - an `order_nodes` key states the accepted-order rule — "any order
//   consistent with ancestry" when the tree carries no ages
// - every key item whose key is authored is labelled "authored answer"
// - every sheet item draws each shown tree in its authored style and
//   gets answer space matching its control type
//
// Sets load straight off disk — every shipped file plus the coverage
// directory, the same corpus the content oracle tests.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { engine, initEngine } from "../engine/index";
import type { Accepted } from "../engine/generated/Accepted";
import type { Question } from "../engine/generated/Question";
import type { ReadingSet } from "../engine/generated/ReadingSet";
import { readErrorMessage } from "../reading/errors";
import { fillItemText, fillPlaceholders } from "../reading/state";

import { paperText, readingKey, readingSheet } from "./reading";
import type { SheetSpace } from "./reading";

const READING = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "exercises",
  "reading",
);

const FILES = [
  ...readdirSync(READING)
    .filter((f) => f.endsWith(".json"))
    .map((f) => resolve(READING, f)),
  ...readdirSync(resolve(READING, "coverage"))
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => resolve(READING, "coverage", f)),
];

const SETS = new Map<string, ReadingSet>();

function stem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

beforeAll(async () => {
  await initEngine();
  for (const f of FILES) {
    const r = engine.loadReadingSet(readFileSync(f, "utf8"));
    if (!r.ok) throw new Error(`${f} failed to load: ${readErrorMessage(r.error)}`);
    SETS.set(stem(f), r.value);
  }
});

/** The effective question — a two-tier item's taps and controls feed
 * its first question (same rule ItemView's tapQuestion applies). */
function effective(q: Question): Question {
  return q.type === "two_tier" ? q.first : q;
}

/** The tips an accepted answer names, for the key text check. */
function acceptedTips(acc: Accepted): string[] {
  switch (acc.kind) {
    case "clade":
    case "tip_set":
    case "any_tip_of":
      return acc.value;
    default:
      return [];
  }
}

describe("readingKey", () => {
  it("every built-in item's key equals readingAnswer", () => {
    for (const [id, set] of SETS) {
      const k = readingKey(set);
      expect(k.ok, `${id} key builds`).toBe(true);
      if (!k.ok) continue;
      expect(k.value.items, `${id} item count`).toHaveLength(
        set.items.length,
      );
      for (let i = 0; i < set.items.length; i += 1) {
        const a = engine.readingAnswer(set, i);
        expect(a.ok, `${id}#${set.items[i].id} answers`).toBe(true);
        if (!a.ok) continue;
        const got = k.value.items[i];
        const want = a.value;
        // The engine's fields land verbatim — the key never
        // paraphrases or recomputes.
        expect(got.explanation, `${id}#${got.id} explanation`).toBe(
          want.explanation,
        );
        expect(got.authored, `${id}#${got.id} authored flag`).toBe(
          want.authored,
        );
        expect(got.text, `${id}#${got.id} question text`).toBe(
          paperText(set.items[i]),
        );
        // The rendered answer carries every accepted value — tips,
        // letters and numbers are engine data the sheet shows.
        const inner =
          want.accepted.kind === "two_tier"
            ? want.accepted.value.first
            : want.accepted;
        for (const tip of acceptedTips(inner)) {
          expect(
            got.answer,
            `${id}#${got.id} answer names ${tip}`,
          ).toContain(tip);
        }
        if (inner.kind === "number") {
          expect(got.answer, `${id}#${got.id} number`).toContain(
            String(inner.value),
          );
        }
        if (inner.kind === "point") {
          expect(got.answer, `${id}#${got.id} point`).toContain(
            inner.value,
          );
        }
        if (want.accepted.kind === "two_tier") {
          const reasons = (
            set.items[i].question as { reasons: string[] }
          ).reasons;
          expect(
            got.answer,
            `${id}#${got.id} reason`,
          ).toContain(reasons[want.accepted.value.reason]);
        }
      }
    }
  });

  it("order_nodes keys state the accepted-order rule", () => {
    let sawAncestry = false;
    let sawAges = false;
    for (const [, set] of SETS) {
      const k = readingKey(set);
      if (!k.ok) continue;
      set.items.forEach((item, i) => {
        if (effective(item.question).type !== "order_nodes") return;
        const acc = (() => {
          const a = engine.readingAnswer(set, i);
          return a.ok ? a.value.accepted : null;
        })();
        const rule =
          acc !== null && acc.kind === "orders" ? acc.value.rule : null;
        const text = `${k.value.items[i].answer} ${k.value.items[i].explanation}`;
        if (rule === "ancestry") {
          sawAncestry = true;
          expect(
            text,
            `${item.id} names the ancestry order rule`,
          ).toContain("order consistent with ancestry");
        } else if (rule !== null) {
          sawAges = true;
          expect(text, `${item.id} names the by-age rule`).toMatch(
            /by age/,
          );
        }
      });
    }
    // The corpus really exercises both rules, so a missing phrase
    // can't hide behind a missing set.
    expect(sawAncestry).toBe(true);
    expect(sawAges).toBe(true);
  });

  it("select_true keys name each true statement by its printed text", () => {
    let saw = 0;
    for (const [id, set] of SETS) {
      const k = readingKey(set);
      if (!k.ok) continue;
      set.items.forEach((item, i) => {
        const q = effective(item.question);
        if (q.type !== "select_true") return;
        const a = engine.readingAnswer(set, i);
        expect(a.ok, `${id}#${item.id} answers`).toBe(true);
        if (!a.ok) return;
        const acc =
          a.value.accepted.kind === "two_tier"
            ? a.value.accepted.value.first
            : a.value.accepted;
        if (acc.kind !== "statements") return;
        saw += 1;
        const answer = k.value.items[i].answer;
        // The engine's truth flags against the same filled texts the
        // sheet printed — a marker matches words, never an index.
        const texts = q.statements.map((s) =>
          fillPlaceholders(s.text, item),
        );
        acc.value.forEach((truth, j) => {
          if (truth) {
            expect(
              answer,
              `${id}#${item.id} omits a true statement`,
            ).toContain(texts[j]);
          } else {
            expect(
              answer,
              `${id}#${item.id} names a false statement`,
            ).not.toContain(texts[j]);
          }
        });
        expect(
          answer,
          `${id}#${item.id} prints a statement index`,
        ).not.toMatch(/\bstatements? \d/);
      });
    }
    expect(saw).toBeGreaterThan(0);
  });

  it("every authored key item is labelled", () => {
    let authored = 0;
    for (const [id, set] of SETS) {
      const k = readingKey(set);
      if (!k.ok) continue;
      k.value.items.forEach((item, i) => {
        const a = engine.readingAnswer(set, i);
        if (!a.ok || !a.value.authored) return;
        authored += 1;
        expect(item.authored, `${id}#${item.id} flag`).toBe(true);
        expect(item.label, `${id}#${item.id} label`).toBe(
          "authored answer",
        );
      });
    }
    expect(authored).toBeGreaterThan(0);
  });
});

describe("readingSheet", () => {
  it("every built-in set's sheet text contains no key text", () => {
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "https://neo.test/?read=x");
      const k = readingKey(set);
      expect(k.ok, `${id} key builds`).toBe(true);
      if (!k.ok) continue;
      expect(sheet.items, `${id} sheet item count`).toHaveLength(
        set.items.length,
      );
      const text = JSON.stringify(sheet);
      for (let i = 0; i < set.items.length; i += 1) {
        const item = set.items[i];
        const key = k.value.items[i];
        // The engine explanation never leaks — except concept items,
        // whose explanation is authored option text the sheet shows.
        if (item.question.type !== "concept") {
          expect(
            text,
            `${id}#${item.id} leaks its explanation`,
          ).not.toContain(key.explanation);
        }
        // note_after is the post-answer note — it names the answer in
        // several sets, so it never prints on the student sheet.
        if (item.note_after !== undefined) {
          expect(
            text,
            `${id}#${item.id} leaks note_after`,
          ).not.toContain(fillPlaceholders(item.note_after, item));
        }
      }
      expect(text, `${id} leaks the authored label`).not.toContain(
        "authored answer",
      );
    }
  });

  it("draws every shown tree in the item's authored style", () => {
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "x");
      for (let i = 0; i < set.items.length; i += 1) {
        const item = set.items[i];
        const drawn = sheet.items[i].trees;
        // Shown trees: reference first, then the item's trees, then a
        // which_fits item's small trees — the app's own order.
        const q = item.question;
        const names = [
          ...(q.type === "which_differs" && q.reference !== undefined
            ? [q.reference]
            : []),
          ...item.trees,
          ...(q.type === "which_fits" ? q.small : []),
        ];
        const refCount = names.length - item.trees.length -
          (q.type === "which_fits" ? q.small.length : 0);
        expect(
          drawn.map((t) => t.name),
          `${id}#${item.id} shown trees`,
        ).toEqual(names);
        drawn.forEach((t, j) => {
          const own = j - refCount;
          // The item's own trees take per_tree[i]; the rest take the
          // item's base style — both falling back to the app default.
          const s = item.style;
          const want =
            s === undefined
              ? { shape: "rectangular", tips: "right" }
              : own >= 0 &&
                  own < item.trees.length &&
                  s.per_tree[own] !== undefined
                ? {
                    shape: s.per_tree[own].shape,
                    tips: s.per_tree[own].tips,
                  }
                : { shape: s.shape, tips: s.tips };
          expect(t.style, `${id}#${item.id} style of ${t.name}`).toEqual(
            want,
          );
        });
      }
    }
  });

  it("every item's answer space matches its control type", () => {
    const seen = new Set<string>();
    const walk = (space: SheetSpace, q: Question, ctx: string) => {
      seen.add(q.type);
      switch (q.type) {
        case "which_differs":
        case "which_fits":
        case "is_clade":
          expect(space.kind, ctx).toBe("options");
          if (space.kind === "options") {
            expect(space.multi, ctx).toBe(false);
            expect(space.options.length, ctx).toBeGreaterThan(0);
          }
          break;
        case "concept":
        case "select_true":
          expect(space.kind, ctx).toBe("options");
          if (space.kind === "options") {
            expect(space.multi, ctx).toBe(true);
          }
          break;
        case "count_clades":
          expect(space.kind, ctx).toBe("number");
          break;
        case "order_nodes":
          expect(space.kind, ctx).toBe("order");
          if (space.kind === "order") {
            expect(space.letters, ctx).toEqual(q.nodes);
          }
          break;
        case "mrca":
          if (q.options !== undefined) {
            expect(space.kind, ctx).toBe("options");
          } else {
            expect(space.kind, ctx).toBe("line");
          }
          break;
        case "place_taxon":
          expect(space.kind, ctx).toBe("options");
          break;
        case "smallest_clade":
          expect(space.kind, ctx).toBe("line");
          break;
        case "closest_relative":
          if (q.form === "pairwise") {
            expect(space.kind, ctx).toBe("options");
          } else {
            expect(space.kind, ctx).toBe("line");
          }
          break;
        case "trait": {
          const ask = q.ask.kind;
          seen.add(`trait:${ask}`);
          if (ask === "which_have" || ask === "has_not") {
            expect(space.kind, ctx).toBe("line");
          } else if (ask === "how_many_changes") {
            expect(space.kind, ctx).toBe("number");
          } else {
            expect(space.kind, ctx).toBe("options");
          }
          break;
        }
        case "two_tier":
          expect(space.kind, ctx).toBe("two_tier");
          if (space.kind === "two_tier") {
            expect(space.reasons, ctx).toEqual(q.reasons);
            walk(space.first, q.first, ctx);
          }
          break;
      }
    };
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "x");
      sheet.items.forEach((si, i) => {
        walk(si.space, set.items[i].question, `${id}#${si.id}`);
      });
    }
    // The corpus really covers every question kind — a new kind the
    // builder forgot would leave the set untested.
    for (const t of [
      "which_differs",
      "which_fits",
      "mrca",
      "place_taxon",
      "is_clade",
      "smallest_clade",
      "closest_relative",
      "count_clades",
      "order_nodes",
      "select_true",
      "trait",
      "concept",
      "two_tier",
      "trait:which_have",
      "trait:which_shared",
      "trait:how_many_changes",
      "trait:profile",
      "trait:ancestral_or_derived",
      "trait:has_not",
      "trait:homologous",
    ]) {
      expect(seen, `corpus covers ${t}`).toContain(t);
    }
  });

  it("carries the set title, meta minutes and the open link", () => {
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "https://neo.test/?read=abc");
      expect(sheet.title, id).toBe(set.title);
      expect(sheet.minutes, id).toBe(set.meta?.minutes ?? null);
      expect(sheet.link, id).toBe("https://neo.test/?read=abc");
    }
  });

  it("question text has its placeholders filled", () => {
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "x");
      sheet.items.forEach((si, i) => {
        expect(si.text, `${id}#${si.id} text`).toBe(
          paperText(set.items[i]),
        );
        expect(si.text, `${id}#${si.id} no placeholder`).not.toMatch(
          /\{[abcset]+\}/,
        );
      });
    }
  });
});

describe("paper wording (§21(f))", () => {
  /** The instruction verbs that must never reach paper, at a
   * sentence start. */
  const INSTRUCTION = /(^|[.!?]\s+)(Tap|Click|Drag|Press|Select|Swipe|Hover|Rotate nodes freely)\b/;

  it("no sheet or key text carries a screen instruction verb", () => {
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "x");
      const k = readingKey(set);
      expect(k.ok, `${id} key builds`).toBe(true);
      for (const si of sheet.items) {
        expect(si.text, `${id}#${si.id} sheet text`).not.toMatch(
          INSTRUCTION,
        );
      }
      if (k.ok) {
        for (const ki of k.value.items) {
          expect(ki.text, `${id}#${ki.id} key text`).not.toMatch(
            INSTRUCTION,
          );
        }
      }
    }
  });

  it("every instruction the corpus uses is mapped", () => {
    // Building every sheet and key already throws on an unmapped
    // verb; pin the mappings so a wording change is deliberate.
    const mapped = new Map<string, string>();
    for (const [, set] of SETS) {
      for (const item of set.items) {
        const raw = fillPlaceholders(item.text, item);
        const paper = paperText(item);
        if (raw !== paper) mapped.set(raw, paper);
      }
    }
    expect([...mapped.values()].join("\n")).not.toMatch(INSTRUCTION);
    for (const paper of mapped.values()) {
      expect(paper, `paper text "${paper.slice(0, 60)}"`).not.toMatch(
        /arrange the list/,
      );
    }
  });

  it("an unmapped instruction verb fails the sheet", () => {
    const set = SETS.get("trees-demo")!;
    const bad = {
      ...set,
      items: [
        {
          ...set.items[0],
          text: "Click the node where every lineage last met.",
        },
      ],
    };
    expect(() => readingSheet(bad, "x")).toThrow(/unmapped/);
  });

  it("items without an instruction verb pass through untouched", () => {
    // The app keeps the authored wording; the paper step only edits
    // the sentence-initial verbs it maps — everything else is
    // verbatim.
    for (const [id, set] of SETS) {
      for (const item of set.items) {
        const raw = fillItemText(item);
        if (!INSTRUCTION.test(raw)) {
          expect(paperText(item), `${id}#${item.id} untouched`).toBe(raw);
        }
      }
    }
  });

  it("test-mode sheets are collected; practice sheets keep the QR", () => {
    for (const [id, set] of SETS) {
      const sheet = readingSheet(set, "x");
      expect(
        sheet.test,
        `${id} test flag for mode ${set.mode}`,
      ).toBe(set.mode === "test");
    }
    expect(SETS.get("trees-form-a")?.mode).toBe("test");
    expect(SETS.get("trees-form-b")?.mode).toBe("test");
    expect(SETS.get("trees-demo")?.mode).toBe("practice");
  });
});
