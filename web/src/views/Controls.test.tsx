// Component tests for the alphabet-filtered model menus (v1.1 plan
// Task 10, spec §5.1): the correction menu offers p/JC69/K80 on DNA and
// p/Kimura/JTT on protein, and the simulation menu offers JC69/K80 or
// JTT. The defaults themselves are exercised through the session
// reducer (setAlphabet) in state/session.test.ts.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Alphabet } from "../engine/generated/Alphabet";
import type { SimSpec } from "../engine/generated/SimSpec";

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
    simEnabled: true,
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
  return Array.from(select.options).map((o) => o.textContent);
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
