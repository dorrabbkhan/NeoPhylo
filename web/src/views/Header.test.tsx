// Header "Take the tour" entry (v1.3 plan Task 12 round 2, spec §6.7,
// owner decision 2A): at ≥ 1280 the header shows a tour button styled
// like the other secondary controls; 1024–1279 reopens through the
// Settings drawer item, below 1024 through the More menu.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("shows the header button at the wide breakpoint and dispatches tourStart", () => {
    const dispatched = setup("wide");
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(dispatched).toEqual([{ type: "tourStart" }]);
  });

  it("keeps the button in presenter mode like the other secondary controls", () => {
    const dispatched = setup("wide", true);
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(dispatched).toEqual([{ type: "tourStart" }]);
  });

  it("has no header button below 1280 — the drawer item and the More menu own those widths", () => {
    for (const bp of ["medium", "narrow", "compact"] as const) {
      cleanup();
      setup(bp);
      expect(
        screen.queryByRole("button", { name: "Take the tour" }),
      ).toBeNull();
    }
  });
});
