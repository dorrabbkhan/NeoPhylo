// Worksheet builder tests (v1.4c plan Task 11, spec §7.2 and Review
// Focus 5). The pinned rule: every number a key shows equals the
// engine's worksheetFacts / trace / seeded-run value — nothing is
// recomputed or typed into a content file.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { Exercise } from "../engine/generated/Exercise";
import type { ExerciseMeta } from "../engine/generated/ExerciseMeta";
import type { Prompt } from "../engine/generated/Prompt";
import { loadLab, listLabs } from "../labs/registry";
import type { LabExercise } from "../labs/registry";

import {
  bootstrapKeyFacts,
  companionKey,
  companionSheet,
  exerciseDistanceInput,
  handSteps,
  paperKey,
  paperSheet,
  worksheetRun,
} from "./build";
import { qrMatrix } from "./qr";

/** The nj_wikipedia5 matrix (fixtures/inputs/matrix/wiki5_lower.phy):
 * a parser and tie fixture — its step-2 tie is the four-active
 * complement tie. */
const WIKI5: DistanceInput = {
  names: ["A", "B", "C", "D", "E"],
  lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
};

const META: ExerciseMeta = {
  objectives: [],
  minutes: 10,
  level: "intro",
  prepares_for: [],
};

const LESSON_FILES = import.meta.glob<string>("../../../exercises/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

function loadExercise(text: string): Exercise {
  const r = engine.loadExercise(text);
  if (!r.ok) throw new Error(`exercise failed to load: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Every shipped exercise: lessons (minus the schema file) and labs. */
function allExercises(): { id: string; src: Exercise | LabExercise }[] {
  const out: { id: string; src: Exercise | LabExercise }[] = [];
  for (const [path, text] of Object.entries(LESSON_FILES)) {
    // content-hashes.json is engine metadata (v1.5 Task 6), not a lesson.
    if (path.endsWith("schema.json") || path.endsWith("content-hashes.json"))
      continue;
    out.push({ id: path, src: loadExercise(text) });
  }
  for (const lab of listLabs()) {
    const r = loadLab(lab.id);
    if (r.ok) out.push({ id: lab.id, src: r.value });
  }
  return out;
}

function runFor(src: Exercise | LabExercise) {
  const ex = "exercise" in src ? src.exercise : src;
  const input = exerciseDistanceInput(ex);
  if (input === null) return null;
  const dm = engine.matrixToDistances(input);
  if (!dm.ok) throw new Error(JSON.stringify(dm.error));
  const run = worksheetRun(dm.value, ex.analysis.method);
  if (!run.ok) throw new Error(JSON.stringify(run.error));
  return run.value;
}

/** A custom matrix exercise, validated through the real loader. */
function matrixExercise(
  input: DistanceInput,
  method: "NJ" | "UPGMA",
  prompts: Partial<Prompt>[] = [],
): Exercise {
  return loadExercise(
    JSON.stringify({
      schema_version: 5,
      id: "custom-test",
      title: "Custom matrix",
      summary: "test",
      alphabet: "dna",
      data: {
        kind: "matrix",
        names: input.names,
        lower: input.lower,
        source: { citation: "t", license: "t", accessions: [] },
      },
      analysis: { method },
      locked: [],
      prompts: prompts.map((p, i) => ({
        at_step: i + 1,
        type: "note",
        concept: "c",
        math: null,
        reveal: null,
        reveal_pair: null,
        after: null,
        ...p,
      })),
    }),
  );
}

function pairText(pair: [string, string]): string {
  return `${pair[0]}–${pair[1]}`;
}

describe("handSteps", () => {
  it("works every join for n ≤ 6", () => {
    const dm = engine.matrixToDistances(WIKI5);
    if (!dm.ok) throw new Error("matrix failed");
    const run = worksheetRun(dm.value, "Nj");
    if (!run.ok) throw new Error(JSON.stringify(run.error));
    const joins = run.value.joins.length;
    expect(handSteps(5, joins)).toBe(joins);
    expect(handSteps(6, joins)).toBe(joins);
  });

  it("works the first two joins for 7–8 taxa", () => {
    expect(handSteps(8, 6)).toBe(2);
    expect(handSteps(7, 6)).toBe(2);
  });

  it("lets meta.hand_steps win and caps it at the join count", () => {
    expect(handSteps(5, 3, { ...META, hand_steps: 1 })).toBe(1);
    expect(handSteps(5, 3, { ...META, hand_steps: 2 })).toBe(2);
    expect(handSteps(8, 6, { ...META, hand_steps: 4 })).toBe(4);
    expect(handSteps(5, 3, { ...META, hand_steps: 9 })).toBe(3);
  });
});

describe("paperSheet", () => {
  it("is null for exercises with more than 8 taxa", () => {
    const seqboot = loadLab("seqboot-consense");
    if (!seqboot.ok) throw new Error("lab missing");
    expect(seqboot.value.exercise.data.kind).toBe("embedded");
    expect(paperSheet(seqboot.value, "?lab=seqboot-consense")).toBeNull();
  });

  it("builds a sheet for nj-by-hand with the supplied matrix", () => {
    const ex = LESSON_FILES["../../../exercises/nj-by-hand.json"];
    const exercise = loadExercise(ex);
    const sheet = paperSheet(exercise, "?lesson=nj-by-hand");
    expect(sheet).not.toBeNull();
    if (sheet === null) return;
    expect(sheet.matrix.names.length).toBe(5);
    expect(sheet.method).toBe("Nj");
    expect(sheet.minutes).toBe(20);
    expect(sheet.link).toBe("?lesson=nj-by-hand");
    const run = runFor(exercise);
    if (run === null) throw new Error("run failed");
    expect(sheet.handSteps).toBe(run.joins.length);
  });

  it("uses lab.minutes for a lab paper sheet", () => {
    const lab = loadLab("mega-jc69-vs-k2p");
    if (!lab.ok) throw new Error("lab missing");
    const sheet = paperSheet(lab.value, "?lab=mega-jc69-vs-k2p");
    expect(sheet).not.toBeNull();
    if (sheet === null) return;
    expect(sheet.minutes).toBe(30);
    expect(sheet.handSteps).toBe(2); // 7 taxa
  });
});

describe("key numbers come from worksheetFacts", () => {
  it("every built-in exercise's paper key carries the engine's joins", () => {
    const seen: string[] = [];
    for (const { id, src } of allExercises()) {
      const sheet = paperSheet(src, "test-link");
      if (sheet === null) continue; // >8 taxa: no paper sheet
      const run = runFor(src);
      if (run === null) throw new Error(`${id}: no run`);
      const key = paperKey(sheet, run.joins, run.build.tree);
      expect(key.joins, id).toEqual(run.joins);
      seen.push(id);
    }
    // Sanity: several built-ins actually have paper sheets.
    expect(seen.length).toBeGreaterThanOrEqual(6);
  });

  it("answers every predict_pair with the engine's joined pair", () => {
    for (const { id, src } of allExercises()) {
      const ex = "exercise" in src ? src.exercise : src;
      const sheet = companionSheet(src);
      const run = runFor(src);
      const boot = bootstrapKeyFacts(ex);
      if (!boot.ok) throw new Error(`${id}: ${JSON.stringify(boot.error)}`);
      const key = companionKey(sheet, src, {
        joins: run?.joins ?? null,
        bootstrap: boot.value,
      });
      expect(key.answers.length, id).toBe(sheet.items.length);
      ex.prompts.forEach((p, i) => {
        if (p.type !== "predict_pair") return;
        const answer = key.answers[i];
        const join = run?.joins.find((j) => j.step === p.at_step);
        if (join === undefined) throw new Error(`${id}: no join at ${p.at_step}`);
        expect(answer, `${id} step ${p.at_step}`).not.toBeNull();
        expect(answer).toContain(join.chosen[0]);
        expect(answer).toContain(join.chosen[1]);
        for (const t of join.tied) {
          expect(answer, `${id} tied pair`).toContain(t[0]);
          expect(answer, `${id} tied pair`).toContain(t[1]);
        }
      });
    }
  });
});

describe("ties (Review Focus 5)", () => {
  it("wiki5's step-2 join is the four-active complement tie", () => {
    const dm = engine.matrixToDistances(WIKI5);
    if (!dm.ok) throw new Error("matrix failed");
    const r = worksheetRun(dm.value, "Nj");
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const step2 = r.value.joins[1];
    expect(step2.step).toBe(2);
    expect(step2.tied.length).toBe(2);
    expect(step2.tie_same_split).toBe(true);
  });

  it("a tied predict_pair key lists every tied pair and the same-tree note", () => {
    const ex = matrixExercise(WIKI5, "NJ", [
      { type: "predict_pair", at_step: 2 },
    ]);
    const sheet = companionSheet(ex);
    const run = runFor(ex);
    if (run === null) throw new Error("run failed");
    const key = companionKey(sheet, ex, {
      joins: run.joins,
      bootstrap: null,
    });
    const step2 = run.joins[1];
    expect(step2.tied.length).toBe(2);
    const answer = key.answers[0];
    expect(answer).not.toBeNull();
    for (const t of step2.tied) {
      expect(answer).toContain(t[0]);
      expect(answer).toContain(t[1]);
    }
    expect(answer).toContain("same tree");
    expect(answer).toContain(pairText(step2.chosen));
  });
});

describe("edge cases (Review Focus 5)", () => {
  it("a 3-taxon exercise yields exactly one join block", () => {
    const input: DistanceInput = {
      names: ["a", "b", "c"],
      lower: [1, 2, 3],
    };
    const ex = matrixExercise(input, "NJ");
    const run = runFor(ex);
    if (run === null) throw new Error("run failed");
    expect(run.joins.length).toBe(1);
    const sheet = paperSheet(ex, "#x=t");
    if (sheet === null) throw new Error("sheet missing");
    expect(sheet.handSteps).toBe(1);
  });

  it("a zero distance renders without NaN or Infinity", () => {
    const input: DistanceInput = {
      names: ["a", "b", "c", "d"],
      lower: [0, 2, 3, 4, 5, 6],
    };
    const ex = matrixExercise(input, "NJ");
    const run = runFor(ex);
    if (run === null) throw new Error("run failed");
    const sheet = paperSheet(ex, "#x=t");
    if (sheet === null) throw new Error("sheet missing");
    const key = paperKey(sheet, run.joins, run.build.tree);
    for (const j of key.joins) {
      for (const v of [j.len_i, j.len_j]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("a UPGMA worksheet has no row sums — cluster averages replace Q", () => {
    const ex = matrixExercise(WIKI5, "UPGMA");
    const run = runFor(ex);
    if (run === null) throw new Error("run failed");
    expect(run.joins.every((j) => j.row_sums === null)).toBe(true);
  });
});

describe("common mistakes", () => {
  it("names only a closest pair outside the tie — tied-correct and final joins produce none", () => {
    const ex = loadExercise(LESSON_FILES["../../../exercises/nj-by-hand.json"]);
    const run = runFor(ex);
    if (run === null) throw new Error("run failed");
    const sheet = paperSheet(ex, "?lesson=nj-by-hand");
    if (sheet === null) throw new Error("sheet missing");
    const key = paperKey(sheet, run.joins, run.build.tree);
    // nj-by-hand: join 1's closest pair d–e is not among the tied
    // pairs → one mistake. Join 2's closest d–e IS in `tied` →
    // picking it is a correct answer, no line. Join 3 is the final
    // three-way join → no choice, no line (fix round 1, R2 + R3).
    expect(key.mistakes).toEqual([
      "Join 1: picking d–e because their distance is smallest.",
    ]);
  });

  it("a closest pair in `tied` is a correct answer on wiki5 too", () => {
    const ex = matrixExercise(WIKI5, "NJ");
    const run = runFor(ex);
    if (run === null) throw new Error("run failed");
    const sheet = paperSheet(ex, "#x=t");
    if (sheet === null) throw new Error("sheet missing");
    const key = paperKey(sheet, run.joins, run.build.tree);
    // wiki5 mirrors nj-by-hand: join 1's D–E is closest but wrong,
    // join 2's closest D–E is tied with the join → correct.
    const step2 = run.joins[1];
    expect(step2.closest.length).toBe(1);
    expect(
      step2.tied.some(
        (t) =>
          (t[0] === step2.closest[0][0] && t[1] === step2.closest[0][1]) ||
          (t[0] === step2.closest[0][1] && t[1] === step2.closest[0][0]),
      ),
    ).toBe(true);
    expect(key.mistakes).toEqual([
      "Join 1: picking D–E because their distance is smallest.",
    ]);
  });

  it("no built-in key names a mistake for the final join", () => {
    let finals = 0;
    for (const { id, src } of allExercises()) {
      const sheet = paperSheet(src, "test-link");
      if (sheet === null) continue;
      const run = runFor(src);
      if (run === null) throw new Error(`${id}: no run`);
      const key = paperKey(sheet, run.joins, run.build.tree);
      const finalSteps = new Set(
        run.joins.filter((j) => j.final_join).map((j) => j.step),
      );
      finals += finalSteps.size;
      for (const m of key.mistakes) {
        const step = Number(/^Join (\d+):/.exec(m)?.[1]);
        expect(finalSteps.has(step), `${id}: ${m}`).toBe(false);
      }
    }
    expect(finals).toBeGreaterThan(0);
  });
});

describe("companion sheets", () => {
  it("makes one item per prompt, plus one per chain entry for labs", () => {
    const lab = loadLab("seqboot-consense");
    if (!lab.ok) throw new Error("lab missing");
    const sheet = companionSheet(lab.value);
    const prompts = lab.value.exercise.prompts.length;
    const chain = lab.value.lab.chain.length;
    expect(sheet.items.length).toBe(prompts + chain);
    expect(sheet.items.filter((i) => i.step === "lab").length).toBe(chain);
    expect(
      sheet.items.some((i) => i.step === "bootstrap"),
      "predict_branch item",
    ).toBe(true);
  });

  it("a bootstrap lab key carries the fixed sampling-noise caption", () => {
    const lab = loadLab("seqboot-consense");
    if (!lab.ok) throw new Error("lab missing");
    const sheet = companionSheet(lab.value);
    const boot = bootstrapKeyFacts(lab.value.exercise);
    if (!boot.ok) throw new Error(JSON.stringify(boot.error));
    const key = companionKey(sheet, lab.value, {
      joins: null,
      bootstrap: boot.value,
    });
    expect(key.caption).toBe(
      "Your numbers from MEGA or PHYLIP will differ by sampling noise.",
    );
  });

  it("the seeded run's values answer the predict_branch item", () => {
    const lab = loadLab("seqboot-consense");
    if (!lab.ok) throw new Error("lab missing");
    const boot = bootstrapKeyFacts(lab.value.exercise);
    if (!boot.ok || boot.value === null) throw new Error("no bootstrap facts");
    expect(boot.value.replicates).toBe(100);
    expect(boot.value.seed).toBe(8675309);
    expect(boot.value.supports.length).toBe(9); // 12 taxa, NJ → n−3
    const sheet = companionSheet(lab.value);
    const key = companionKey(sheet, lab.value, {
      joins: null,
      bootstrap: boot.value,
    });
    const idx = sheet.items.findIndex((i) => i.step === "bootstrap");
    const answer = key.answers[idx];
    expect(answer).not.toBeNull();
    expect(answer).toContain(`${boot.value.least.count} of 100`);
    for (const name of boot.value.least.grouping) {
      expect(answer).toContain(name);
    }
  });
});

describe("qrMatrix", () => {
  it("matches a known-good encoding of a fixed string — every module", () => {
    // The full 29×29 module matrix (version 3, ECC L, mask 5) for the
    // fixed text — every module pinned, not just size and the finder
    // patterns (fix round 1, review 3). uqr's output was verified
    // byte-identical against Kazuhiko Arase's qrcode-generator; no
    // independent implementation exists in the local npm caches (only
    // uqr itself), so this pin guards the dependency against
    // regressions.
    const expected =
      "11111110101011001101001111111\n" +
      "10000010011110101010001000001\n" +
      "10111010111001000010101011101\n" +
      "10111010111011100101001011101\n" +
      "10111010100110110001101011101\n" +
      "10000010001101000011001000001\n" +
      "11111110101010101010101111111\n" +
      "00000000001010000100000000000\n" +
      "11110010101110110111110011101\n" +
      "11000001101011001011111110001\n" +
      "10001110011111000110001100110\n" +
      "10110100111001011010001000001\n" +
      "01110011111011110100100101100\n" +
      "10000100010110111111011000111\n" +
      "11001111001101100101100110111\n" +
      "01111000000100011000100100010\n" +
      "10100010101010110010110111010\n" +
      "01101000111000011010100101110\n" +
      "10110110000001110110001110100\n" +
      "00100000111101110110000000100\n" +
      "01101010010001111111111111100\n" +
      "00000000101000001111100011111\n" +
      "11111110011000100011101011010\n" +
      "10000010001111110010100011001\n" +
      "10111010010100000100111110111\n" +
      "10111010100101011000010111001\n" +
      "10111010101010100110100100101\n" +
      "10000010100011011010101001010\n" +
      "11111110100100011000111010010";
    const text = "https://neophylo.test/?lesson=nj-by-hand";
    const m = qrMatrix(text);
    expect(m).not.toBeNull();
    if (m === null) return;
    const rendered = m.map((row) => row.map((b) => (b ? "1" : "0")).join(""));
    expect(rendered.join("\n")).toBe(expected);
  });

  it("encodes every built-in paper sheet's link", () => {
    for (const { id, src } of allExercises()) {
      const isLab = "exercise" in src;
      const link = `https://neophylo.test/?${isLab ? "lab" : "lesson"}=${id}`;
      const sheet = paperSheet(src, link);
      if (sheet === null) continue;
      expect(qrMatrix(sheet.link), id).not.toBeNull();
    }
  });

  it("returns null for a link beyond QR capacity", () => {
    expect(qrMatrix(`https://neophylo.test/#x=${"a".repeat(4000)}`)).toBeNull();
  });
});
