// `#r=` shared-link tests (v1.4d plan Task 8, spec §4.6). Named tests:
// - a link round-trips: decode(encode(set)) returns the same set;
// - an invalid link shows the engine's message — never a TypeScript
//   re-check and never a crash.
//
// Compression uses the repo's lz-string pattern, like `#x=` links.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { ReadingSet } from "../engine/generated/ReadingSet";

import { decodeReadingLink, encodeReadingLink } from "./url";

function loadDemo(): ReadingSet {
  const r = engine.loadReadingSet(
    readFileSync(
      resolve("..", "exercises", "reading", "trees-demo.json"),
      "utf8",
    ),
  );
  if (!r.ok) throw new Error("demo set refused");
  return r.value;
}

const DEMO = loadDemo();

describe("encodeReadingLink / decodeReadingLink", () => {
  it("round-trips a set through the fragment", () => {
    const link = encodeReadingLink(DEMO);
    expect(link.startsWith("#r=")).toBe(true);
    const r = decodeReadingLink(link);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(DEMO);
  });

  it("finds the payload inside a full URL", () => {
    const link = encodeReadingLink(DEMO);
    const r = decodeReadingLink(`http://localhost:5173/${link}`);
    expect(r.ok).toBe(true);
  });

  it("reports no #r= payload", () => {
    const r = decodeReadingLink("#x=abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidReading");
  });

  it("reports an undecompressible payload", () => {
    const r = decodeReadingLink("#r=not-a-real-payload!!!");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
      if (r.error.kind === "InvalidReading") {
        expect(r.error.msg).toMatch(/decompress/i);
      }
    }
  });

  it("reports a fragment lz-string cannot decode at all", () => {
    // `zzz` throws inside decompressFromEncodedURIComponent — the
    // refusal names the link, not the engine (checkpoint §21(h)).
    const r = decodeReadingLink("#r=zzz");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
      if (r.error.kind === "InvalidReading") {
        expect(r.error.msg).toMatch(/decompress/i);
      }
    }
  });

  it("reports non-JSON payloads", () => {
    const payload = compressToEncodedURIComponent("this is not json");
    const r = decodeReadingLink(`#r=${payload}`);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidReading") {
      expect(r.error.msg).toMatch(/JSON/i);
    }
  });

  it("reports the wrong envelope version", () => {
    const payload = compressToEncodedURIComponent(
      JSON.stringify({ v: 9, set: {} }),
    );
    const r = decodeReadingLink(`#r=${payload}`);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidReading") {
      expect(r.error.msg).toMatch(/version|v1|format/i);
    }
  });

  it("shows the engine's message when the set itself is invalid", () => {
    // A structurally valid v1 envelope whose set the engine refuses —
    // the message comes from load_reading_set, not from TypeScript.
    const bad = {
      v: 1,
      set: {
        ...JSON.parse(JSON.stringify(DEMO)),
        items: [
          {
            id: "q-bad",
            text: "Where do {set} meet?",
            trees: ["mammals"],
            tips: ["human", "nosuchtip"],
            question: { type: "mrca" },
          },
        ],
      },
    };
    const link = `#r=${compressToEncodedURIComponent(JSON.stringify(bad))}`;
    const r = decodeReadingLink(link);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
      if (r.error.kind === "InvalidReading") {
        expect(r.error.msg).toMatch(/nosuchtip|tip/i);
      }
    }
  });
});
