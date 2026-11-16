// The instructor gate on every `?key=` page (v1.4c plan Task 11, spec
// §7.2): answer keys are for instructors, so the key content is not
// rendered at all — not hidden — until the visitor confirms. The
// grant lives in sessionStorage under exactly `neophylo.instructor` =
// "1" and lasts the browser session; every storage access is in
// try/catch, and a throwing storage simply shows the dialog again
// each time. The dialog is a real modal — Sheet supplies the focus
// trap, the label and focus restore.

import { useState } from "react";
import type { ReactNode } from "react";

import { Sheet } from "../Sheet";

import { confirmInstructor, instructorGranted } from "./instructor";

export function InstructorGate({
  workHref,
  children,
}: {
  /** The matching `?worksheet=` route, for the escape link. */
  workHref: string;
  children: ReactNode;
}) {
  const [granted, setGranted] = useState(instructorGranted);
  if (granted) return <>{children}</>;
  return (
    <Sheet
      className="ws-gate"
      labelledBy="ws-gate-title"
      onClose={() => {
        /* A gate has no dismiss — the worksheet link is the way out. */
      }}
    >
      <h2 id="ws-gate-title">Answer keys are for instructors</h2>
      <p>Answer keys are for instructors. Students: work the sheet first.</p>
      <div className="ws-gate-actions">
        <button
          type="button"
          onClick={() => {
            confirmInstructor();
            setGranted(true);
          }}
        >
          I'm an instructor
        </button>
        <a href={workHref}>Back to the worksheet</a>
      </div>
    </Sheet>
  );
}
