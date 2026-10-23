// Real text metrics for layout (owner fix: support-label collision
// avoidance must use MEASURED sizes, not em estimates — a wider or
// missing font must not move a pill onto a name).
//
// v1.3 (spec §4.2): the default measurement family is the bundled
// `font.ui` token — the probe no longer relies on inheriting the app's
// font context, so it measures the same Inter faces the tree draws.
// Names outside the bundled subsets still fall back per glyph and are
// measured as actually rendered (Review Focus 1).
//
// A single hidden <text> element, parked inside a host element, is
// measured with getComputedTextLength() (advance width) and getBBox()
// (real glyph top/bottom relative to the anchor — the same box the
// overlap e2e's own getBBox assertions compare against). Canvas
// measureText would need the font spelled out and gives no glyph box;
// measuring a real <text> stays correct whatever font CSS resolves to.
//
// Returns null where measurement is impossible (jsdom, pre-mount);
// callers fall back to the em estimates in that case, which is also
// what every unit test sees.

import { font } from "./design/tokens";

export interface TextExtents {
  /** Advance width in px — the drawn text's horizontal extent. */
  w: number;
  /** Glyph bbox top, offset from the anchor's y (negative = above). */
  top: number;
  /** Glyph bbox bottom, offset from the anchor's y. */
  bottom: number;
}

export type TextMeasurer = (
  text: string,
  fontSize: number,
  baseline?: "middle" | "alphabetic",
) => TextExtents | null;

/**
 * A measurer whose probe inherits fonts like the text being placed.
 * `host` is re-resolved on every call so a remounted container is
 * followed; when it yields no element the probe lives on <body>.
 * `fontFamily` forces the probe's family — the default is the bundled
 * `font.ui` stack so on-screen measurements always name Inter (the SVG
 * export passes its standalone document's own stack instead).
 * `baseline` defaults to "middle" — the tree's text convention; the
 * "0" zero-length marker draws on the default alphabetic baseline and
 * asks for it explicitly.
 */
export function makeTextMeasurer(
  host?: () => Element | null,
  fontFamily: string = font.ui,
): TextMeasurer {
  let svg: SVGSVGElement | null = null;
  let probe: SVGTextElement | null = null;
  return (text, fontSize, baseline = "middle") => {
    if (typeof document === "undefined") return null;
    if (svg === null || probe === null) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute(
        "style",
        "position:absolute;visibility:hidden;width:0;height:0;overflow:hidden",
      );
      probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
      svg.appendChild(probe);
    }
    const into = host?.() ?? document.body;
    if (into === null) return null;
    if (svg.parentNode !== into) into.appendChild(svg);
    if (fontFamily !== undefined) probe.setAttribute("font-family", fontFamily);
    else probe.removeAttribute("font-family");
    if (baseline === "alphabetic") probe.removeAttribute("dominant-baseline");
    else probe.setAttribute("dominant-baseline", baseline);
    probe.setAttribute("font-size", String(fontSize));
    probe.textContent = text;
    try {
      const w = probe.getComputedTextLength();
      if (w <= 0) return null;
      const bb = probe.getBBox();
      return { w, top: bb.y, bottom: bb.y + bb.height };
    } catch {
      return null;
    }
  };
}
