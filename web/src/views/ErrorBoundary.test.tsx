// ErrorBoundary tests (plan Task 22, spec §6.4): a crashing child shows
// the fallback with a "Copy link to this state" button that copies the
// current URL for bug reports.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("renders the fallback when a child throws", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy link to this state" }),
    ).toBeTruthy();
    silence.mockRestore();
  });

  it("copies location.href to the clipboard", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy link to this state" }),
    );
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    silence.mockRestore();
  });
});
