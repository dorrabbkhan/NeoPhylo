// Lab registry tests (v1.4 plan Task 11, spec §6.2/§6.5). The shipped
// registry is exercises/labs/*.json — Task 12 pack 1 lands
// dnadist-neighbor there — plus the e2e-only files in __fixtures__/
// that join only under the `neophylo-e2e` localStorage flag. A lab file is an
// exercise with a `lab` block: loadLab validates the whole file
// against exercises/schema.json and through engine.loadExercise, and
// a registry file without the block is refused with the reason.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listLabs, loadLab } from "./registry";

beforeEach(() => {
  window.localStorage.setItem("neophylo-e2e", "1");
});

afterEach(() => {
  window.localStorage.removeItem("neophylo-e2e");
});

describe("lab registry", () => {
  it("lists lab files and skips registry files without a valid lab block", () => {
    const labs = listLabs();
    const ids = labs.map((l) => l.id);
    expect(ids).toContain("test-lab");
    expect(ids).not.toContain("no-lab-block");
    expect(ids).not.toContain("bad-lab");
    const lab = labs.find((l) => l.id === "test-lab");
    expect(lab?.title).toBe("Test lab: dnadist → neighbor");
    expect(lab?.objectives.length).toBe(2);
    expect(lab?.chain).toEqual(["dnadist", "neighbor"]);
    expect(lab?.settings.length).toBe(3);
  });

  it("with the e2e flag off only shipped labs list — the dnadist-neighbor pack", () => {
    window.localStorage.removeItem("neophylo-e2e");
    expect(listLabs().map((l) => l.id)).toEqual(["dnadist-neighbor"]);
  });

  it("loadLab returns the exercise and the lab block for a valid lab file", () => {
    const r = loadLab("test-lab");
    if (!r.ok) throw new Error(`test-lab must load: ${JSON.stringify(r.error)}`);
    expect(r.value.lab.title).toBe("Test lab: dnadist → neighbor");
    expect(r.value.exercise.title).toBe("Test lab: dnadist chain");
    expect(r.value.exercise.analysis.method).toBe("Nj");
    expect(r.value.exercise.bootstrap).toEqual({ replicates: 100, seed: 7 });
  });

  it("a registry file without its lab block is refused at load with the reason", () => {
    const r = loadLab("no-lab-block");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidExercise");
    if (r.error.kind === "InvalidExercise") {
      expect(r.error.msg).toMatch(/lab block/i);
    }
  });

  it("a lab file whose lab block fails the schema is refused naming the field", () => {
    const r = loadLab("bad-lab");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidExercise");
    if (r.error.kind === "InvalidExercise") {
      expect(`${r.error.field}: ${r.error.msg}`).toMatch(/chain/i);
    }
  });

  it("an unknown lab id is a readable refusal, not a throw", () => {
    const r = loadLab("no-such-lab");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("InvalidExercise");
  });
});
