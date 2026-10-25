// Lazy KaTeX loader (v1.3 spec §7.2). KaTeX and its CSS live in a chunk
// outside the initial bundle: the first Math render anywhere triggers
// this one shared dynamic import, and every math surface shows the
// "Loading formulas…" placeholder until it resolves. The chunk, its CSS
// and the KaTeX woff2 faces are precached by the service worker, so
// Math also renders offline after first load.

import { useEffect, useState } from "react";

/** The exact placeholder text of §7.2. */
export const MATH_LOADING = "Loading formulas…";

export type KatexModule = (typeof import("katex"))["default"];

let resolved: KatexModule | null = null;
let pending: Promise<KatexModule> | null = null;

/** The one app-wide import — every caller shares this promise, so the
 * KaTeX chunk is requested at most once per page load. */
export function loadKatex(): Promise<KatexModule> {
  pending ??= Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([m]) => {
    resolved = m.default;
    return m.default;
  });
  return pending;
}

/** The KaTeX module once the lazy chunk has loaded; `null` while it is
 * in flight — callers render MATH_LOADING then. Mounts after the first
 * load start with the resolved module, so the placeholder shows only on
 * the very first Math render. */
export function useKatex(): KatexModule | null {
  const [k, setK] = useState<KatexModule | null>(resolved);
  useEffect(() => {
    if (k !== null) return;
    let live = true;
    void loadKatex().then((m) => {
      if (live) setK(m);
    });
    return () => {
      live = false;
    };
  }, [k]);
  return k;
}

/** katex.renderToString with the throwOnError contract the math views
 * rely on: malformed source yields null so the caller can show it
 * verbatim rather than fail. */
export function renderMath(k: KatexModule, source: string): string | null {
  try {
    return k.renderToString(source, { throwOnError: true });
  } catch {
    return null;
  }
}
