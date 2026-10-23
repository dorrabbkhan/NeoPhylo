// fontsReady unit tests (v1.3 plan Task 4, spec §4.2): the ready gate
// resolves "loaded" once the bundled faces load, "timeout" past the
// budget, and a late arrival fires onFontsLateLoad callbacks once —
// the trigger for the tree's single re-layout.

import { afterEach, describe, expect, it, vi } from "vitest";

type FakeFonts = { resolveAll: () => void };

/** Installs a controllable document.fonts; returns its resolvers. */
function fakeDocumentFonts(): FakeFonts {
  const resolvers: (() => void)[] = [];
  const load = () =>
    new Promise<FontFace[]>((resolve) => {
      resolvers.push(() => resolve([]));
    });
  Object.defineProperty(document, "fonts", {
    value: { load },
    configurable: true,
  });
  return {
    resolveAll: () => {
      for (const r of resolvers.splice(0)) r();
    },
  };
}

/** A fresh module instance per test — fontsReady keeps page-level state. */
async function fresh() {
  vi.resetModules();
  return import("./fontsReady");
}

afterEach(() => {
  vi.useRealTimers();
  delete (document as { fonts?: unknown }).fonts;
});

describe("whenFontsReady", () => {
  it("resolves 'loaded' when the faces load in time", async () => {
    const fonts = fakeDocumentFonts();
    const { whenFontsReady } = await fresh();
    const p = whenFontsReady();
    fonts.resolveAll();
    await expect(p).resolves.toBe("loaded");
  });

  it("resolves 'timeout' when the faces outlast the budget", async () => {
    vi.useFakeTimers();
    fakeDocumentFonts();
    const { whenFontsReady } = await fresh();
    const p = whenFontsReady(3000);
    await vi.advanceTimersByTimeAsync(3100);
    await expect(p).resolves.toBe("timeout");
  });

  it("resolves 'loaded' immediately where font loading is unsupported", async () => {
    delete (document as { fonts?: unknown }).fonts;
    const { whenFontsReady } = await fresh();
    await expect(whenFontsReady()).resolves.toBe("loaded");
  });

  it("reports 'loaded' to a later caller once late fonts arrived", async () => {
    vi.useFakeTimers();
    const fonts = fakeDocumentFonts();
    const { whenFontsReady } = await fresh();
    const first = whenFontsReady(3000);
    await vi.advanceTimersByTimeAsync(3100);
    await expect(first).resolves.toBe("timeout");
    fonts.resolveAll();
    await vi.runAllTimersAsync();
    await expect(whenFontsReady()).resolves.toBe("loaded");
  });
});

describe("onFontsLateLoad", () => {
  it("fires exactly once when fonts arrive after the timeout", async () => {
    vi.useFakeTimers();
    const fonts = fakeDocumentFonts();
    const { whenFontsReady, onFontsLateLoad } = await fresh();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    onFontsLateLoad(cb1);
    void whenFontsReady(3000);
    await vi.advanceTimersByTimeAsync(3100);
    onFontsLateLoad(cb2); // registered while timed out, still pending
    fonts.resolveAll();
    await vi.runAllTimersAsync();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    // The pass ran once — a late subscriber never fires.
    const cb3 = vi.fn();
    onFontsLateLoad(cb3);
    await vi.runAllTimersAsync();
    expect(cb3).not.toHaveBeenCalled();
  });

  it("never fires when fonts arrive in time", async () => {
    const fonts = fakeDocumentFonts();
    const { whenFontsReady, onFontsLateLoad } = await fresh();
    const cb = vi.fn();
    onFontsLateLoad(cb);
    const p = whenFontsReady();
    fonts.resolveAll();
    await expect(p).resolves.toBe("loaded");
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it("stops firing after unsubscribe", async () => {
    vi.useFakeTimers();
    const fonts = fakeDocumentFonts();
    const { whenFontsReady, onFontsLateLoad } = await fresh();
    const cb = vi.fn();
    const off = onFontsLateLoad(cb);
    void whenFontsReady(3000);
    await vi.advanceTimersByTimeAsync(3100);
    off();
    fonts.resolveAll();
    await vi.runAllTimersAsync();
    expect(cb).not.toHaveBeenCalled();
  });
});
