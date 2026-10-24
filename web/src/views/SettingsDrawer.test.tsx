// Settings drawer "Take the tour" item (v1.3 plan Task 12 round 2,
// spec §6.7, owner decision 2A): the medium-width reopen path lives at
// the foot of the drawer; it closes the drawer and fires the callback
// App wires to tourStart. App leaves `onTakeTour` undefined below
// 1024, where the More menu is the reopen path.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsDrawer } from "./SettingsDrawer";

afterEach(cleanup);

describe("SettingsDrawer — Take the tour (§6.7)", () => {
  it("renders the item when onTakeTour is set; it closes and calls back", () => {
    const onClose = vi.fn();
    const onTakeTour = vi.fn();
    render(
      <SettingsDrawer onClose={onClose} onTakeTour={onTakeTour}>
        <p>sections</p>
      </SettingsDrawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTakeTour).toHaveBeenCalledTimes(1);
  });

  it("renders no item when onTakeTour is undefined", () => {
    render(
      <SettingsDrawer onClose={() => {}}>
        <p>sections</p>
      </SettingsDrawer>,
    );
    expect(
      screen.queryByRole("button", { name: "Take the tour" }),
    ).toBeNull();
  });
});
