// The editor ↔ preview-tab handshake (v1.4 Task 10 fix round 3 — owner
// decision: the preview must work at any exercise size). Preview used
// to open the exercise's `#x=` share link, so a draft past
// SHARE_LINK_MAX_LENGTH got an error and no preview. Instead the
// editor now opens a bare `?preview=<nonce>` tab — the URL carries no
// exercise data — and the two windows exchange the draft over
// postMessage:
//
//   preview → editor: { type: "neophylo-preview-ready", nonce }
//   editor → preview: { type: "neophylo-preview-exercise", nonce, exercise }
//
// Both sides verify the origin (same-origin only), the source (the
// opener / the window that was opened), the message type and the
// per-click nonce, and ignore everything else. Nothing touches
// localStorage/sessionStorage and the URL holds only the nonce, so the
// draft's size is unlimited. The received exercise goes through the
// same validation + migration path as an `#x=` or file import
// (`loadWireExercise`); the tab then runs the ordinary lesson player,
// exactly as the `#x=` link did. Every failure — no opener, no reply
// inside the timeout, an invalid exercise — is a readable message,
// never a blank page or a hang.

import type { Exercise } from "../engine/generated/Exercise";
import { errorMessage } from "../explain/errors";

import { loadWireExercise } from "./exerciseFile";

export const PREVIEW_READY = "neophylo-preview-ready";
export const PREVIEW_EXERCISE = "neophylo-preview-exercise";

/** How long the preview tab waits for the editor's reply. */
export const PREVIEW_TIMEOUT_MS = 5_000;

export const PREVIEW_NO_OPENER =
  "This preview was opened from the editor; open Preview again from the editor.";
export const PREVIEW_TIMEOUT =
  "The editor didn't answer in time; open Preview again from the editor.";

/** A per-click nonce for one handshake — crypto, never Math.random. */
export function previewNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** The relative URL the preview tab opens — only the nonce. */
export function previewUrl(nonce: string): string {
  return `${window.location.pathname}?preview=${encodeURIComponent(nonce)}`;
}

export type PreviewReply =
  | { ok: true; exercise: Exercise }
  | { ok: false; error: string };

function messageField(data: unknown, key: string): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  return (data as Record<string, unknown>)[key];
}

/**
 * The preview tab's side: post `ready` to the opener and wait for the
 * exercise. `onReply` fires exactly once — the validated exercise, or a
 * readable error when there is no opener, no reply inside
 * `timeoutMs` (default PREVIEW_TIMEOUT_MS), or the exercise fails the
 * shared import-path validation. Returns a cancel that detaches the
 * listener and the timer (unmount, StrictMode re-mount).
 */
export function requestPreviewExercise(opts: {
  nonce: string;
  /** The editor window — the preview tab's `window.opener`. */
  opener: Window | null;
  /** Where the reply is listened for — `window` in the tab. */
  listenOn?: Window;
  timeoutMs?: number;
  onReply: (r: PreviewReply) => void;
}): () => void {
  const listenOn = opts.listenOn ?? window;
  const opener = opts.opener;
  if (opener === null || opts.nonce === "") {
    opts.onReply({ ok: false, error: PREVIEW_NO_OPENER });
    return () => {};
  }
  const origin = window.location.origin;
  let settled = false;
  const settle = (r: PreviewReply): void => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    listenOn.removeEventListener("message", onMessage);
    opts.onReply(r);
  };
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== origin || event.source !== opener) return;
    const data = event.data as unknown;
    if (
      messageField(data, "type") !== PREVIEW_EXERCISE ||
      messageField(data, "nonce") !== opts.nonce
    ) {
      return;
    }
    const v = loadWireExercise(messageField(data, "exercise"));
    if (v.ok) {
      settle({ ok: true, exercise: v.value });
    } else {
      const m = errorMessage(v.error);
      settle({
        ok: false,
        error: `The preview couldn't load the exercise — ${m.title}: ${m.body}`,
      });
    }
  };
  const timer = window.setTimeout(() => {
    settle({ ok: false, error: PREVIEW_TIMEOUT });
  }, opts.timeoutMs ?? PREVIEW_TIMEOUT_MS);
  listenOn.addEventListener("message", onMessage);
  opener.postMessage({ type: PREVIEW_READY, nonce: opts.nonce }, origin);
  return () => {
    settled = true;
    window.clearTimeout(timer);
    listenOn.removeEventListener("message", onMessage);
  };
}

/**
 * The editor's side: answer every `ready` that arrives from the tab
 * `win` at this origin carrying `nonce` with the (unsaved, already
 * save-validated) exercise — the tab may re-ask after a reload.
 * Returns a disarm that detaches the listener.
 */
export function answerPreviewRequests(opts: {
  /** The tab `window.open` returned. */
  win: Window;
  nonce: string;
  exercise: Exercise;
  /** Where `ready` is listened for — `window` in the editor tab. */
  listenOn?: Window;
}): () => void {
  const listenOn = opts.listenOn ?? window;
  const origin = window.location.origin;
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== origin || event.source !== opts.win) return;
    const data = event.data as unknown;
    if (
      messageField(data, "type") !== PREVIEW_READY ||
      messageField(data, "nonce") !== opts.nonce
    ) {
      return;
    }
    opts.win.postMessage(
      {
        type: PREVIEW_EXERCISE,
        nonce: opts.nonce,
        exercise: opts.exercise,
      },
      origin,
    );
  };
  listenOn.addEventListener("message", onMessage);
  return () => listenOn.removeEventListener("message", onMessage);
}

