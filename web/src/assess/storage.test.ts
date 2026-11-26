// storage.ts unit tests (v1.5 plan Task 8, conductor note 6):
// every localStorage access is try/catch — a throwing store never
// crashes the flow and reads degrade to "no record".

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listProgress,
  loadProgress,
  progressKey,
  saveProgress,
  storageAvailable,
  type StoredProgress,
} from "./storage";

const rec = (id: string): StoredProgress => ({
  v: 1,
  studentId: id,
  tasks: [
    { first: null, last: null, attempts: 0, committed: false },
  ],
  phase: "working",
  code: null,
  finishedMin: null,
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("assignment progress storage", () => {
  it("progressKey is the per-student namespaced key", () => {
    expect(progressKey("hw1", "sara")).toBe("neophylo:a:hw1:sara");
  });

  it("saves and loads a record under the key", () => {
    const key = progressKey("hw1", "sara");
    expect(saveProgress(key, rec("sara"))).toBe(true);
    expect(loadProgress(key)?.studentId).toBe("sara");
    expect(loadProgress(progressKey("hw1", "other"))).toBeNull();
  });

  it("listProgress returns every stored student of the assignment", () => {
    saveProgress(progressKey("hw1", "a"), rec("a"));
    saveProgress(progressKey("hw1", "b"), rec("b"));
    saveProgress(progressKey("other", "c"), rec("c"));
    const ids = listProgress("hw1").map((r) => r.studentId).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("malformed records read as null", () => {
    const key = progressKey("hw1", "sara");
    window.localStorage.setItem(key, "{not json");
    expect(loadProgress(key)).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ v: 2 }));
    expect(loadProgress(key)).toBeNull();
  });

  it("a throwing store degrades: no crash, saves refuse, loads null", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    expect(loadProgress("k")).toBeNull();
    spy.mockRestore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(saveProgress("k", rec("x"))).toBe(false);
    expect(storageAvailable()).toBe(false);
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(listProgress("hw1")).toEqual([]);
  });
});
