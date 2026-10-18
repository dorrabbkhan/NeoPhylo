// LikelihoodCurve tests (v1.1 plan Task 11, spec §5.2): the SVG draws
// the engine's 60 (d, logL) samples in a 15-log-unit window below the
// peak, marks the peak at d̂, and — when the pair is saturated — says
// "no peak: still rising" with no marker. The svg's aria-label states
// d̂ for screen readers.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { engine } from "../engine";
import type { Alignment } from "../engine/generated/Alignment";
import type { PairDetail } from "../engine/generated/PairDetail";

import { LikelihoodCurve } from "./LikelihoodCurve";

afterEach(cleanup);

/** A single-peaked fake curve on [0, 1] with its peak at d = 0.4 —
 * the shape the engine's `curve` always has (one maximum). */
const CURVE: [number, number][] = Array.from({ length: 60 }, (_, k) => {
  const d = k / 59;
  return [d, -30 - Math.abs(d - 0.4) * 10];
});

/** Vitest runs with cwd = web/, so fixtures live at ../fixtures. */
const readRepoFile = (rel: string): string =>
  readFileSync(resolve(`../${rel}`), "utf8");

const detailOf = (aln: Alignment, i: number, j: number): PairDetail => {
  const d = engine.jttPairDetail(aln, i, j);
  if (!d.ok) throw new Error(`expected a PairDetail, got ${d.error.kind}`);
  return d.value;
};

/** Plot geometry from the rendered svg: the vertical axis line spans
 * [top, base]; the peak marker's cy is the peak's height. */
const geometry = (svg: SVGSVGElement) => {
  const yAxis = Array.from(svg.querySelectorAll("line.axis")).find(
    (l) => l.getAttribute("x1") === l.getAttribute("x2") &&
      Number(l.getAttribute("y1")) < Number(l.getAttribute("y2")),
  )!;
  const top = Number(yAxis.getAttribute("y1"));
  const base = Number(yAxis.getAttribute("y2"));
  const ys = svg
    .querySelector("polyline")!
    .getAttribute("points")!
    .trim()
    .split(/\s+/)
    .map((p) => Number(p.split(",")[1]));
  return { plotH: base - top, firstY: ys[0], lastY: ys[ys.length - 1] };
};

describe("LikelihoodCurve", () => {
  it("draws a 60-point polyline with a peak marker at d-hat", () => {
    const { container } = render(
      <LikelihoodCurve
        curve={CURVE}
        dHat={0.4}
        loglHat={-30}
        saturated={false}
      />,
    );
    const poly = container.querySelector("polyline");
    expect(poly).not.toBeNull();
    // All 60 fake samples sit inside the [-45, -30] window.
    expect(poly?.getAttribute("points")?.trim().split(/\s+/).length).toBe(60);
    expect(container.querySelector("[data-peak]")).not.toBeNull();
    expect(container.querySelector(".below-range")).toBeNull();
  });

  it("states d-hat in its aria-label", () => {
    render(
      <LikelihoodCurve
        curve={CURVE}
        dHat={0.4}
        loglHat={-30}
        saturated={false}
      />,
    );
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toContain("0.400");
  });

  it("shows 'no peak: still rising' and no marker when saturated", () => {
    const { container } = render(
      <LikelihoodCurve curve={CURVE} dHat={null} loglHat={null} saturated />,
    );
    expect(container.querySelector("[data-peak]")).toBeNull();
    expect(screen.getByText("no peak: still rising")).toBeTruthy();
  });

  it("a real pair's hill is visible: the peak sits well above both curve ends", () => {
    // P01–P02 of p6_150 (73 of 150 sites differ): logL crashes toward
    // −690 near d = 0, so the 15-log-unit window is what keeps the
    // peak readable (checkpoint 11).
    const r = engine.parseFasta(
      readRepoFile("fixtures/inputs/protein/p6_150.fasta"),
    );
    if (!r.ok) throw new Error("fixture failed to parse");
    const d = detailOf(r.value, 0, 1);
    if (d.d_hat === null || d.logl_hat === null) {
      throw new Error("expected a finite d̂ for P01–P02");
    }
    const { container } = render(
      <LikelihoodCurve
        curve={d.curve}
        dHat={d.d_hat}
        loglHat={d.logl_hat}
        saturated={false}
      />,
    );
    const svg = container.querySelector("svg")!;
    const { plotH, firstY, lastY } = geometry(svg);
    const peakY = Number(
      svg.querySelector(".peak-marker")!.getAttribute("cy"),
    );
    expect(firstY - peakY).toBeGreaterThanOrEqual(0.3 * plotH);
    expect(lastY - peakY).toBeGreaterThanOrEqual(0.3 * plotH);

    // The clipped lead-in is reported by below-range markers on the
    // bottom edge, and axis ticks label the window and the d range.
    expect(container.querySelector(".below-range")).not.toBeNull();
    const labels = Array.from(svg.querySelectorAll(".axis-label")).map(
      (t) => t.textContent,
    );
    expect(labels).toContain("0");
  });

  it("a saturated real pair still shows 'no peak: still rising'", () => {
    const r = engine.parseFasta(
      `>a\n${"A".repeat(50)}\n>b\n${"W".repeat(50)}`,
    );
    if (!r.ok) throw new Error("test fasta failed to parse");
    const d = detailOf(r.value, 0, 1);
    expect(d.d_hat).toBeNull();
    const { container } = render(
      <LikelihoodCurve
        curve={d.curve}
        dHat={d.d_hat}
        loglHat={d.logl_hat}
        saturated
      />,
    );
    expect(screen.getByText("no peak: still rising")).toBeTruthy();
    expect(container.querySelector("[data-peak]")).toBeNull();
  });
});
