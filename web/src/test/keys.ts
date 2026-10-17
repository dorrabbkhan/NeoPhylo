// Test helper for global keyboard shortcuts. App-level keys (Stepper's
// ←/→/Space) are handled by a `window` listener attached in a useEffect,
// so findBy* can resolve on the DOM commit while the listener is still
// queued as a passive effect — a key fired then is silently dropped.
// pressKey flushes pending effects with act() first, guaranteeing the
// listener is live before the event dispatches.
//
// Rule: tests must use pressKey() for global keyboard shortcuts, never
// bare fireEvent.keyDown. Cell-targeted keys (the matrix grid's own
// arrow/Enter handling) are React props, not the window listener, and
// may keep using fireEvent directly.

import { act, fireEvent } from "@testing-library/react";

/** Flush passive effects, then dispatch `key` on `target` (the app's
 * global listener defaults to document.body). */
export async function pressKey(
  key: string,
  target: Element | Window = document.body,
): Promise<void> {
  await act(async () => {});
  fireEvent.keyDown(target, { key });
}
