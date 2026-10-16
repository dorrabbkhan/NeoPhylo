// Built-in lesson content checks (plan Task 23, checkpoint 7). Every
// exercises/*.json file must load through the engine, carry real prose
// (no empty or "…" prompt text), keep predict_pair off NJ's final
// three-way join — there is no pair to predict — and stay inside the
// stepper's position range so each prompt can actually appear.
//
// The final-join check builds each lesson's pipeline for real; lessons
// whose own parameters block the build (saturation) fall back to the
// tree's leaf count — a structurally identical check.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { engine } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import { traceLength } from "../views/stepMatrix";

const EXERCISES = resolve("..", "exercises");

const lessonFiles = () =>
  readdirSync(EXERCISES)
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
    .sort();

const load = (file: string): Exercise => {
  const r = engine.loadExercise(
    readFileSync(resolve(EXERCISES, file), "utf8"),
  );
  if (!r.ok) throw new Error(`${file}: ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("exercises/*.json lesson content", () => {
  it("every prompt has real concept/math/reveal text — no empty or '…'", () => {
    for (const f of lessonFiles()) {
      const ex = load(f);
      for (const p of ex.prompts) {
        for (const [field, text] of [
          ["concept", p.concept],
          ["math", p.math],
          ["reveal", p.reveal],
        ] as const) {
          if (text === null) continue;
          expect(text.trim(), `${f} prompt ${p.at_step} ${field}`).not.toBe("");
          expect(text.trim(), `${f} prompt ${p.at_step} ${field}`).not.toBe("…");
        }
      }
    }
  });

  it("no predict_pair targets a final join, and at_step stays in range", () => {
    for (const f of lessonFiles()) {
      const ex = load(f);
      const tt = engine.parseNewick(ex.true_tree);
      expect(tt.ok, `${f} true_tree parses`).toBe(true);
      if (!tt.ok) continue;

      // Number of joins / stepper positions, from the built trace when
      // the pipeline succeeds, else from the tree's leaf count.
      const leafCount = tt.value.nodes.filter(
        (n) => n.children.length === 0,
      ).length;
      const sim = engine.simulate(tt.value, ex.sim);
      const dm = sim.ok
        ? engine.distances(sim.value, ex.analysis.correction)
        : null;
      const built =
        dm && dm.ok
          ? engine.buildTree(dm.value, ex.analysis.method, { trace: true })
          : null;

      let steps: number;
      let positions: number;
      let isNj: boolean;
      if (built && built.ok) {
        const trace = built.value.trace!;
        isNj = "Nj" in trace;
        steps = traceLength(trace);
        positions = steps + (isNj ? 1 : 0); // NJ's last position is the
        // three-way final join; UPGMA's last step is its final position.
      } else {
        isNj = ex.analysis.method === "Nj";
        positions = isNj ? leafCount - 2 : leafCount - 1;
        steps = isNj ? leafCount - 3 : leafCount - 1;
      }
      const finalJoin = steps + 1;

      for (const p of ex.prompts) {
        expect(
          p.at_step,
          `${f} at_step ${p.at_step} beyond the completed tree`,
        ).toBeLessThanOrEqual(positions + 1);
        if (p.type === "predict_pair") {
          expect(
            p.at_step,
            `${f}: predict_pair at join ${p.at_step} has no pair to predict`,
          ).toBeLessThan(finalJoin);
        }
      }
    }
  });
});
