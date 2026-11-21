// TraitAskFields unit tests (v1.4d §21(d) fix): trait-name fields are
// selects offering the tree's own trait names — the wire carries a
// name the engine knows — and the has_not ask's has/lacks fields are
// trait selects, not the tip-tap readouts they used to be.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TraitAsk } from "../../../engine/generated/TraitAsk";

import { TraitAskFields } from "./TraitAskFields";

afterEach(cleanup);

const TRAITS = ["hair", "fur"];

function options(name: string): string[] {
  const el = screen.getByRole("combobox", { name });
  return Array.from(el.querySelectorAll("option")).map(
    (o) => o.textContent ?? "",
  );
}

describe("TraitAskFields", () => {
  it("has_not fields are trait selects carrying the wire trait names", () => {
    const onChange = vi.fn();
    const ask: TraitAsk = { kind: "has_not", has: "", lacks: "" };
    render(
      <TraitAskFields ask={ask} traitNames={TRAITS} onChange={onChange} />,
    );

    expect(options("Has trait")).toEqual([
      "— pick a trait —",
      "hair",
      "fur",
    ]);
    expect(options("Lacks trait")).toEqual([
      "— pick a trait —",
      "hair",
      "fur",
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Has trait" }), {
      target: { value: "hair" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "has_not",
      has: "hair",
      lacks: "",
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Lacks trait" }),
      { target: { value: "fur" } },
    );
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "has_not",
      has: "",
      lacks: "fur",
    });
  });

  it("which_have's Trait name field offers the tree's trait names", () => {
    const ask: TraitAsk = { kind: "which_have", trait_name: "" };
    render(
      <TraitAskFields ask={ask} traitNames={TRAITS} onChange={vi.fn()} />,
    );
    expect(options("Trait name")).toEqual([
      "— pick a trait —",
      "hair",
      "fur",
    ]);
  });

  it("a tree with no traits falls back to a text input", () => {
    const ask: TraitAsk = { kind: "has_not", has: "", lacks: "" };
    render(<TraitAskFields ask={ask} traitNames={[]} onChange={vi.fn()} />);
    expect(
      screen.getByRole("textbox", { name: "Has trait" }),
    ).toBeDefined();
    expect(
      screen.getByRole("textbox", { name: "Lacks trait" }),
    ).toBeDefined();
  });

  it("an unknown imported value stays visible and selectable", () => {
    const ask: TraitAsk = { kind: "has_not", has: "wings", lacks: "" };
    render(
      <TraitAskFields ask={ask} traitNames={TRAITS} onChange={vi.fn()} />,
    );
    const el = screen.getByRole("combobox", {
      name: "Has trait",
    }) as HTMLSelectElement;
    expect(el.value).toBe("wings");
    expect(options("Has trait")).toContain("wings (not on this tree)");
  });
});
