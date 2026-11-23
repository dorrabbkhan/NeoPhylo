// Same-document `#r=` navigation (checkpoint fix, owner decision
// 2026-11-22): Root picks its route once at module load, so a
// fragment-only navigation — a second shared set pasted into the
// same tab, or `#r=` added onto a `?read=` URL — used to leave the
// old page mounted. A `hashchange` listener reloads the document so
// the route is picked again, but only when the change crosses a
// `#r=` boundary: every other fragment change (the "Skip to
// content" #main-content link) must keep working without a reload.
// Nothing in the app assigns location.hash — the `#x=` URL sync uses
// history.replaceState, which never fires hashchange — so a change
// here is always a real navigation.

/** True when a fragment change crosses a `#r=` boundary: one side
 *  carries a shared set and the two fragments differ. Both sides are
 *  the raw `location.hash` values (a `#r=` fragment includes the
 *  leading `#`). */
export function rLinkChanged(oldHash: string, newHash: string): boolean {
  return (
    oldHash !== newHash &&
    (oldHash.includes("#r=") || newHash.includes("#r="))
  );
}

/** Install the re-route watcher once, at startup (main.tsx). */
export function watchReadingLinks(): void {
  window.addEventListener("hashchange", (e) => {
    const oldHash = new URL(e.oldURL).hash;
    const newHash = new URL(e.newURL).hash;
    if (rLinkChanged(oldHash, newHash)) window.location.reload();
  });
}
