/// <reference types="node" />
import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import { exportSvg } from "./svg";

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("exportSvg", () => {
  it("escapes markup in labels (Review Focus 2)", () => {
    const t = parse("(A:1,'<b>&\"x\"</b>':2,B:1.5);");
    const svg = exportSvg(t, { kind: "phylogram", clampNegative: false });
    expect(svg).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
    // The escaped label must not round-trip into a real <b> element.
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("b")).toBeNull();
  });

  it("is standalone: carries an xmlns and a system font stack", () => {
    const t = parse("(A:1,B:2,C:3);");
    const svg = exportSvg(t, { kind: "cladogram", clampNegative: false });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("font-family");
    expect(svg).toContain("sans-serif");
  });
});
