// UI slice (v1.3 spec §3.3, §7.1): the theme field's initial value is
// the stored device preference with a light default — including when
// storage throws — and uiReducer handles setTheme.

import { afterEach, describe, expect, it, vi } from "vitest";

import { uiInitial, uiReducer, uiSlice, type UiState } from "./ui";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("uiInitial theme", () => {
  it("defaults to light with no stored preference", () => {
    expect(uiInitial().theme).toBe("light");
  });

  it("restores a stored dark preference", () => {
    window.localStorage.setItem("neophylo.theme", "dark");
    expect(uiInitial().theme).toBe("dark");
  });

  it("treats an unrecognized stored value as light", () => {
    window.localStorage.setItem("neophylo.theme", "solarized");
    expect(uiInitial().theme).toBe("light");
  });

  it("falls back to light when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(uiInitial().theme).toBe("light");
  });
});

describe("uiReducer setTheme", () => {
  const base: UiState = uiInitial();

  it("sets the theme", () => {
    const next = uiReducer(
      base,
      { type: "setTheme", theme: "dark" },
      {} as never,
    );
    expect(next.theme).toBe("dark");
    expect(next.mode).toBe(base.mode);
  });

  it("opens and closes the settings drawer", () => {
    // v1.3 Task 10 (spec §6.4): the drawer's flag lives in the UI
    // slice; setDrawer toggles it without touching the other fields.
    const open = uiReducer(
      base,
      { type: "setDrawer", open: true },
      {} as never,
    );
    expect(open.drawerOpen).toBe(true);
    expect(open.mode).toBe(base.mode);
    const closed = uiReducer(
      open,
      { type: "setDrawer", open: false },
      {} as never,
    );
    expect(closed.drawerOpen).toBe(false);
  });

  it("uiSlice carries the full UI fields", () => {
    const slice = uiSlice({
      ...base,
      theme: "dark",
      presenter: true,
      drawerOpen: true,
      tourStep: 2,
    } as Parameters<typeof uiSlice>[0]);
    expect(slice).toEqual({
      mode: base.mode,
      theme: "dark",
      presenter: true,
      drawerOpen: true,
      tourStep: 2,
    });
  });
});

describe("uiInitial presenter (v1.3 Task 11, spec §6.6)", () => {
  it("defaults to off with no stored preference", () => {
    expect(uiInitial().presenter).toBe(false);
  });

  it("restores a stored on preference", () => {
    window.localStorage.setItem("neophylo.presenter", "1");
    expect(uiInitial().presenter).toBe(true);
  });

  it("treats an unrecognized stored value as off", () => {
    window.localStorage.setItem("neophylo.presenter", "yes");
    expect(uiInitial().presenter).toBe(false);
  });

  it("falls back to off when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(uiInitial().presenter).toBe(false);
  });
});

describe("uiReducer setPresenter (v1.3 Task 11, spec §6.6)", () => {
  const base: UiState = uiInitial();

  it("sets the flag without touching the other fields", () => {
    const next = uiReducer(
      base,
      { type: "setPresenter", presenter: true },
      {} as never,
    );
    expect(next.presenter).toBe(true);
    expect(next.mode).toBe(base.mode);
    expect(next.theme).toBe(base.theme);
    const back = uiReducer(
      next,
      { type: "setPresenter", presenter: false },
      {} as never,
    );
    expect(back.presenter).toBe(false);
  });

  it("enabling presenter closes an open Settings drawer", () => {
    // §6.6 hides the drawer button in presenter mode — an open drawer
    // can't be left on screen with its trigger gone, so the mode
    // closes it (the drawer's scrim covers the toggle, so this can
    // only happen through a non-pointer dispatch; the state still
    // must stay consistent).
    const open = uiReducer(
      base,
      { type: "setDrawer", open: true },
      {} as never,
    );
    const next = uiReducer(
      open,
      { type: "setPresenter", presenter: true },
      {} as never,
    );
    expect(next.presenter).toBe(true);
    expect(next.drawerOpen).toBe(false);
  });

  it("disabling presenter does not reopen the drawer", () => {
    const on = uiReducer(
      { ...base, drawerOpen: false },
      { type: "setPresenter", presenter: true },
      {} as never,
    );
    const off = uiReducer(
      on,
      { type: "setPresenter", presenter: false },
      {} as never,
    );
    expect(off.drawerOpen).toBe(false);
  });
});
