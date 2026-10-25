// Shared Math-mode formula line (one KaTeX source line inside a
// horizontally scrolling block). The three math surfaces — the
// Explanation panel's Math tab, the bootstrap panel and the pair
// detail — rendered three identical local copies; the v1.3 overflow
// fix made them one: a formula wider than its column scrolls inside
// .math-line, and while it actually scrolls the line is a labelled
// tab stop so keyboard users can reach the clipped content (axe
// scrollable-region-focusable). Fix round 1 adds the missing static
// affordance: scrollbars are overlay-only, so .math-line-box carries
// a data-fade-* attribute per edge that still hides content and the
// CSS paints a fade toward the panel background there.

import { useLayoutEffect, useMemo, useState } from "react";

import { MATH_LOADING, renderMath, useKatex } from "../explain/katex";

export interface MathLineProps {
  /** KaTeX source for one formula line. */
  source: string;
}

interface ScrollEdges {
  /** Content hidden to the left of the scrollport. */
  left: boolean;
  /** Content hidden to the right of the scrollport. */
  right: boolean;
}

/** Which edges of a horizontally scrolling element still hide
 * content. Measured on mount and re-measured on scroll; on box resize
 * (ResizeObserver on the line); on content change, because the lazy
 * KaTeX render and the loading-text placeholder swap the line's
 * children WITHOUT resizing the box (MutationObserver on the line,
 * then a ResizeObserver on each child so late webfont metrics — which
 * change a formula's width in place, no DOM mutation — still land);
 * and once more when document.fonts settles. jsdom has no working
 * ResizeObserver and no document.fonts: the mount measure plus the
 * MutationObserver still cover the content-swap path there. */
function useScrollEdges(el: HTMLElement | null): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });
  useLayoutEffect(() => {
    if (el === null) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : null;
    const watch = () => {
      if (ro === null) return;
      ro.disconnect();
      ro.observe(el);
      for (const kid of el.children) ro.observe(kid);
    };
    watch();
    const mo =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            watch();
            measure();
          })
        : null;
    mo?.observe(el, { childList: true, subtree: true });
    void document.fonts?.ready.then(measure);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [el]);
  return edges;
}

/** KaTeX for a Math-mode line; a source renderMath rejects renders
 * verbatim as code. Only a line that really scrolls gets the tab
 * stop — a formula that fits costs no keyboard focus. The same edge
 * state drives the data-fade-* attributes on the wrapper: the CSS
 * shows a fade on each side that still hides content, and no fade on
 * a line that fits. */
export function MathLine({ source }: MathLineProps) {
  const katex = useKatex();
  const html = useMemo(
    () => (katex === null ? null : renderMath(katex, source)),
    [katex, source],
  );
  const [el, setEl] = useState<HTMLParagraphElement | null>(null);
  const edges = useScrollEdges(el);
  const scrollable =
    edges.left || edges.right
      ? {
          tabIndex: 0,
          role: "group",
          "aria-label": "Scrollable formula",
        }
      : {};
  return (
    <div
      className="math-line-box"
      data-fade-left={edges.left ? "true" : undefined}
      data-fade-right={edges.right ? "true" : undefined}
    >
      {katex === null ? (
        <p ref={setEl} className="math-line math-loading" {...scrollable}>
          {MATH_LOADING}
        </p>
      ) : html === null ? (
        <p ref={setEl} className="math-line" {...scrollable}>
          <code>{source}</code>
        </p>
      ) : (
        <p
          ref={setEl}
          className="math-line"
          {...scrollable}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
