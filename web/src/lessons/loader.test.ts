// Lesson loader tests (plan Task 21): loadLesson fetches
// `/exercises/{id}.json` and validates the text through
// engine.loadExercise, returning the same Result<Exercise> envelope as
// the rest of the wrapper. fetch is stubbed — jsdom tests never hit the
// network.

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultLessonJson } from "./default";
import { loadLesson } from "./loader";

function fakeResponse(
  body: string,
  init: { ok?: boolean; status?: number } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLesson", () => {
  it("fetches /exercises/<id>.json and returns the parsed Exercise", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(fakeResponse(defaultLessonJson)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await loadLesson("nj-basics");
    expect(fetchMock).toHaveBeenCalledWith("/exercises/nj-basics.json");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe("nj-basics");
      expect(r.value.prompts).toHaveLength(3);
    }
  });

  it("returns InvalidExercise when the fetch fails (missing lesson)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(fakeResponse("not found", { ok: false, status: 404 })),
      ),
    );
    const r = await loadLesson("no-such-lesson");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidExercise");
  });

  it("returns InvalidExercise when fetch rejects (offline)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const r = await loadLesson("nj-basics");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidExercise");
  });

  it("returns the engine's InvalidExercise for a syntactically bad file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse('{"schema_version": 2}'))),
    );
    const r = await loadLesson("broken");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidExercise");
  });
});
