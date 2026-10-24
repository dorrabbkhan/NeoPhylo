// Device-local tour preference (v1.3 spec §6.7, §7.4). The first-visit
// tour is marked done in the `neophylo.tourSeen` localStorage key —
// never in links. Storage reads and writes are try/catch-guarded:
// where storage is blocked the app still works, and a page-session
// flag keeps the tour from auto-showing again until the next load
// (Review Focus 3).

export const TOUR_STORAGE_KEY = "neophylo.tourSeen";

// The page-session flag: what survives a blocked storage write.
let seenThisSession = false;

/** True when the tour has already run on this device — or in this page
 * session, where storage is unavailable. Never throws. */
export function readTourSeen(): boolean {
  try {
    return (
      seenThisSession ||
      window.localStorage.getItem(TOUR_STORAGE_KEY) === "1"
    );
  } catch {
    return seenThisSession;
  }
}

/** Record that the tour ran: device-local storage, plus the session
 * flag only where the write itself is blocked — with working storage
 * the key alone says "seen", so nothing in memory can drift. */
export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    seenThisSession = true;
  }
}
