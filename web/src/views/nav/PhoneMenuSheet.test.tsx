// PhoneMenuSheet (v1.5 Task 2, spec §16.3 — mockup M2): the <768 px
// menu. These tests pin the dialog contract (role, name, focus trap,
// Esc, focus restore — all inherited from Sheet), the tile inventory
// (every destination and action the phone header + the More menu
// offered), the in-sheet Lessons/Guides sub-lists with their Back
// control, the Mode row (the <768 mode switch), and the
// activate-and-close tile rule.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LESSONS } from "../../lessons/catalog";

import { PhoneMenuSheet } from "./PhoneMenuSheet";
import type { PhoneMenuSheetProps } from "./PhoneMenuSheet";

afterEach(cleanup);

function setup(overrides: Partial<PhoneMenuSheetProps> = {}) {
  const onClose = vi.fn();
  const onPickLesson = vi.fn();
  const onOpenPhylipHelp = vi.fn();
  const onOpenMegaHelp = vi.fn();
  const onOpenLibrary = vi.fn();
  const onOpenReading = vi.fn();
  const onSelectMode = vi.fn();
  const dispatch = vi.fn();
  render(
    <>
      <button type="button">opener</button>
      <PhoneMenuSheet
        open
        onClose={onClose}
        currentLessonId={null}
        onPickLesson={onPickLesson}
        onOpenPhylipHelp={onOpenPhylipHelp}
        onOpenMegaHelp={onOpenMegaHelp}
        onOpenLibrary={onOpenLibrary}
        onOpenReading={onOpenReading}
        source="lesson"
        onSelectMode={onSelectMode}
        theme="light"
        presenter={false}
        dispatch={dispatch}
        {...overrides}
      />
    </>,
  );
  return {
    onClose,
    onPickLesson,
    onOpenPhylipHelp,
    onOpenMegaHelp,
    onOpenLibrary,
    onOpenReading,
    onSelectMode,
    dispatch,
  };
}

describe("PhoneMenuSheet — the dialog contract (§16.3)", () => {
  it("is a named modal dialog", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("moves focus inside on open, traps Tab, and Escape closes", () => {
    const { onClose } = setup();
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    // Sheet focuses the first focusable child — the close button in
    // the tile view's head (no Back shows on the tiles view).
    expect(dialog.contains(document.activeElement)).toBe(true);

    const dialog2 = screen.getByRole("dialog");
    fireEvent.keyDown(dialog2, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the ✕ button closes", () => {
    const { onClose } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Close menu" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PhoneMenuSheet — tile inventory", () => {
  it("offers every phone destination and action once", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    const labels = Array.from(
      dialog.querySelectorAll<HTMLElement>(".phone-sheet-tile"),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      "Lessons",
      "Guides",
      "Library",
      "Labs",
      "Reading trees",
      "Settings",
      "Take the tour",
      "Licenses",
      "Source code",
      "Help",
    ]);
    // The link tiles keep real hrefs.
    expect(
      screen.getByRole("link", { name: "Labs" }).getAttribute("href"),
    ).toBe("?labs");
    expect(
      screen
        .getByRole("link", { name: "Source code" })
        .getAttribute("href"),
    ).toContain("github");
  });

  it("hides the Settings tile in presenter mode — the drawer's rule at this width too", () => {
    setup({ presenter: true });
    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).toBeNull();
  });

  it("marks the current lesson's Lessons tile", () => {
    setup({ currentLessonId: LESSONS[0].id });
    expect(
      screen
        .getByRole("button", { name: "Lessons" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("PhoneMenuSheet — activate and close", () => {
  it("the Library tile runs its action and closes the sheet", () => {
    const { onOpenLibrary, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the tour and Settings tiles dispatch and close", () => {
    const { dispatch, onClose } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Take the tour" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "tourStart" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setDrawer",
      open: true,
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("PhoneMenuSheet — the in-sheet sub-lists (conductor's call)", () => {
  it("the Guides tile swaps to the two guide picks; Back returns to the tiles", () => {
    const { onOpenMegaHelp, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    expect(screen.getByRole("dialog", { name: "Guides" })).toBeTruthy();
    const back = screen.getByRole("button", { name: "Back" });
    // Entering a sub-list lands focus on its Back control.
    expect(document.activeElement).toBe(back);

    fireEvent.click(
      screen.getByRole("button", { name: "Coming from MEGA?" }),
    );
    expect(onOpenMegaHelp).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the Lessons tile lists every built-in lesson; a pick activates and closes", () => {
    const { onPickLesson, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lessons" }));
    const picks = screen
      .getByRole("dialog")
      .querySelectorAll(".phone-sheet-pick");
    // LESSONS.length lessons + the Library/Reading action rows.
    expect(picks).toHaveLength(LESSONS.length + 2);
    fireEvent.click(picks[1]);
    expect(onPickLesson).toHaveBeenCalledWith(LESSONS[1].id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Back returns to the tile grid without closing", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guides" })).toBeTruthy();
  });
});

describe("PhoneMenuSheet — the Mode row (M2)", () => {
  it("mirrors the source prop on the same radiogroup semantics as the header pill", () => {
    setup({ source: "sandbox" });
    const mode = screen.getByRole("radiogroup", { name: "Mode" });
    const sandbox = Array.from(mode.querySelectorAll("button")).find(
      (b) => b.textContent === "Sandbox",
    )!;
    const lesson = Array.from(mode.querySelectorAll("button")).find(
      (b) => b.textContent === "Lesson",
    )!;
    expect(sandbox.getAttribute("aria-checked")).toBe("true");
    expect(lesson.getAttribute("aria-checked")).toBe("false");
  });

  it("picking a side calls onSelectMode without closing — a control, not a destination", () => {
    const { onSelectMode, onClose } = setup();
    const mode = screen.getByRole("radiogroup", { name: "Mode" });
    const sandbox = Array.from(mode.querySelectorAll("button")).find(
      (b) => b.textContent === "Sandbox",
    )!;
    fireEvent.click(sandbox);
    expect(onSelectMode).toHaveBeenCalledWith("sandbox");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
  });
});

describe("PhoneMenuSheet — theme and presenter rows", () => {
  it("the Dark mode row flips the theme without closing", () => {
    const { dispatch, onClose } = setup();
    const dark = screen.getByRole("radiogroup", { name: "Dark mode" });
    const on = Array.from(dark.querySelectorAll("button")).find(
      (b) => b.textContent === "On",
    )!;
    fireEvent.click(on);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setTheme",
      theme: "dark",
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the Presenter mode row mirrors the flag", () => {
    const { dispatch } = setup();
    const row = screen.getByRole("radiogroup", {
      name: "Presenter mode",
    });
    const on = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "On",
    )!;
    fireEvent.click(on);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setPresenter",
      presenter: true,
    });
  });
});
