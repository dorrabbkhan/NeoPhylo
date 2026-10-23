// Sheet (v1.3 plan Task 10, spec §6.2): the shared modal container the
// pair, replicate and PHYLIP dialogs render inside — a centered dialog
// at ≥1024 px, a full-screen sheet below it — and the base of the
// Settings drawer. Focus moves in on open, Tab is trapped, Esc closes,
// and focus returns to whatever opened it on unmount.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "./Sheet";

afterEach(cleanup);

function TestSheet({
  onClose = vi.fn(),
  closeOnBackdrop,
}: {
  onClose?: () => void;
  closeOnBackdrop?: boolean;
}) {
  return (
    <Sheet
      className="pair-panel"
      labelledBy="sheet-title"
      onClose={onClose}
      closeOnBackdrop={closeOnBackdrop}
    >
      <h2 id="sheet-title">Title</h2>
      <button type="button">first</button>
      <button type="button">last</button>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("renders a labelled modal dialog and moves focus inside on open", () => {
    const { getByRole, getByText } = render(<TestSheet />);
    const dialog = getByRole("dialog", { name: "Title" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(getByText("first")).toBeTruthy();
  });

  it("Esc closes and focus returns to the element that opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { getByRole, unmount } = render(<TestSheet onClose={onClose} />);

    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });

  it("traps Tab inside the dialog", () => {
    const { getByRole, getByText } = render(<TestSheet />);
    const dialog = getByRole("dialog");
    const first = getByText("first");
    const last = getByText("last");
    // Focus opens on the first focusable; Tab from the last wraps to it.
    (last as HTMLElement).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    (first as HTMLElement).focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("ignores backdrop clicks by default and honors closeOnBackdrop", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<TestSheet onClose={onClose} />);
    const backdrop = container.querySelector(".sheet-backdrop")!;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    rerender(<TestSheet onClose={onClose} closeOnBackdrop />);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
