// NavItem (v1.5 Task 2, spec §16.2–§16.3): the tray item's semantics —
// the label is always the accessible name, the current pick carries
// aria-current, links navigate, actions fire — and the conductor's
// touch call: under a coarse pointer a tap activates immediately
// while a press held ≥ 500 ms shows the name and does NOT activate.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LONG_PRESS_MS, NavItem } from "./NavItem";

afterEach(cleanup);

describe("NavItem — accessible name and roles", () => {
  it("a button item's name is its label even with the label clipped", () => {
    render(<NavItem icon="library" label="Library" />);
    expect(
      screen.getByRole("button", { name: "Library" }),
    ).toBeTruthy();
  });

  it("a link item keeps its href and name", () => {
    render(<NavItem icon="labs" label="Labs" href="?labs" />);
    const link = screen.getByRole("link", { name: "Labs" });
    expect(link.getAttribute("href")).toBe("?labs");
  });

  it("marks the current item aria-current=page", () => {
    render(<NavItem icon="lessons" label="Lessons" current />);
    expect(
      screen
        .getByRole("button", { name: "Lessons" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("exposes pressed / expanded / controls on trigger items", () => {
    render(
      <NavItem
        icon="settings"
        label="Settings"
        expanded={false}
        controls="settings-drawer"
      />,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe("settings-drawer");
  });
});

describe("NavItem — activation", () => {
  it("a click runs onActivate", () => {
    const onActivate = vi.fn();
    render(<NavItem icon="library" label="Library" onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("onClick can preventDefault to keep onActivate from firing", () => {
    const onActivate = vi.fn();
    render(
      <NavItem
        icon="reading"
        label="Reading trees"
        onActivate={onActivate}
        onClick={(e) => e.preventDefault()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reading trees" }));
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("NavItem — coarse-pointer long press (§16.3, conductor's call)", () => {
  // jsdom has no PointerEvent with a pointerType field — dispatch a
  // bubbling event carrying it so the component sees the coarse
  // pointer it keys on.
  const press = (
    el: Element,
    eventName: string,
    pointerType = "touch",
  ) => {
    const e = new window.Event(eventName, { bubbles: true });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    fireEvent(el, e);
  };

  it("a touch tap activates immediately — it never only reveals a label", () => {
    const onActivate = vi.fn();
    render(<NavItem icon="library" label="Library" onActivate={onActivate} />);
    const btn = screen.getByRole("button", { name: "Library" });
    press(btn, "pointerdown");
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("a press held ≥ 500 ms shows the name and does NOT activate", () => {
    vi.useFakeTimers();
    try {
      const onActivate = vi.fn();
      render(
        <NavItem icon="library" label="Library" onActivate={onActivate} />,
      );
      const btn = screen.getByRole("button", { name: "Library" });
      press(btn, "pointerdown");
      // act(): the timer's setTip must flush its render.
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      // The tooltip is a second copy of the name, decorative.
      expect(btn.querySelector(".nav-item-tip")?.textContent).toBe(
        "Library",
      );
      fireEvent.pointerUp(btn);
      fireEvent.click(btn);
      expect(onActivate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releasing before 500 ms leaves a plain tap — activation", () => {
    vi.useFakeTimers();
    try {
      const onActivate = vi.fn();
      render(
        <NavItem icon="library" label="Library" onActivate={onActivate} />,
      );
      const btn = screen.getByRole("button", { name: "Library" });
      press(btn, "pointerdown");
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
      });
      fireEvent.pointerUp(btn);
      fireEvent.click(btn);
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(btn.querySelector(".nav-item-tip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a mouse press never arms the tooltip", () => {
    vi.useFakeTimers();
    try {
      const onActivate = vi.fn();
      render(
        <NavItem icon="library" label="Library" onActivate={onActivate} />,
      );
      const btn = screen.getByRole("button", { name: "Library" });
      press(btn, "pointerdown", "mouse");
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(btn.querySelector(".nav-item-tip")).toBeNull();
      fireEvent.pointerUp(btn);
      fireEvent.click(btn);
      expect(onActivate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
