// Presenter toggle (v1.3 plan Task 11, spec §6.6): aria-pressed
// mirrors the session flag and a click dispatches setPresenter with
// the opposite value — the App's presenter effect mirrors it to
// <html data-presenter> and the device-local neophylo.presenter pref.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PresenterToggle } from "./PresenterToggle";

afterEach(cleanup);

describe("PresenterToggle", () => {
  it("is unpressed while presenter mode is off", () => {
    render(<PresenterToggle presenter={false} dispatch={() => {}} />);
    const btn = screen.getByRole("button", { name: "Presenter mode" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("is pressed while presenter mode is on", () => {
    render(<PresenterToggle presenter={true} dispatch={() => {}} />);
    const btn = screen.getByRole("button", { name: "Presenter mode" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("dispatches setPresenter with the opposite value", () => {
    const dispatch = vi.fn();
    render(<PresenterToggle presenter={false} dispatch={dispatch} />);
    screen.getByRole("button", { name: "Presenter mode" }).click();
    expect(dispatch).toHaveBeenCalledWith({
      type: "setPresenter",
      presenter: true,
    });
  });
});
