// Component tests for the alphabet badge (v1.1 plan Task 10, spec
// §5.1). The badge names the active alphabet and offers a one-click
// override that dispatches `setAlphabet`; the session reducer owns the
// actual switch (model defaults + notice), so these tests only assert
// the dispatch.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Action } from "../state/session";

import { AlphabetBadge } from "./AlphabetBadge";

afterEach(cleanup);

describe("AlphabetBadge", () => {
  it("shows DNA for a DNA alphabet", () => {
    render(<AlphabetBadge alphabet="dna" dispatch={() => {}} />);
    expect(screen.getByText("DNA")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Treat as protein" }),
    ).toBeTruthy();
  });

  it("shows 'Protein · 20 amino acids' for a protein alphabet", () => {
    render(<AlphabetBadge alphabet="protein" dispatch={() => {}} />);
    expect(screen.getByText("Protein · 20 amino acids")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Treat as DNA" }),
    ).toBeTruthy();
  });

  it("dispatches setAlphabet protein from a DNA badge", () => {
    const actions: Action[] = [];
    render(<AlphabetBadge alphabet="dna" dispatch={(a) => actions.push(a)} />);
    fireEvent.click(screen.getByRole("button", { name: "Treat as protein" }));
    expect(actions).toEqual([{ type: "setAlphabet", alphabet: "protein" }]);
  });

  it("dispatches setAlphabet dna from a protein badge", () => {
    const actions: Action[] = [];
    render(
      <AlphabetBadge alphabet="protein" dispatch={(a) => actions.push(a)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Treat as DNA" }));
    expect(actions).toEqual([{ type: "setAlphabet", alphabet: "dna" }]);
  });
});
