// GuidePage (v1.4c plan Task 13, spec §7.5): the guide renders every
// section heading from docs/instructor-guide.md, links are real <a>
// elements with their internal `?route` hrefs, plan items show the
// registry minutes plus a total, and no raw HTML is ever injected.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import guideSource from "../../../../docs/instructor-guide.md?raw";

import { mdBlocks, parseInternalHref } from "../../links";

import { GuidePage } from "./GuidePage";

afterEach(cleanup);

// Every `## ` block in the markdown is a section heading — iterating
// the source keeps this list honest as the guide text drifts.
const SECTION_HEADINGS = mdBlocks(guideSource)
  .filter((b) => /^##\s/.test(b))
  .map((b) => b.replace(/^##\s+/, "").trim());

describe("GuidePage", () => {
  it("renders the title and every section heading", () => {
    render(<GuidePage />);
    expect(
      screen.getByRole("heading", { name: "Instructor guide", level: 1 }),
    ).toBeTruthy();
    expect(SECTION_HEADINGS.length).toBe(8);
    for (const h of SECTION_HEADINGS) {
      expect(
        screen.getByRole("heading", { name: h, level: 2 }),
        `section heading "${h}"`,
      ).toBeTruthy();
    }
  });

  it("renders every markdown link as an anchor with its internal href", () => {
    const { container } = render(<GuidePage />);
    const anchors = container.querySelectorAll(".lab-md a, .guide-md a");
    // Every anchor in the guide body is an internal route link; the
    // header's nav anchors (?library, ?labs) are outside .lab-md.
    for (const a of anchors) {
      const href = a.getAttribute("href") ?? "";
      expect(
        parseInternalHref(href),
        `anchor "${a.textContent}" href ${href}`,
      ).not.toBeNull();
    }
    // And every markdown link made it onto the page (the nav's own
    // links don't render inside .guide-md).
    const itemAnchors = container.querySelectorAll(".guide-md a");
    expect(itemAnchors.length).toBeGreaterThan(0);
  });

  it("links the library and editor", () => {
    render(<GuidePage />);
    expect(
      screen.getAllByRole("link").some((a) => a.getAttribute("href") === "?library"),
    ).toBe(true);
    expect(
      screen.getAllByRole("link").some((a) => a.getAttribute("href") === "?editor"),
    ).toBe(true);
  });

  it("shows registry minutes on each plan item and the plan totals", () => {
    render(<GuidePage />);
    // nj-by-hand is 20 min in meta.minutes; dnadist-neighbor 25 in
    // lab.minutes — the page must read the registries, not the text.
    const plans = screen.getAllByRole("list", { name: /plan/i });
    expect(plans.length).toBe(3);
    const njByHand = within(plans[0]).getByRole("link", {
      name: /Neighbor-Joining, by hand/,
    });
    expect(njByHand.getAttribute("href")).toBe("?lesson=nj-by-hand");
    expect(njByHand.textContent).toContain("— 20 min");
    const dnadist = within(plans[1]).getByRole("link", {
      name: /dnadist → neighbor \(F84\)/,
    });
    expect(dnadist.getAttribute("href")).toBe("?lab=dnadist-neighbor");
    expect(dnadist.textContent).toContain("— 25 min");
    // Reading-set minutes resolve the same way (v1.4d Task 14): the
    // registry's meta.minutes, shown inside the link.
    const clades = within(plans[2]).getByRole("link", {
      name: /Clades and shared traits/,
    });
    expect(clades.getAttribute("href")).toBe("?read=trees-clades-traits");
    expect(clades.textContent).toContain("— 18 min");
    // Totals are computed, not typed: 15 + 20 + 15,
    // 20 + 25 + 40 + 35 + 30 + 30 and 15 + 18 + 15.
    expect(screen.getByText(/Total: 50 min/)).toBeTruthy();
    expect(screen.getByText(/Total: 180 min/)).toBeTruthy();
    expect(screen.getByText(/Total: 48 min/)).toBeTruthy();
  });

  it("injects no raw HTML and carries the print control", () => {
    const { container } = render(<GuidePage />);
    // The wordmark's own <img> lives in the header — the markdown
    // output (.guide-md) is what must never carry raw HTML.
    for (const md of container.querySelectorAll(".guide-md")) {
      expect(md.querySelector("img")).toBeNull();
      expect(md.querySelector("script")).toBeNull();
      expect(md.querySelector("iframe")).toBeNull();
    }
    expect(
      screen.getByRole("button", { name: "Print guide" }),
    ).toBeTruthy();
    expect(container.querySelector(".lab-print")).not.toBeNull();
  });
});
