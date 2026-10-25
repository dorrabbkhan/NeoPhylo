/// <reference types="node" />
// MathLine scroll affordance (v1.3 fixes, fix round 1): a formula wider
// than its column scrolls inside .math-line, but the scrollbar is
// overlay-only — a formula clipped mid-glyph at the box edge reads as
// cut off. The line's .math-line-box wrapper therefore carries a
// data-fade-* attribute per edge that still hides content (the CSS
// turns each into a fade toward the panel background), and only a
// line that actually scrolls is a labelled tab stop. jsdom reports 0
// for every box metric, so the geometry is mocked per element; the
// stub ResizeObserver in test/setup.ts is a no-op, so re-measurement
// is driven by scroll events and real DOM mutations.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MathLine } from "./MathLine";

afterEach(cleanup);

function renderLine(source = "d = x") {
  render(<MathLine source={source} />);
  const line = document.querySelector<HTMLElement>(".math-line");
  if (line === null || line.parentElement === null) {
    throw new Error("expected a .math-line inside its .math-line-box");
  }
  return { line, box: line.parentElement };
}

/** jsdom's layout-free metrics; scrollLeft is settable natively. */
function setWidth(el: HTMLElement, client: number, scroll: number) {
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: client,
  });
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    value: scroll,
  });
}

describe("MathLine scroll affordance", () => {
  it("marks no edge and is no tab stop when the line fits its box", () => {
    const { line, box } = renderLine();
    setWidth(line, 200, 200);
    fireEvent.scroll(line);
    expect(box.classList.contains("math-line-box")).toBe(true);
    expect(box.hasAttribute("data-fade-left")).toBe(false);
    expect(box.hasAttribute("data-fade-right")).toBe(false);
    expect(line.hasAttribute("tabindex")).toBe(false);
  });

  it("marks the right edge at scroll start, both in the middle, the left at the end", () => {
    const { line, box } = renderLine();
    setWidth(line, 200, 500); // max scroll = 300

    line.scrollLeft = 0;
    fireEvent.scroll(line);
    expect(box.hasAttribute("data-fade-left")).toBe(false);
    expect(box.hasAttribute("data-fade-right")).toBe(true);
    expect(line.getAttribute("tabindex")).toBe("0");
    expect(line.getAttribute("role")).toBe("group");
    expect(line.getAttribute("aria-label")).toBe("Scrollable formula");

    line.scrollLeft = 150;
    fireEvent.scroll(line);
    expect(box.hasAttribute("data-fade-left")).toBe(true);
    expect(box.hasAttribute("data-fade-right")).toBe(true);

    line.scrollLeft = 300;
    fireEvent.scroll(line);
    expect(box.hasAttribute("data-fade-left")).toBe(true);
    expect(box.hasAttribute("data-fade-right")).toBe(false);
  });

  it("loses the affordance when the content shrinks back to fit", () => {
    const { line, box } = renderLine();
    setWidth(line, 200, 500);
    line.scrollLeft = 0;
    fireEvent.scroll(line);
    expect(box.hasAttribute("data-fade-right")).toBe(true);

    setWidth(line, 200, 200);
    fireEvent.scroll(line);
    expect(box.hasAttribute("data-fade-left")).toBe(false);
    expect(box.hasAttribute("data-fade-right")).toBe(false);
    expect(line.hasAttribute("tabindex")).toBe(false);
  });

  it("becomes a labelled tab stop when wide content replaces the placeholder — no resize", async () => {
    const { line, box } = renderLine("x = \\frac{a+b+c+d+e}{2}");
    // The box is 200 wide throughout; scrollWidth answers what the
    // CURRENT content needs — the short "Loading formulas…" fits, the
    // rendered KaTeX does not. No scroll event, no box resize: the DOM
    // swap itself must trigger the re-measure (the real page's lazy
    // KaTeX chunk and late webfonts change width exactly this way).
    Object.defineProperty(line, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(line, "scrollWidth", {
      configurable: true,
      get: () => (line.querySelector(".katex") === null ? 200 : 600),
    });
    expect(line.hasAttribute("tabindex")).toBe(false);
    expect(box.hasAttribute("data-fade-right")).toBe(false);

    await waitFor(() => expect(line.querySelector(".katex")).not.toBeNull());
    await waitFor(() => {
      expect(line.getAttribute("tabindex")).toBe("0");
      expect(line.getAttribute("role")).toBe("group");
      expect(line.getAttribute("aria-label")).toBe("Scrollable formula");
      expect(box.hasAttribute("data-fade-right")).toBe(true);
      expect(box.hasAttribute("data-fade-left")).toBe(false);
    });
  });
});
