// Shared Math-mode formula line (one KaTeX source line inside a
// horizontally scrolling block). The three math surfaces — the
// Explanation panel's Math tab, the bootstrap panel and the pair
// detail — rendered three identical local copies; the v1.3 overflow
// fix made them one: a formula wider than its column scrolls inside
// .math-line, and while it actually scrolls the line is a labelled
// tab stop so keyboard users can reach the clipped content (axe
// scrollable-region-focusable).

import { useLayoutEffect, useMemo, useState } from "react";

import { MATH_LOADING, renderMath, useKatex } from "../explain/katex";

export interface MathLineProps {
  /** KaTeX source for one formula line. */
  source: string;
}

/** True while the element's content overflows horizontally. Checked
 * on mount and through a ResizeObserver, so column resizes and the
 * lazy KaTeX font load flip it too. jsdom has no ResizeObserver: the
 * mount check still runs and reports no overflow there. */
function useOverflowsX(el: HTMLElement | null): boolean {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    if (el === null) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return overflows;
}

/** KaTeX for a Math-mode line; a source renderMath rejects renders
 * verbatim as code. Only a line that really scrolls gets the tab
 * stop — a formula that fits costs no keyboard focus. */
export function MathLine({ source }: MathLineProps) {
  const katex = useKatex();
  const html = useMemo(
    () => (katex === null ? null : renderMath(katex, source)),
    [katex, source],
  );
  const [el, setEl] = useState<HTMLParagraphElement | null>(null);
  const scrollable = useOverflowsX(el)
    ? {
        tabIndex: 0,
        role: "group",
        "aria-label": "Scrollable formula",
      }
    : {};
  if (katex === null) {
    return (
      <p ref={setEl} className="math-line math-loading" {...scrollable}>
        {MATH_LOADING}
      </p>
    );
  }
  if (html === null) {
    return (
      <p ref={setEl} className="math-line" {...scrollable}>
        <code>{source}</code>
      </p>
    );
  }
  return (
    <p
      ref={setEl}
      className="math-line"
      {...scrollable}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
