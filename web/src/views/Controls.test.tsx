// Component tests for the alphabet-filtered model menus (v1.1 plan
// Task 10, spec §5.1): the correction menu offers p/JC69/K80 on DNA and
// p/Kimura/JTT on protein, and the simulation menu offers JC69/K80 or
// JTT. The defaults themselves are exercised through the session
// reducer (setAlphabet) in state/session.test.ts.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Alphabet } from "../engine/generated/Alphabet";
import type { SimModel } from "../engine/generated/SimModel";
import type { SimSpec } from "../engine/generated/SimSpec";
import { engine } from "../engine/index";
import type { Action } from "../state/session";
import {
  CORRECTIONS,
  exerciseSim,
  k2pLabel,
  SIM_MODEL_NAMES,
  simModelName,
} from "../state/session";

import { Controls } from "./Controls";
import type { ControlsProps } from "./Controls";

afterEach(cleanup);

const SIM: SimSpec = { model: "Jc69", length: 100, seed: 1 };

function props(overrides: Partial<ControlsProps> = {}): ControlsProps {
  return {
    sim: SIM,
    analysis: { correction: "Jc69", method: "Nj" },
    locked: [],
    matrixView: "distance",
    qAvailable: false,
    alignmentOrigin: "simulated",
    alphabet: "dna",
    dispatch: () => {},
    ...overrides,
  };
}

function optionValues(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

function optionTexts(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.textContent ?? "");
}

describe("Controls — correction menu", () => {
  it("offers p, JC69 and K80 for DNA", () => {
    render(<Controls {...props()} />);
    expect(optionValues("Distance correction")).toEqual([
      "P",
      "Jc69",
      "K80",
    ]);
    expect(optionTexts("Distance correction")).toEqual([
      "p (uncorrected)",
      "JC69",
      "K80",
    ]);
  });

  it("offers p, Kimura and JTT for protein", () => {
    render(
      <Controls
        {...props({
          alphabet: "protein" as Alphabet,
          sim: { model: "Jtt", length: 100, seed: 1 },
          analysis: { correction: "Jtt", method: "Nj" },
        })}
      />,
    );
    expect(optionValues("Distance correction")).toEqual([
      "P",
      "Kimura",
      "Jtt",
    ]);
    expect(optionTexts("Distance correction")).toEqual([
      "p (uncorrected)",
      "Kimura",
      "JTT",
    ]);
  });
});

describe("Controls — simulation menu", () => {
  it("offers JC69 and K80 for DNA", () => {
    render(<Controls {...props()} />);
    expect(optionValues("Simulation model")).toEqual(["Jc69", "K80"]);
    expect(optionTexts("Simulation model")).toEqual(["JC69", "K80"]);
  });

  it("offers only JTT for protein", () => {
    render(
      <Controls
        {...props({
          alphabet: "protein" as Alphabet,
          sim: { model: "Jtt", length: 100, seed: 1 },
          analysis: { correction: "Jtt", method: "Nj" },
        })}
      />,
    );
    expect(optionValues("Simulation model")).toEqual(["Jtt"]);
    expect(optionTexts("Simulation model")).toEqual(["JTT"]);
  });
});

describe("Controls — sim model round-trip (label ↔ SimModel)", () => {
  const modelSelect = () =>
    screen.getByLabelText("Simulation model") as HTMLSelectElement;

  // SimModel → label: the menu shows the model's simple name for every
  // SimModel variant.
  it.each([
    ["dna", "Jc69", "Jc69"],
    ["dna", { K80: { kappa: 3.5 } }, "K80"],
    ["dna", { F84: { kappa: 2, base_freqs: [0.25, 0.25, 0.25, 0.25] } }, "F84"],
    ["protein", "Jtt", "Jtt"],
  ] as [Alphabet, SimModel, string][])(
    "shows %s on the %s alphabet for model %j",
    (alphabet, model, want) => {
      expect(simModelName(model)).toBe(want);
      render(
        <Controls {...props({ alphabet, sim: { ...SIM, model } })} />,
      );
      expect(modelSelect().value).toBe(want);
    },
  );

  // Label → SimModel: picking each menu label dispatches setSim with
  // the matching SimModel.
  it.each([
    ["dna", "Jc69", "K80", { K80: { kappa: 2 } }],
    ["dna", { K80: { kappa: 3.5 } }, "Jc69", "Jc69"],
    ["protein", "Jc69", "Jtt", "Jtt"],
  ] as [Alphabet, SimModel, string, SimModel][])(
    "selecting %s dispatches model %j",
    (alphabet, model, label, want) => {
      const actions: Action[] = [];
      render(
        <Controls
          {...props({
            alphabet,
            sim: { ...SIM, model },
            dispatch: (a) => actions.push(a),
          })}
        />,
      );
      fireEvent.change(modelSelect(), { target: { value: label } });
      expect(actions).toEqual([
        { type: "setSim", patch: { model: want } },
      ]);
    },
  );
});

describe("Controls — select value is always a displayed option", () => {
  // Review item (checkpoint 10): a select whose value is not among its
  // options renders inconsistently across browsers, so the reducer's
  // reconcileModels keeps the session consistent and these tests pin
  // the invariant per alphabet.
  it.each([
    [
      "dna",
      { model: { K80: { kappa: 3 } }, length: 100, seed: 1 } as SimSpec,
      "K80" as const,
    ],
    [
      "protein",
      { model: "Jtt", length: 100, seed: 1 } as SimSpec,
      "Kimura" as const,
    ],
  ])("on the %s alphabet", (alphabet, sim, correction) => {
    render(
      <Controls
        {...props({
          alphabet: alphabet as Alphabet,
          sim,
          analysis: { correction, method: "Nj" },
        })}
      />,
    );
    for (const label of [
      "Simulation model",
      "Distance correction",
      "Tree-building method",
    ]) {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values, `${label} on ${alphabet}`).toContain(select.value);
    }
  });

  it("the empty model option holds the null-sim value", () => {
    render(
      <Controls {...props({ sim: null, alignmentOrigin: "simulated" })} />,
    );
    const select = screen.getByLabelText(
      "Simulation model",
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("");
  });
});

describe("Controls — imported data (checkpoint 11)", () => {
  it("collapses the Simulation section to 'Your sequences: not simulated.'", () => {
    // An imported alignment can't be re-simulated; like embedded lesson
    // data the section renders a single line instead of greyed fields.
    render(<Controls {...props({ alignmentOrigin: "imported" })} />);
    expect(
      screen.getByText("Your sequences: not simulated."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Simulation model")).toBeNull();
    expect(screen.queryByLabelText("Length")).toBeNull();
    expect(screen.queryByLabelText("Seed")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "New seed" }),
    ).toBeNull();
    // The Analysis section is unaffected.
    expect(screen.getByLabelText("Distance correction")).toBeTruthy();
  });
});

describe("Controls — embedded data", () => {
  it("collapses the Simulation section to a real-sequences line", () => {
    // Checkpoint 12: embedded lesson data shows "Real sequences: not
    // simulated." and no sim controls at all — not even disabled ones.
    render(
      <Controls {...props({ sim: null, alignmentOrigin: "embedded" })} />,
    );
    expect(
      screen.getByText("Real sequences: not simulated."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Simulation model")).toBeNull();
    expect(screen.queryByLabelText("Length")).toBeNull();
    expect(screen.queryByLabelText("Seed")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "New seed" }),
    ).toBeNull();
  });
});

describe("Controls — gated Distance/Q", () => {
  it("disables the toggle with an after-you-answer tooltip", () => {
    render(<Controls {...props({ qAvailable: true, qGated: true })} />);
    const toggle = screen.getByRole("switch", { name: "Distance / Q" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.title).toBe("Available after you answer.");
  });

  it("enables the toggle when no prompt gates", () => {
    render(<Controls {...props({ qAvailable: true })} />);
    const toggle = screen.getByRole("switch", {
      name: "Distance / Q",
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.title).toBe("");
  });
});

describe("Controls — non-simulatable data", () => {
  it("shows disabled sim controls with no model name when sim is null", () => {
    // A simulated-origin session with no sim spec keeps the controls
    // but disables every one with the real-sequences tooltip and shows
    // no model. (Imported and embedded data no longer reach this path —
    // their section collapses to a single line, see above.)
    render(
      <Controls {...props({ sim: null, alignmentOrigin: "simulated" })} />,
    );
    const select = screen.getByLabelText(
      "Simulation model",
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("");
    expect(select.title).toBe(
      "This lesson uses real sequences; they can't be re-simulated.",
    );
    for (const label of ["Length", "Seed"]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.title).toBe(
        "This lesson uses real sequences; they can't be re-simulated.",
      );
    }
    expect(
      (screen.getByRole("button", { name: "New seed" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

// v1.4 (Task 10 fix round 1): an exercise file can prescribe models
// the menu never offers — F84 simulation, F84 and K2P_PHYLIP
// corrections. Controls displays each as a conditional option, so the
// loaded lesson no longer crashes or renders an unmatched select. The
// menus for every exercise that doesn't prescribe them are unchanged.
describe("Controls — exercise-prescribed v1.4 models", () => {
  const F84: SimModel = {
    F84: { kappa: 2, base_freqs: [0.25, 0.25, 0.25, 0.25] },
  };

  it("shows F84 in the sim menu only when the exercise prescribes it", () => {
    render(<Controls {...props({ sim: { ...SIM, model: F84 } })} />);
    const select = screen.getByLabelText(
      "Simulation model",
    ) as HTMLSelectElement;
    expect(optionValues("Simulation model")).toEqual([
      "Jc69",
      "K80",
      "F84",
    ]);
    expect(select.value).toBe("F84");
    cleanup();

    render(<Controls {...props()} />);
    expect(optionValues("Simulation model")).toEqual(["Jc69", "K80"]);
  });

  it("shows the F84 correction only when the exercise prescribes it", () => {
    render(
      <Controls
        {...props({
          analysis: { correction: "F84", method: "Nj" },
        })}
      />,
    );
    const select = screen.getByLabelText(
      "Distance correction",
    ) as HTMLSelectElement;
    expect(optionValues("Distance correction")).toEqual([
      "P",
      "Jc69",
      "K80",
      "F84",
    ]);
    expect(select.value).toBe("F84");
    cleanup();

    render(<Controls {...props()} />);
    expect(optionValues("Distance correction")).toEqual([
      "P",
      "Jc69",
      "K80",
    ]);
  });

  it("shows the prescribed K2P ratio in the correction option's label", () => {
    render(
      <Controls
        {...props({
          analysis: {
            correction: { K2pPhylip: { ratio: 2 } },
            method: "Nj",
          },
        })}
      />,
    );
    const select = screen.getByLabelText(
      "Distance correction",
    ) as HTMLSelectElement;
    expect(optionValues("Distance correction")).toEqual([
      "P",
      "Jc69",
      "K80",
      "K2P_PHYLIP",
    ]);
    expect(select.value).toBe("K2P_PHYLIP");
    expect(optionTexts("Distance correction")).toContain(
      "K2P (dnadist, κ = 2.0)",
    );
    cleanup();

    // The label shows the exercise's actual ratio, not a fixed 2.0.
    render(
      <Controls
        {...props({
          analysis: {
            correction: { K2pPhylip: { ratio: 4 } },
            method: "Nj",
          },
        })}
      />,
    );
    expect(optionTexts("Distance correction")).toContain(
      "K2P (dnadist, κ = 4.0)",
    );
    cleanup();

    render(<Controls {...props()} />);
    expect(optionValues("Distance correction")).toEqual([
      "P",
      "Jc69",
      "K80",
    ]);
  });

  it("formats the K2P label like the plan's pinned wording", () => {
    expect(k2pLabel(2)).toBe("K2P (dnadist, κ = 2.0)");
    expect(k2pLabel(4)).toBe("K2P (dnadist, κ = 4.0)");
    expect(k2pLabel(2.5)).toBe("K2P (dnadist, κ = 2.5)");
  });

  it("selecting the display-only K2P_PHYLIP option is a no-op", () => {
    const actions: Action[] = [];
    render(
      <Controls
        {...props({
          analysis: {
            correction: { K2pPhylip: { ratio: 2 } },
            method: "Nj",
          },
          dispatch: (a) => actions.push(a),
        })}
      />,
    );
    const select = screen.getByLabelText(
      "Distance correction",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "K2P_PHYLIP" } });
    expect(actions).toEqual([]);
    // The displayed correction is unchanged — the select still shows
    // the exercise's value.
    expect(select.value).toBe("K2P_PHYLIP");
  });

  it("keeps every built-in exercise's model menus unchanged", () => {
    const dir = resolve("..", "exercises");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "schema.json")
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = engine.loadExercise(
        readFileSync(resolve(dir, f), "utf8"),
      );
      if (!r.ok) throw new Error(`${f}: ${JSON.stringify(r.error)}`);
      const ex = r.value;
      cleanup();
      render(
        <Controls
          {...props({
            sim: exerciseSim(ex),
            analysis: ex.analysis,
            locked: ex.locked,
            alignmentOrigin:
              ex.data.kind === "embedded" ? "embedded" : "simulated",
            alphabet: ex.alphabet,
          })}
        />,
      );
      // No built-in prescribes F84/K2P_PHYLIP, so the menus are the
      // same option lists as before the v1.4 display fix.
      const simSelect = screen.queryByLabelText("Simulation model");
      if (simSelect !== null) {
        expect(
          Array.from(
            (simSelect as HTMLSelectElement).options,
          ).map((o) => o.value),
          `${f}: sim menu`,
        ).toEqual(SIM_MODEL_NAMES[ex.alphabet]);
      }
      expect(optionValues("Distance correction"), `${f}: correction menu`).toEqual(
        CORRECTIONS[ex.alphabet],
      );
    }
  });
});
