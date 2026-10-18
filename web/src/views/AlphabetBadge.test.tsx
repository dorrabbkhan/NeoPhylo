// Component tests for the alphabet badge (v1.1 plan Task 10, spec
// §5.1). The badge names the active alphabet and — on imported or
// embedded data only — offers a one-click override that dispatches
// `setAlphabet`; the session reducer owns the actual switch (model
// defaults + notice), so these tests only assert the dispatch. On
// simulated data the override is hidden: the alphabet comes from the
// simulation model, which the sim model menu controls.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Action, Session } from "../state/session";

import { AlphabetBadge } from "./AlphabetBadge";
import type { AlphabetBadgeProps } from "./AlphabetBadge";

afterEach(cleanup);

function props(overrides: Partial<AlphabetBadgeProps> = {}): AlphabetBadgeProps {
  return {
    alphabet: "dna",
    alignmentOrigin: "imported",
    source: "sandbox",
    dispatch: () => {},
    ...overrides,
  };
}

const overrideButton = () => screen.queryByRole("button", { name: /Treat as/ });

describe("AlphabetBadge", () => {
  it("shows DNA for a DNA alphabet", () => {
    render(<AlphabetBadge {...props()} />);
    expect(screen.getByText("DNA")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Treat as protein" }),
    ).toBeTruthy();
  });

  it("shows 'Protein · 20 amino acids' for a protein alphabet", () => {
    render(<AlphabetBadge {...props({ alphabet: "protein" })} />);
    expect(screen.getByText("Protein · 20 amino acids")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Treat as DNA" }),
    ).toBeTruthy();
  });

  it("dispatches setAlphabet protein from a DNA badge", () => {
    const actions: Action[] = [];
    render(<AlphabetBadge {...props({ dispatch: (a) => actions.push(a) })} />);
    fireEvent.click(screen.getByRole("button", { name: "Treat as protein" }));
    expect(actions).toEqual([{ type: "setAlphabet", alphabet: "protein" }]);
  });

  it("dispatches setAlphabet dna from a protein badge", () => {
    const actions: Action[] = [];
    render(
      <AlphabetBadge
        {...props({ alphabet: "protein", dispatch: (a) => actions.push(a) })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Treat as DNA" }));
    expect(actions).toEqual([{ type: "setAlphabet", alphabet: "dna" }]);
  });

  it.each(["imported", "embedded"] as Session["alignmentOrigin"][])(
    "offers the override on %s data",
    (alignmentOrigin) => {
      render(<AlphabetBadge {...props({ alignmentOrigin })} />);
      expect(overrideButton()).not.toBeNull();
    },
  );

  it("shows no override on simulated data", () => {
    render(<AlphabetBadge {...props({ alignmentOrigin: "simulated" })} />);
    expect(screen.getByText("DNA")).toBeTruthy();
    expect(overrideButton()).toBeNull();
  });

  it.each(["imported", "embedded"] as Session["alignmentOrigin"][])(
    "hides the override in a lesson on %s data",
    (alignmentOrigin) => {
      // Checkpoint 12: the override is Sandbox-only — a lesson's
      // alphabet is the author's deliberate choice.
      render(<AlphabetBadge {...props({ alignmentOrigin, source: "lesson" })} />);
      expect(screen.getByText("DNA")).toBeTruthy();
      expect(overrideButton()).toBeNull();
    },
  );
});
