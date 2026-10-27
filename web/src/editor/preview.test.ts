// Preview handshake tests (v1.4 Task 10 fix round 3, spec §5.3): the
// editor's Preview button opens a bare `?preview=<nonce>` tab and the
// exercise crosses to it over a same-origin postMessage handshake, so
// previews work at any exercise size. These pin the protocol:
//
// - the receiver posts `neophylo-preview-ready` to its opener and
//   accepts only a `neophylo-preview-exercise` reply from that opener,
//   at this origin, carrying the same nonce;
// - the editor answers only a `ready` from the tab it opened;
// - a received exercise is re-validated through the same file-shape
//   reload as an #x=/file import (loadWireExercise);
// - no opener, no reply inside the timeout and an invalid exercise are
//   each a readable message, never a hang.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Exercise } from "../engine/generated/Exercise";

import {
  answerPreviewRequests,
  PREVIEW_EXERCISE,
  PREVIEW_NO_OPENER,
  PREVIEW_READY,
  PREVIEW_TIMEOUT,
  previewNonce,
  requestPreviewExercise,
  type PreviewReply,
} from "./preview";

const ORIGIN = window.location.origin;

function validExercise(): Exercise {
  const r = engine.loadExercise(
    readFileSync(resolve("..", "exercises", "nj-basics.json"), "utf8"),
  );
  if (!r.ok) throw new Error("nj-basics fixture must load");
  return r.value;
}

/** A stand-in for the cross-window object the handshake posts to. */
function fakeWindow() {
  return { postMessage: vi.fn() } as unknown as Window;
}

/** Dispatch a message event with an explicit origin and source — the
 * fields jsdom's MessageEvent won't accept a plain object for. */
function send(init: {
  data: unknown;
  origin?: string;
  source?: unknown;
}): void {
  const ev = new Event("message") as MessageEvent;
  Object.defineProperties(ev, {
    data: { value: init.data },
    origin: { value: init.origin ?? ORIGIN },
    source: { value: init.source ?? null },
  });
  window.dispatchEvent(ev);
}

function collector() {
  const replies: PreviewReply[] = [];
  return { replies, onReply: (r: PreviewReply) => replies.push(r) };
}

describe("requestPreviewExercise", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("with no opener reports the open-from-the-editor message", () => {
    const c = collector();
    requestPreviewExercise({ nonce: "n1", opener: null, onReply: c.onReply });
    expect(c.replies).toEqual([{ ok: false, error: PREVIEW_NO_OPENER }]);
    expect(PREVIEW_NO_OPENER).toMatch(/open Preview again from the editor/i);
  });

  it("posts the ready message to the opener at this origin", () => {
    const opener = fakeWindow();
    const c = collector();
    const cancel = requestPreviewExercise({
      nonce: "n2",
      opener,
      onReply: c.onReply,
    });
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: PREVIEW_READY, nonce: "n2" },
      ORIGIN,
    );
    cancel();
  });

  it("accepts a reply only from the opener, this origin, right type and nonce", () => {
    const opener = fakeWindow();
    const c = collector();
    requestPreviewExercise({ nonce: "n3", opener, onReply: c.onReply });
    const exercise = validExercise();

    // Wrong origin.
    send({
      data: { type: PREVIEW_EXERCISE, nonce: "n3", exercise },
      origin: "https://evil.example",
      source: opener,
    });
    // Wrong source — same origin and nonce but not the opener.
    send({
      data: { type: PREVIEW_EXERCISE, nonce: "n3", exercise },
      source: fakeWindow(),
    });
    // Wrong type.
    send({
      data: { type: "neophylo-other", nonce: "n3", exercise },
      source: opener,
    });
    // Wrong nonce.
    send({
      data: { type: PREVIEW_EXERCISE, nonce: "other", exercise },
      source: opener,
    });
    // Not an object at all.
    send({ data: "neophylo-preview-exercise", source: opener });
    expect(c.replies).toEqual([]);

    send({
      data: { type: PREVIEW_EXERCISE, nonce: "n3", exercise },
      source: opener,
    });
    expect(c.replies).toHaveLength(1);
    const r = c.replies[0];
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.exercise.id).toBe(exercise.id);
  });

  it("an invalid exercise reports the shared path's validation error", () => {
    const opener = fakeWindow();
    const c = collector();
    requestPreviewExercise({ nonce: "n4", opener, onReply: c.onReply });
    send({
      // A wire-shaped object the file reload refuses (sim length 0).
      data: {
        type: PREVIEW_EXERCISE,
        nonce: "n4",
        exercise: {
          ...validExercise(),
          data: {
            kind: "simulated",
            true_tree: "(A:0.1,B:0.2);",
            sim: { model: "Jc69", length: 0, seed: 1 },
          },
        },
      },
      source: opener,
    });
    expect(c.replies).toHaveLength(1);
    const r = c.replies[0];
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exercise|length|load/i);
  });

  it("a non-exercise payload reports an error, never a throw", () => {
    const opener = fakeWindow();
    const c = collector();
    requestPreviewExercise({ nonce: "n5", opener, onReply: c.onReply });
    send({
      data: { type: PREVIEW_EXERCISE, nonce: "n5", exercise: 42 },
      source: opener,
    });
    expect(c.replies).toHaveLength(1);
    expect(c.replies[0].ok).toBe(false);
  });

  it("times out with the open-again message when no reply arrives", () => {
    vi.useFakeTimers();
    const opener = fakeWindow();
    const c = collector();
    requestPreviewExercise({ nonce: "n6", opener, onReply: c.onReply });
    expect(c.replies).toEqual([]);
    vi.advanceTimersByTime(5_001);
    expect(c.replies).toEqual([{ ok: false, error: PREVIEW_TIMEOUT }]);
    expect(PREVIEW_TIMEOUT).toMatch(/open Preview again from the editor/i);
  });

  it("cancel() stops the listener and the timer without replying", () => {
    vi.useFakeTimers();
    const opener = fakeWindow();
    const c = collector();
    const cancel = requestPreviewExercise({
      nonce: "n7",
      opener,
      onReply: c.onReply,
    });
    cancel();
    send({
      data: { type: PREVIEW_EXERCISE, nonce: "n7", exercise: validExercise() },
      source: opener,
    });
    vi.advanceTimersByTime(10_000);
    expect(c.replies).toEqual([]);
  });
});

describe("answerPreviewRequests", () => {
  it("replies to a ready from the opened tab with the exercise", () => {
    const win = fakeWindow();
    const exercise = validExercise();
    const disarm = answerPreviewRequests({ win, nonce: "n8", exercise });

    send({ data: { type: PREVIEW_READY, nonce: "n8" }, source: win });
    expect(win.postMessage).toHaveBeenCalledWith(
      { type: PREVIEW_EXERCISE, nonce: "n8", exercise },
      ORIGIN,
    );
    disarm();
  });

  it("ignores ready messages from the wrong origin, source or nonce", () => {
    const win = fakeWindow();
    const exercise = validExercise();
    const disarm = answerPreviewRequests({ win, nonce: "n9", exercise });

    send({
      data: { type: PREVIEW_READY, nonce: "n9" },
      origin: "https://evil.example",
      source: win,
    });
    send({
      data: { type: PREVIEW_READY, nonce: "n9" },
      source: fakeWindow(),
    });
    send({ data: { type: PREVIEW_READY, nonce: "other" }, source: win });
    send({ data: { type: "neophylo-other", nonce: "n9" }, source: win });
    send({ data: "neophylo-preview-ready", source: win });
    expect(win.postMessage).not.toHaveBeenCalled();
    disarm();
  });

  it("disarm() stops the replies", () => {
    const win = fakeWindow();
    const exercise = validExercise();
    const disarm = answerPreviewRequests({ win, nonce: "n10", exercise });
    disarm();
    send({ data: { type: PREVIEW_READY, nonce: "n10" }, source: win });
    expect(win.postMessage).not.toHaveBeenCalled();
  });
});

describe("previewNonce", () => {
  it("is a 32-hex-char random id, different every call", () => {
    const a = previewNonce();
    const b = previewNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
