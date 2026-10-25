// Component tests for SaturationChart (plan Task 19, spec §6.3). The
// chart plots observed p against true distance with the JC69 curve
// p = ¾(1 − e^(−4d/3)) and its 0.75 asymptote.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { size } from "../design/tokens";
import { SaturationChart } from "./SaturationChart";

afterEach(cleanup);

describe("SaturationChart", () => {
  it("is an image whose accessible name describes the 0.75 asymptote", () => {
    render(
      <SaturationChart
        points={[
          { p: 0.1, d: 0.12 },
          { p: 0.7, d: 1.4 },
        ]}
      />,
    );
    const svg = screen.getByRole("img");
    const label = svg.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/asymptote/i);
    expect(label).toContain("0.75");
  });

  it("draws the JC69 curve, a dashed asymptote, and one point per pair", () => {
    const { container } = render(
      <SaturationChart
        points={[
          { p: 0.1, d: 0.12 },
          { p: 0.9, d: 15 },
        ]}
      />,
    );
    expect(container.querySelectorAll("circle.point")).toHaveLength(2);
    expect(container.querySelector("path.curve")).not.toBeNull();
    const asymptote = container.querySelector("line.asymptote");
    expect(asymptote).not.toBeNull();
    expect(asymptote?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("renders with no points (curve and asymptote still shown)", () => {
    const { container } = render(<SaturationChart points={[]} />);
    expect(screen.getByRole("img")).toBeTruthy();
    expect(container.querySelectorAll("circle.point")).toHaveLength(0);
  });

  it("draws every label at the 12 px type minimum (§3.2)", () => {
    const { container } = render(
      <SaturationChart points={[{ p: 0.5, d: 1.2 }]} />,
    );
    const texts = container.querySelectorAll("text");
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(
        size.xs,
      );
    }
  });
});
