// Header "Take the tour" entry (v1.3 plan Task 12 round 3, spec §6.7,
// owner decision B): the header itself never carries a tour control —
// the round-2 header button wrapped the row at 1280 on the longer
// lesson titles. ≥ 1280 reopens through the Lessons menu's last item,
// 1024–1279 through the Settings drawer item, below 1024 through the
// More menu — one reopen path per width.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Dispatch } from "react";

import type { Breakpoint } from "../design/breakpoints";
import type { Action } from "../state/session";

import { Header } from "./Header";

afterEach(cleanup);

function setup(breakpoint: Breakpoint, presenter = false) {
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
