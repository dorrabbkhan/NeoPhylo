// Header tests — v1.5 Task 2 (spec §16.2–§16.3, mockup style B + phone
// variant M2). The old text-heavy header is gone: ≥ 768 carries the
// icon tray and the Lesson|Sandbox pill at the right end; < 768 is
// wordmark · title · one Menu button opening the phone sheet, which
// carries the mode switch as a row. These tests pin the per-breakpoint
// inventory, the preserved destinations, and the §6.7 tour homes —
// every assertion that used to target the old chips has an equivalent
// here (see docs/decisions.md "v1.5 Task 2").

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "react";

import type { Breakpoint } from "../design/breakpoints";
import type { Action } from "../state/session";

import { Header } from "./Header";

afterEach(cleanup);

function setup(
  breakpoint: Breakpoint,
  presenter = false,
  onOpenReading?: () => void,
) {
  const dispatched: Action[] = [];
  const dispatch: Dispatch<Action> = (a) => dispatched.push(a);
  render(
    <Header
      title="Lesson"
      toast={null}
      source="lesson"
      onSelectMode={() => {}}
      currentLessonId={null}
      onPickLesson={() => {}}
      onOpenPhylipHelp={() => {}}
      onOpenMegaHelp={() => {}}
      onOpenLibrary={() => {}}
      onOpenReading={onOpenReading}
      theme="light"
      presenter={presenter}
      dispatch={dispatch}
      breakpoint={breakpoint}
      drawerOpen={false}
    />,
  );
  return dispatched;
}

describe("Header — Take the tour (§6.7)", () => {
  it("has no tour button in the header at any breakpoint — the menus and the drawer own the reopen paths", () => {
    for (const bp of ["wide", "medium", "narrow", "compact"] as const) {
      cleanup();
      setup(bp);
      expect(
        screen.queryByRole("button", { name: "Take the tour" }),
      ).toBeNull();
    }
  });

  it("has no tour button in presenter mode either", () => {
    setup("wide", true);
    expect(
      screen.queryByRole("button", { name: "Take the tour" }),
    ).toBeNull();
  });
});

describe("Header — the icon tray and the mode pill (§16.2, R1)", () => {
  it("carries the tray navigation landmark and the mode pill at every ≥768 breakpoint", () => {
    for (const bp of ["wide", "medium", "narrow"] as const) {
      cleanup();
      setup(bp);
      expect(
        screen.getByRole("navigation", { name: "Header navigation" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("radiogroup", { name: "Mode" }),
      ).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Lesson" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Sandbox" })).toBeTruthy();
    }
  });

  it("shows no mode pill at compact (M2 — the sheet's Mode row owns it); the header is wordmark, title and Menu", () => {
    setup("compact");
    const header = screen.getByRole("banner");
    // M2: no mode switch in the phone header at all — not even a
    // hidden one; the sheet's Mode row is the only <768 switch.
    expect(screen.queryByRole("radiogroup", { name: "Mode" })).toBeNull();
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(header.contains(menu)).toBe(true);
  });
});

describe("Header — Guides menu and Labs link (v1.4b Task 12, owner decision; §16.2 overflow)", () => {
  it("shows a Guides menu button at the wide breakpoint, never the bare help buttons", () => {
    setup("wide");
    expect(
      screen.getByRole("button", { name: "Guides" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Coming from PHYLIP?" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Coming from MEGA?" }),
    ).toBeNull();
  });

  it("below 1280 the guides live behind More (medium keeps its Library pick); below 768 behind the Menu sheet", () => {
    for (const bp of ["medium", "narrow", "compact"] as const) {
      cleanup();
      setup(bp);
      expect(
        screen.queryByRole("button", { name: "Guides" }),
      ).toBeNull();
    }
    cleanup();
    setup("medium");
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Library" })).toBeTruthy();
    cleanup();
    setup("narrow");
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    // Library is not a narrow tray pick — the More menu owns it there.
    expect(
      screen.queryByRole("button", { name: "Library" }),
    ).toBeNull();
    cleanup();
    setup("compact");
    expect(
      screen.queryByRole("button", { name: "More" }),
    ).toBeNull();
  });

  it('shows the renamed "Labs" link only at the wide breakpoint', () => {
    setup("wide");
    expect(screen.getByRole("link", { name: "Labs" })).toBeTruthy();
    cleanup();
    setup("medium");
    expect(screen.queryByRole("link", { name: "Labs" })).toBeNull();
  });
});

describe("Header — Reading trees link (v1.4d Task 9, spec §7.1)", () => {
  it('shows a direct "Reading trees" link to the filtered library at ≥ 1280', () => {
    setup("wide");
    const link = screen.getByRole("link", { name: "Reading trees" });
    expect(link.getAttribute("href")).toBe("?library&type=reading");
  });

  it("shows no direct link below 1280 — the menus own the entry there like the Labs chip", () => {
    for (const bp of ["medium", "narrow", "compact"] as const) {
      cleanup();
      setup(bp);
      expect(
        screen.queryByRole("link", { name: "Reading trees" }),
      ).toBeNull();
    }
  });

  it("routes a plain primary click through onOpenReading — the unsaved-work question's owner (fix round 1)", () => {
    const onOpenReading = vi.fn();
    setup("wide", false, onOpenReading);
    const link = screen.getByRole("link", { name: "Reading trees" });
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    fireEvent(link, click);
    expect(onOpenReading).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
  });

  it("keeps the native href for a modified click — no preventDefault, no onOpenReading", () => {
    const onOpenReading = vi.fn();
    setup("wide", false, onOpenReading);
    const link = screen.getByRole("link", { name: "Reading trees" });
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    fireEvent(link, click);
    expect(onOpenReading).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
  });
});

describe("Header — compact phone sheet (§16.3, M2)", () => {
  it("shows one Menu button (dialog trigger) and no tray at <768", () => {
    setup("compact");
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-haspopup")).toBe("dialog");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("navigation", { name: "Header navigation" }),
    ).toBeNull();
  });

  it("the Menu button opens the sheet dialog; Esc closes it", () => {
    setup("compact");
    const menu = screen.getByRole("button", { name: "Menu" });
    // jsdom's click doesn't move focus — a real tap focuses first.
    menu.focus();
    fireEvent.click(menu);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    // The Sheet's contract: focus returns to the opener.
    expect(document.activeElement).toBe(menu);
  });

  it("the sheet's Lessons tile opens the in-sheet lesson list; Back returns", () => {
    const onPickLesson = vi.fn();
    const dispatched: Action[] = [];
    render(
      <Header
        title="Lesson"
        toast={null}
        source="lesson"
        onSelectMode={() => {}}
        currentLessonId={null}
        onPickLesson={onPickLesson}
        onOpenPhylipHelp={() => {}}
        onOpenMegaHelp={() => {}}
        onOpenLibrary={() => {}}
        onOpenReading={() => {}}
        theme="light"
        presenter={false}
        dispatch={(a) => dispatched.push(a)}
        breakpoint="compact"
        drawerOpen={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Lessons" }),
    );
    // The sub-list names every built-in lesson; the Back control shows.
    expect(
      screen.getByRole("button", { name: "Back" }),
    ).toBeTruthy();
    const picks = screen
      .getByRole("dialog")
      .querySelectorAll(".phone-sheet-pick");
    expect(picks.length).toBeGreaterThan(1);
    // Menu → Lessons → lesson: the pick activates and closes.
    fireEvent.click(picks[0]);
    expect(onPickLesson).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a tile activates its action and closes the sheet; Settings stays a tile outside presenter mode", () => {
    const onOpenLibrary = vi.fn();
    const dispatched: Action[] = [];
    render(
      <Header
        title="Lesson"
        toast={null}
        source="lesson"
        onSelectMode={() => {}}
        currentLessonId={null}
        onPickLesson={() => {}}
        onOpenPhylipHelp={() => {}}
        onOpenMegaHelp={() => {}}
        onOpenLibrary={onOpenLibrary}
        theme="light"
        presenter={false}
        dispatch={(a) => dispatched.push(a)}
        breakpoint="compact"
        drawerOpen={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // The Settings tile and the tour tile are the <768 homes.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(dispatched).toContainEqual({ type: "setDrawer", open: true });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Take the tour" }),
    );
    expect(dispatched).toContainEqual({ type: "tourStart" });
  });

  it("the sheet's Mode row is the compact mode switch — flipping it calls onSelectMode and the sheet stays open", () => {
    const onSelectMode = vi.fn();
    render(
      <Header
        title="Lesson"
        toast={null}
        source="lesson"
        onSelectMode={onSelectMode}
        currentLessonId={null}
        onPickLesson={() => {}}
        onOpenPhylipHelp={() => {}}
        onOpenMegaHelp={() => {}}
        onOpenLibrary={() => {}}
        onOpenReading={() => {}}
        theme="light"
        presenter={false}
        dispatch={() => {}}
        breakpoint="compact"
        drawerOpen={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const sheet = screen.getByRole("dialog", { name: "Menu" });
    const mode = Array.from(
      sheet.querySelectorAll('[role="radiogroup"]'),
    ).find((el) => el.getAttribute("aria-label") === "Mode")!;
    expect(mode).toBeTruthy();
    const sandbox = Array.from(mode.querySelectorAll("button")).find(
      (b) => b.textContent === "Sandbox",
    )!;
    expect(sandbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sandbox);
    expect(onSelectMode).toHaveBeenCalledWith("sandbox");
    // A control, not a destination: the sheet stays open.
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
  });
});

describe("Header — truncated title (v1.3 fixes)", () => {
  it("keeps the full title on the h1's title attribute for the ellipsis", () => {
    setup("wide");
    // The accessible name is the full text either way: getByRole's
    // name match and the title attribute carry it for the ellipsis.
    const h1 = screen.getByRole("heading", { level: 1, name: "Lesson" });
    expect(h1.getAttribute("title")).toBe("Lesson");
    expect(h1.textContent).toBe("Lesson");
  });
});
