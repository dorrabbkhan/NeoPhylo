// Lazy KaTeX loader (v1.3 spec §7.2): one shared dynamic-import promise
// app-wide, the hook reads null while the chunk is in flight so callers
// can show "Loading formulas…", and renderMath turns malformed TeX into
// the verbatim-code fallback rather than throwing.

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("explain/katex loader", () => {
  it("exports the exact §7.2 placeholder text", async () => {
    vi.resetModules();
    const { MATH_LOADING } = await import("./katex");
    expect(MATH_LOADING).toBe("Loading formulas…");
  });

  it("loadKatex() returns one shared promise resolving to the module", async () => {
    vi.resetModules();
    const { loadKatex } = await import("./katex");
    const a = loadKatex();
    expect(loadKatex()).toBe(a);
    const k = await a;
    expect(typeof k.renderToString).toBe("function");
  });

  it("useKatex is null until the chunk resolves, then the module", async () => {
    vi.resetModules();
    const { useKatex } = await import("./katex");
    const { result } = renderHook(() => useKatex());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(typeof result.current!.renderToString).toBe("function");
  });

  it("renderMath returns null on malformed TeX instead of throwing", async () => {
    vi.resetModules();
    const { loadKatex, renderMath } = await import("./katex");
    const k = await loadKatex();
    expect(renderMath(k, "d(a,b) = 1")).toContain("katex");
    expect(renderMath(k, "\\frac{")).toBeNull();
  });
});
