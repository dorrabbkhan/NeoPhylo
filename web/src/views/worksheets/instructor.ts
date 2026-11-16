// The instructor grant's storage contract (v1.4c plan Task 11):
// exactly `neophylo.instructor` = "1" in sessionStorage, every access
// in try/catch. A throwing storage leaves the grant unset, so the
// gate dialog shows every time — the plan's rule.

/** The storage key the gate reads and writes (exact). */
export const INSTRUCTOR_KEY = "neophylo.instructor";

/** True when this session already confirmed. Storage failure →
 * ungranted, so the dialog shows. */
export function instructorGranted(): boolean {
  try {
    return window.sessionStorage.getItem(INSTRUCTOR_KEY) === "1";
  } catch {
    return false;
  }
}

/** Record the grant for the rest of the browser session. */
export function confirmInstructor(): void {
  try {
    window.sessionStorage.setItem(INSTRUCTOR_KEY, "1");
  } catch {
    // A throwing storage keeps the grant out of reach: the dialog
    // simply reappears on the next key page.
  }
}
