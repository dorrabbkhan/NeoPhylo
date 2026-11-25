// Editor autosave tests (v1.5 plan Task 7, spec §9.1). The draft of
// every editor — exercise, matrix, reading and the assignment
// builder — lives under `neophylo:draft:<kind>` and must round-trip
// verbatim; a storage that throws (private-mode Safari, a full quota)
// can never crash an editor, it just raises the "drafts won't be
// saved" flag the notice reads.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autosave } from "./autosave";
import type { DraftKind } from "./autosave";

const KINDS: DraftKind[] = ["exercise", "matrix", "reading", "assignment"];

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("autosave round-trip", () => {
  it("save → reload returns the same draft for each of the four kinds", () => {
    const drafts: Record<DraftKind, unknown> = {
      exercise: { v: 1, n: "((A,B),C);", s: { id: "ex" }, p: [], x: null, r: {} },
      matrix: { v: 1, n: "(A,B);", s: { id: "mx" }, p: [], x: null, r: {} },
      reading: { id: "set", title: "T", trees: [{ name: "t1" }], items: [] },
      assignment: { v: 1, id: "a-1", title: "HW", tasks: [], mode: "practice" },
    };
    for (const kind of KINDS) {
      autosave.save(kind, drafts[kind]);
    }
    for (const kind of KINDS) {
      expect(autosave.load(kind)).toEqual(drafts[kind]);
      // The storage key is the plan's `neophylo:draft:<kind>`.
      expect(
        window.localStorage.getItem(`neophylo:draft:${kind}`),
      ).toBe(JSON.stringify(drafts[kind]));
    }
  });

  it("returns null for a missing key and for corrupt JSON", () => {
    expect(autosave.load("exercise")).toBeNull();
    window.localStorage.setItem("neophylo:draft:reading", "{not json");
    expect(autosave.load("reading")).toBeNull();
    // Corrupt payloads are not a storage failure — the flag stays off.
    expect(autosave.blocked).toBe(false);
  });

  it("clear removes only that kind's draft", () => {
    autosave.save("exercise", { v: 1 });
    autosave.save("reading", { id: "r" });
    autosave.clear("exercise");
    expect(autosave.load("exercise")).toBeNull();
    expect(autosave.load("reading")).toEqual({ id: "r" });
  });
});

describe("autosave under a failing storage", () => {
  it("a throwing setItem never crashes and sets the notice flag", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => autosave.save("exercise", { v: 1 })).not.toThrow();
    expect(autosave.blocked).toBe(true);
  });

  it("a throwing getItem returns null and sets the notice flag", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(autosave.load("assignment")).toBeNull();
    expect(autosave.blocked).toBe(true);
  });

  it("the flag clears on the next successful access", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    autosave.save("exercise", { v: 1 });
    expect(autosave.blocked).toBe(true);
    spy.mockRestore();
    autosave.save("exercise", { v: 1 });
    expect(autosave.blocked).toBe(false);
  });
});
