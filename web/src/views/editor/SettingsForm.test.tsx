// SettingsForm tests (v1.4 plan Task 10, spec §5.3): κ shows only for
// K2P_PHYLIP and refuses 0/non-numeric; the base-frequency inputs show
// only for F84, default to 0.25 each and report their sum; switching
// model swaps the conditional fields. The save gate lives in
// EditorPanel/draft.ts — the agreement between the two is pinned in
// draft.test.ts (Review Focus 1).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  type EditorSettings,
} from "../../editor/draft";

import { SettingsForm } from "./SettingsForm";

afterEach(cleanup);

function renderForm(initial: Partial<EditorSettings> = {}) {
  function Host() {
    const [s, setS] = useState<EditorSettings>({
      ...DEFAULT_SETTINGS,
      ...initial,
    });
    return <SettingsForm settings={s} onChange={setS} />;
  }
  render(<Host />);
}

const kappaField = () =>
  screen.queryByRole("textbox", { name: "Kappa (κ)" });
const freqField = (b: string) =>
  screen.queryByRole("textbox", { name: `Base frequency ${b}` });
const modelSelect = () => screen.getByRole("combobox", { name: "Model" });

describe("SettingsForm", () => {
  it("shows κ only for K2P_PHYLIP", () => {
    renderForm();
    expect(kappaField()).toBeNull();
    fireEvent.change(modelSelect(), { target: { value: "K2P_PHYLIP" } });
    expect(kappaField()).toBeTruthy();
    fireEvent.change(modelSelect(), { target: { value: "K80" } });
    expect(kappaField()).toBeNull();
  });

  it("rejects κ = 0 with a readable error", () => {
    renderForm({ model: "K2P_PHYLIP" });
    const k = kappaField()!;
    fireEvent.change(k, { target: { value: "0" } });
    expect(screen.getByRole("alert").textContent).toMatch(/positive/i);
    expect(k.getAttribute("aria-invalid")).toBe("true");
  });

  it("warns — does not refuse — on κ ≤ 0.5 with the dnadist message (owner decision, PR #88)", () => {
    renderForm({ model: "K2P_PHYLIP" });
    const k = kappaField()!;
    fireEvent.change(k, { target: { value: "0.4" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByText(/dnadist treats ratios ≤ 0\.5 as 0\.5/),
    ).toBeTruthy();
    expect(k.getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the four base-frequency inputs only for F84, defaulting to 0.25", () => {
    renderForm();
    for (const b of ["A", "C", "G", "T"]) expect(freqField(b)).toBeNull();
    fireEvent.change(modelSelect(), { target: { value: "F84" } });
    for (const b of ["A", "C", "G", "T"]) {
      expect((freqField(b) as HTMLInputElement).value).toBe("0.25");
    }
    expect(screen.getByText(/Sum: 1 — must be 1\./)).toBeTruthy();
  });

  it("shows the current sum and flags it when it is not 1", () => {
    renderForm({ model: "F84" });
    fireEvent.change(freqField("A")!, { target: { value: "0.4" } });
    const sum = screen.getByText(/Sum: 1\.15 — must be 1\./);
    expect(sum).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(
      /sum to 1\.15, not 1/i,
    );
  });

  it("switching to F84 shows its own settings; K2P shows κ but no frequencies", () => {
    renderForm();
    fireEvent.change(modelSelect(), { target: { value: "F84" } });
    expect(freqField("A")).toBeTruthy();
    expect(kappaField()).toBeNull();
    fireEvent.change(modelSelect(), { target: { value: "K2P_PHYLIP" } });
    expect(kappaField()).toBeTruthy();
    expect(freqField("A")).toBeNull();
  });
});
