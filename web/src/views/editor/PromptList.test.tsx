// PromptList tests (v1.4 plan Task 10, spec §5.3): only the existing
// prompt types are offered; add, reorder and remove all have a
// keyboard path (real buttons); each prompt shows its gate — a join
// step, or the bootstrap panel for predict_branch.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { Prompt } from "../../engine/generated/Prompt";

import { PromptList } from "./PromptList";

afterEach(cleanup);

const TAXA = ["A", "B", "C", "D", "E"];

function renderList(initial: Prompt[] = []): { get: () => Prompt[] } {
  let current = initial;
  function Host() {
    const [ps, setPs] = useState<Prompt[]>(initial);
    current = ps;
    return <PromptList prompts={ps} taxa={TAXA} onChange={setPs} />;
  }
  render(<Host />);
  return { get: () => current };
}

const conceptBox = (n: number) =>
  screen.getByRole("textbox", { name: `Prompt ${n} concept` });

describe("PromptList", () => {
  it("offers only the existing prompt types", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    const select = screen.getByRole("combobox", {
      name: "Prompt 1 type",
    });
    const values = [...select.querySelectorAll("option")].map(
      (o) => o.getAttribute("value"),
    );
    expect(values).toEqual(["predict_pair", "note", "predict_branch"]);
  });

  it("a prompt added in the list shows its gate", () => {
    const { get } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(get()).toHaveLength(1);
    expect(
      screen.getByText(/Prompt 1 — Note, at join 1/),
    ).toBeTruthy();

    fireEvent.change(screen.getByRole("spinbutton", {
      name: "Prompt 1 join step",
    }), { target: { value: "3" } });
    expect(get()[0].at_step).toBe(3);
    expect(screen.getByText(/Prompt 1 — Note, at join 3/)).toBeTruthy();

    // A branch prediction anchors to the bootstrap panel — no step.
    fireEvent.click(
      screen.getByRole("button", { name: "Add branch prediction" }),
    );
    expect(
      screen.getByText(/Prompt 2 — Branch prediction, at the “How sure are we\?” panel/),
    ).toBeTruthy();
  });

  it("a concept typed in the list lands on the prompt", () => {
    const { get } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(conceptBox(1), {
      target: { value: "Watch this join." },
    });
    expect(get()[0].concept).toBe("Watch this join.");
  });

  it("reorder and remove work from the keyboard (buttons + Enter)", () => {
    const { get } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(conceptBox(1), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(conceptBox(2), { target: { value: "second" } });

    const down = screen.getByRole("button", {
      name: "Move prompt 1 down",
    });
    down.focus();
    fireEvent.keyDown(down, { key: "Enter" });
    fireEvent.click(down);
    expect(get().map((p) => p.concept)).toEqual(["second", "first"]);

    // Up/down disable at the ends.
    expect(
      screen.getByRole("button", { name: "Move prompt 1 up" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Move prompt 2 down" }),
    ).toHaveProperty("disabled", true);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove prompt 1" }),
    );
    expect(get().map((p) => p.concept)).toEqual(["first"]);
  });

  it("a predict_pair offers the reveal fields and the taxa select", () => {
    const { get } = renderList();
    fireEvent.click(
      screen.getByRole("button", { name: "Add pair prediction" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Prompt 1 reveal pair first taxon",
      }),
      { target: { value: "A" } },
    );
    // Only one side picked — nothing is written yet.
    expect(get()[0].reveal_pair).toBeNull();
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Prompt 1 reveal pair second taxon",
      }),
      { target: { value: "C" } },
    );
    expect(get()[0].reveal_pair).toEqual(["A", "C"]);
  });

  it("a note offers the sequencing triggers", () => {
    const { get } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Prompt 1 sequencing" }),
      { target: { value: "first_run" } },
    );
    expect(get()[0].after).toBe("first_run");
  });
});
