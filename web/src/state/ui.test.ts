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
