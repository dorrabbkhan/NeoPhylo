// Stepper RF=0 readout wording (owner gate, Task 12): when the inferred
// tree matches the reference exactly, the stepper says "matches the
// accepted classification in every clade" or "matches the true tree in
// every clade" instead of "differs … in 0 clades" / a bare "RF = 0 / N".

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Stepper } from "./Stepper";

const base = {
  step: 5,
  max: 5,
  rfText: "0 / 10",
  playing: false,
  onStep: () => {},
  onPlayToggle: () => {},
};

describe("Stepper RF = 0 readout", () => {
  it('classification reference reads "matches the accepted classification in every clade"', () => {
    render(<Stepper {...base} rfZero referenceKind="classification" />);
    expect(
      screen.getByText(/matches the accepted classification in every clade/),
    ).toBeTruthy();
  });

  it('true-tree reference reads "matches the true tree in every clade"', () => {
    render(<Stepper {...base} rfZero referenceKind="true" />);
    expect(
      screen.getByText(/matches the true tree in every clade/),
    ).toBeTruthy();
  });

  it("nonzero RF still shows the numeric fraction for a true tree", () => {
    render(<Stepper {...base} rfText="2 / 10" />);
    expect(screen.getByText("RF = 2 / 10")).toBeTruthy();
  });

  it("nonzero RF still shows the differs wording for a classification", () => {
    render(
      <Stepper {...base} rfText="2 / 10" referenceKind="classification" rfClades={1} />,
    );
    expect(
      screen.getByText(/differs from the accepted classification in 1 clade/),
    ).toBeTruthy();
  });
});
