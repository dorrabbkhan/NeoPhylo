// LikelihoodCurve tests (v1.1 plan Task 11, spec §5.2): the SVG draws
// the engine's 60 (d, logL) samples, marks the peak at d̂, and — when
// the pair is saturated — says "no peak: still rising" with no marker.
// The svg's aria-label states d̂ for screen readers.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LikelihoodCurve } from "./LikelihoodCurve";

afterEach(cleanup);

/** A single-peaked fake curve on [0, 1] with its peak at d = 0.4 —
 * the shape the engine's `curve` always has (one maximum). */
const CURVE: [number, number][] = Array.from({ length: 60 }, (_, k) => {
  const d = k / 59;
  return [d, -30 - Math.abs(d - 0.4) * 10];
});

describe("LikelihoodCurve", () => {
  it("draws a 60-point polyline with a peak marker at d-hat", () => {
    const { container } = render(
      <LikelihoodCurve curve={CURVE} dHat={0.4} saturated={false} />,
    );
    const poly = container.querySelector("polyline");
    expect(poly).not.toBeNull();
    expect(poly?.getAttribute("points")?.trim().split(/\s+/).length).toBe(60);
    expect(container.querySelector("[data-peak]")).not.toBeNull();
  });

  it("states d-hat in its aria-label", () => {
    render(<LikelihoodCurve curve={CURVE} dHat={0.4} saturated={false} />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toContain("0.400");
  });

  it("shows 'no peak: still rising' and no marker when saturated", () => {
    const { container } = render(
      <LikelihoodCurve curve={CURVE} dHat={null} saturated />,
    );
    expect(container.querySelector("[data-peak]")).toBeNull();
    expect(screen.getByText("no peak: still rising")).toBeTruthy();
  });
});
