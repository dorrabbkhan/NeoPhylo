/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";
import { color } from "../design/tokens";
import { stubFontFetch } from "../test/fontFetch";

import { exportSvg } from "./svg";

afterEach(() => {
  vi.unstubAllGlobals();
});

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("exportSvg", () => {
  it("escapes markup in labels (Review Focus 2)", async () => {
    stubFontFetch();
    const t = parse("(A:1,'<b>&\"x\"</b>':2,B:1.5);");
    const svg = await exportSvg(t, { kind: "phylogram", clampNegative: false });
    expect(svg).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
    // The escaped label must not round-trip into a real <b> element.
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("b")).toBeNull();
  });

  it("is standalone: carries an xmlns and the bundled font stack", async () => {
    stubFontFetch();
    const t = parse("(A:1,B:2,C:3);");
    const svg = await exportSvg(t, { kind: "cladogram", clampNegative: false });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("font-family");
    expect(svg).toContain("Inter");
    expect(svg).toContain("sans-serif");
  });

  it("draws support labels and weak styling like the on-screen tree (v1.2 §6.8)", async () => {
    stubFontFetch();
    const t = parse("((A:1,B:2):0.5,(C:1,D:1):0.4,E:2);");
    const internal = t.nodes
      .map((n, i) => ({ n, i }))
      .filter(
        ({ n, i }) =>
          n.children.length > 0 &&
          n.parent !== null &&
          i !== t.root,
      );
    expect(internal).toHaveLength(2);
    t.branches[internal[0].i].support = 0.87;
    t.branches[internal[1].i].support = 0.42;
    const svg = await exportSvg(t, { kind: "phylogram", clampNegative: false });
    // Math.round(100·s); weak (<0.5) carries the "*" marker in the text.
    expect(svg).toContain(">87</text>");
    expect(svg).toContain(">42*</text>");
    // The weak branch's thinner stroke (TreeView draws it at width 1).
    expect(svg).toContain('stroke-width="1"');
    // A pill sits behind every label so text stays readable over lines.
    expect(svg).toContain('class="support-pill"');
    // Every pill stays inside the viewBox (no clipping).
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const vb = doc.documentElement.getAttribute("viewBox")!.split(" ");
    const [vx, vy, vw, vh] = vb.map(Number);
    doc.querySelectorAll(".support-pill").forEach((r) => {
      const x = Number(r.getAttribute("x"));
      const y = Number(r.getAttribute("y"));
      const w = Number(r.getAttribute("width"));
      const h = Number(r.getAttribute("height"));
      expect(x).toBeGreaterThanOrEqual(vx);
      expect(y).toBeGreaterThanOrEqual(vy);
      expect(x + w).toBeLessThanOrEqual(vx + vw);
      expect(y + h).toBeLessThanOrEqual(vy + vh);
    });
    expect(doc.querySelectorAll(".support-pill")).toHaveLength(2);
  });

  it("draws no support pills on a tree without support", async () => {
    stubFontFetch();
    const svg = await exportSvg(parse("(A:1,B:2,C:3);"), {
      kind: "phylogram",
      clampNegative: false,
    });
    expect(svg).not.toContain("support-pill");
  });

  // Checkpoint 15: the export is the SAME figure the screen draws —
  // same treeFigure() geometry, content-fit bounds and data-split
  // keys — only serialized as a document.
  describe("figure parity (checkpoint 15)", () => {
    const supported = () => {
      const t = parse("((A:1,B:2):0.5,(C:1,D:1):0.4,E:2);");
      const internal = t.nodes
        .map((n, i) => ({ n, i }))
        .filter(
          ({ n, i }) =>
            n.children.length > 0 && n.parent !== null && i !== t.root,
        );
      t.branches[internal[0].i].support = 0.87;
      t.branches[internal[1].i].support = 0.42;
      return t;
    };

    it("carries data-split on every node and support label", async () => {
      stubFontFetch();
      const svg = await exportSvg(supported(), {
        kind: "phylogram",
        clampNegative: false,
      });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      // Unrooted convention: the key is the side NOT containing taxa[0]
      // ("A"), sorted and "|-joined — the tally's row format.
      const groups = Array.from(doc.querySelectorAll("g[data-node]"));
      expect(groups.length).toBe(8);
      for (const g of groups) {
        expect(g.getAttribute("data-split")).not.toBeNull();
      }
      const labels = Array.from(doc.querySelectorAll(".support-label"));
      expect(labels).toHaveLength(2);
      const keys = labels.map((l) => l.getAttribute("data-split"));
      // (A,B) contains taxa[0] "A", so its key is the complement;
      // (C,D) is stored under its own side.
      expect(keys).toEqual(["C|D|E", "C|D"]);
      // The label's key equals its node's key, so the figure can be
      // matched to the tally grouping-for-grouping.
      const nodeKeys = new Set(
        groups.map((g) => g.getAttribute("data-split")),
      );
      for (const k of keys) expect(nodeKeys.has(k)).toBe(true);
    });

    it("fits the content: no clipping, no empty right margin", async () => {
      stubFontFetch();
      const svg = await exportSvg(supported(), {
        kind: "phylogram",
        clampNegative: false,
      });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const [vx, vy, vw, vh] = doc.documentElement
        .getAttribute("viewBox")!
        .split(" ")
        .map(Number);
      // The rightmost drawn element reaches the viewBox minus the pad:
      // the old export reserved a fixed label room and produced the
      // reported large empty area on the right.
      let maxRight = -Infinity;
      doc.querySelectorAll("line, circle, rect, text").forEach((el) => {
        const x = el.getAttribute("x");
        const w = el.getAttribute("width");
        const cx = el.getAttribute("cx");
        const x2 = el.getAttribute("x2");
        for (const v of [
          x !== null && w !== null ? Number(x) + Number(w) : null,
          cx !== null ? Number(cx) : null,
          x2 !== null ? Number(x2) : null,
          x !== null && w === null ? Number(x) : null,
        ]) {
          if (v !== null) maxRight = Math.max(maxRight, v);
        }
      });
      // Text's drawn width exceeds its anchor x, so allow the leaf
      // label room (≤ ~0.62em/char × longest label ≈ small).
      expect(vx + vw - maxRight).toBeLessThan(40);
      expect(vx).toBe(0);
      expect(vy).toBe(0);
      expect(vw).toBeGreaterThan(0);
      expect(vh).toBeGreaterThan(0);
    });
  });

  // v1.3 spec §4.3/§7.3: the exported document embeds the bundled
  // font subsets its text needs and draws the print palette — light
  // tokens by default, the screen theme only when asked.
  describe("embedded fonts and print palette (v1.3 Task 15)", () => {
    it("embeds @font-face data URIs for exactly the used subsets", async () => {
      stubFontFetch();
      const t = parse("((A:1,B:2):0.5,C:0.3);");
      const internal = t.nodes.findIndex(
        (n, i) => n.children.length > 0 && n.parent !== null && i !== t.root,
      );
      t.branches[internal].support = 0.87;
      const svg = await exportSvg(t, {
        kind: "phylogram",
        clampNegative: false,
      });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      const style = doc.querySelector("style")!.textContent!;
      // latin names at weight 400 + the support label's weight 500 →
      // two embedded faces; no other subset or family.
      expect(style.match(/@font-face/g)).toHaveLength(2);
      expect(style).toContain('font-family:"Inter"');
      expect(style).toContain("font-weight:400");
      expect(style).toContain("font-weight:500");
      expect(style).toContain("data:font/woff2;base64,");
      expect(style).not.toContain("font-weight:600");
      expect(style).not.toContain("JetBrains Mono");
      expect(style).not.toContain("U+0370");
    });

    it("adds the greek subset for a Greek leaf name", async () => {
      stubFontFetch();
      const svg = await exportSvg(parse("(Ω:1,B:2,C:3);"), {
        kind: "phylogram",
        clampNegative: false,
      });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const style = doc.querySelector("style")!.textContent!;
      expect(style).toContain("U+0370");
      // Only the weight-400 faces grew — no support labels drawn.
      expect(style.match(/@font-face/g)).toHaveLength(2);
    });

    it("draws the light print palette by default, dark when asked", async () => {
      stubFontFetch();
      const opts = { kind: "phylogram" as const, clampNegative: false };
      const light = await exportSvg(parse("(A:1,B:2,C:3);"), opts);
      const dark = await exportSvg(parse("(A:1,B:2,C:3);"), {
        ...opts,
        theme: "dark",
      });
      // §7.3: the default export uses the light-theme tokens whatever
      // the screen shows — the branch ink is the theme's text color.
      expect(light).toContain(`stroke="${color.light.text}"`);
      expect(light).toContain(`fill="${color.light.text}"`);
      expect(dark).toContain(`stroke="${color.dark.text}"`);
      expect(dark).toContain(`fill="${color.dark.bg}"`);
      expect(dark).not.toContain(`stroke="${color.light.text}"`);
    });
  });
});
