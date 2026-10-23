// "More" header menu (v1.3 plan Task 10, spec §6.3): below 1024 px it
// holds the items that leave the header/footer — "Coming from PHYLIP?",
// Licenses, Source code and Help — behind a menu-button. Keyboard like
// the Lessons menu: Enter/Space/ArrowDown opens, arrows rove the items,
// Esc closes and returns focus to the button.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoreMenu } from "./MoreMenu";

afterEach(cleanup);

function setup() {
  const onOpenPhylipHelp = vi.fn();
  const utils = render(<MoreMenu onOpenPhylipHelp={onOpenPhylipHelp} />);
  const button = utils.getByRole("button", { name: "More" });
  return { ...utils, button, onOpenPhylipHelp };
}

describe("MoreMenu", () => {
  it("lists the secondary items that leave the header below 1024", () => {
    const { button, getByRole } = setup();
    fireEvent.click(button);
    const menu = getByRole("menu", { name: "More" });
    const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      "Coming from PHYLIP?",
      "Licenses",
      "Source code",
      "Help",
    ]);
  });

  it("Enter opens on the first item, arrows rove, Esc restores focus", () => {
    const { button, getByRole } = setup();
    fireEvent.keyDown(button, { key: "Enter" });
    const menu = getByRole("menu", { name: "More" });
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "ArrowUp" }); // wraps to the last
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("Space also opens the menu", () => {
    const { button, getByRole } = setup();
    fireEvent.keyDown(button, { key: " " });
    expect(getByRole("menu", { name: "More" })).toBeTruthy();
  });

  it("Coming from PHYLIP? opens the help dialog and closes the menu", () => {
    const { button, getByRole, queryByRole, onOpenPhylipHelp } = setup();
    fireEvent.click(button);
    fireEvent.click(getByRole("menuitem", { name: "Coming from PHYLIP?" }));
    expect(onOpenPhylipHelp).toHaveBeenCalledTimes(1);
    expect(queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
