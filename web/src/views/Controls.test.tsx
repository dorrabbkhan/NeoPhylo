// Component tests for the alphabet-filtered model menus (v1.1 plan
// Task 10, spec §5.1): the correction menu offers p/JC69/K80 on DNA and
// p/Kimura/JTT on protein, and the simulation menu offers JC69/K80 or
// JTT. The defaults themselves are exercised through the session
// reducer (setAlphabet) in state/session.test.ts.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Alphabet } from "../engine/generated/Alphabet";
import type { SimModel } from "../engine/generated/SimModel";
import type { SimSpec } from "../engine/generated/SimSpec";
import type { Action } from "../state/session";
import { simModelName } from "../state/session";

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
      <Controls {...props({ sim: null, alignmentOrigin: "imported" })} />,
    );
    const select = screen.getByLabelText(
      "Simulation model",
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("");
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
    // Imported data has no sim spec: the simulation section renders but
    // every control is disabled with the real-sequences tooltip and the
    // model menu shows no model.
    render(
      <Controls {...props({ sim: null, alignmentOrigin: "imported" })} />,
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
