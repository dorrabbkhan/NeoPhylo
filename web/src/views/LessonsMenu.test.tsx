// LessonsMenu tests (checkpoint 13): the header menu-button lists every
// built-in lesson in teaching order, each with its title and one-line
// summary, and marks the loaded lesson. Keyboard per the menu-button
// pattern: Enter/Space/ArrowDown opens, arrows cycle, Escape closes.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LESSONS } from "../lessons/catalog";
import { LessonsMenu } from "./LessonsMenu";

afterEach(cleanup);

const menuButton = () => screen.getByRole("button", { name: "Lessons" });
const items = () => screen.getAllByRole("menuitemradio");

describe("LessonsMenu", () => {
  it("lists every built-in lesson in teaching order with title and summary", () => {
    render(<LessonsMenu currentId={null} onPick={() => {}} />);
    fireEvent.click(menuButton());
    const got = items().map((b) => ({
      title: b.querySelector(".lessons-menu-title")?.textContent,
      summary: b.querySelector(".lessons-menu-summary")?.textContent,
    }));
    expect(got).toEqual(
      LESSONS.map((l) => ({ title: l.title, summary: l.summary })),
    );
    expect(got.map((g) => g.summary)).toSatisfy((s: string[]) =>
      s.every((t) => t.length > 0),
    );
  });

  it("marks the current lesson", () => {
    render(<LessonsMenu currentId="saturation" onPick={() => {}} />);
    fireEvent.click(menuButton());
    const checked = items().filter(
      (b) => b.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("Saturation and distance correction");
  });

  it("marks nothing for a custom exercise", () => {
    render(<LessonsMenu currentId={null} onPick={() => {}} />);
    fireEvent.click(menuButton());
    for (const b of items()) {
      expect(b.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("picking an item calls onPick with its id and closes", () => {
    const onPick = vi.fn();
    render(<LessonsMenu currentId="nj-basics" onPick={onPick} />);
    fireEvent.click(menuButton());
    fireEvent.click(items()[3]);
    expect(onPick).toHaveBeenCalledWith("protein-models");
    expect(screen.queryByRole("menu")).toBeNull();
    // Focus returns to the menu button after a pick.
    expect(document.activeElement).toBe(menuButton());
  });

  it("Enter opens, arrows cycle focus, Enter picks", () => {
    const onPick = vi.fn();
    render(<LessonsMenu currentId="nj-basics" onPick={onPick} />);
    fireEvent.keyDown(menuButton(), { key: "Enter" });
    expect(screen.getByRole("menu")).toBeTruthy();
    // Opens focused on the current lesson's item.
    expect(document.activeElement?.textContent).toContain(
      "How Neighbor-Joining works",
    );
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain(
      "When UPGMA fails",
    );
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toContain(
      "When UPGMA fails",
    );
    // Wrap-around: ArrowUp on the second item lands on the first…
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toContain("Cytochrome c");
    // Activating the focused item picks it (jsdom does not translate
    // Enter into a click like a browser, so click is the stand-in).
    fireEvent.click(document.activeElement as Element);
    expect(onPick).toHaveBeenCalledWith("cytochrome-c");
  });

  it("Escape closes the menu and returns focus to the button", () => {
    render(<LessonsMenu currentId={null} onPick={() => {}} />);
    fireEvent.keyDown(menuButton(), { key: " " });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it("Home/End jump to the first and last items", () => {
    render(<LessonsMenu currentId={null} onPick={() => {}} />);
    fireEvent.click(menuButton());
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toContain("Cytochrome c");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toContain(
      "How Neighbor-Joining works",
    );
  });

  it("clicking outside closes the menu", () => {
    render(<LessonsMenu currentId={null} onPick={() => {}} />);
    fireEvent.click(menuButton());
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
