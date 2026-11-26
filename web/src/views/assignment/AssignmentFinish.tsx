// The Finish view (v1.5 plan Task 8, spec §5.4/§5.6): the NP1-…
// completion code with a Copy button, the score in practice mode
// ("practice students see their score right away"; test students
// see only that their answers were recorded), and the storage
// notice when progress can't be persisted.

import { useState } from "react";

import type { GradeResult } from "../../engine/generated/GradeResult";
import type { Mode } from "../../engine/generated/Mode";

export interface AssignmentFinishProps {
  /** The issued completion code. */
  code: string;
  mode: Mode;
  /** The practice-mode score, or null in test mode / on grade
   *  failure. */
  grade: GradeResult | null;
  /** The id the student typed (display only). */
  studentId: string;
  /** False when localStorage is unavailable — the "progress won't
   *  survive a reload" notice. */
  storageOk: boolean;
}

export function AssignmentFinish({
  code,
  mode,
  grade,
  studentId,
  storageOk,
}: AssignmentFinishProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the code stays selectable.
    }
  };
  return (
    <section className="assess-finish" aria-label="Assignment complete">
      <h2>Assignment complete</h2>
      <p>
        {mode === "practice" && grade !== null
          ? `Score: ${grade.score} of ${grade.max}`
          : "Your answers are recorded in the completion code."}
      </p>
      <p className="assess-finish-instructions">
        Copy this code and paste it where your instructor collects
        answers:
      </p>
      <p className="assess-code-row">
        <code className="assess-code">{code}</code>{" "}
        <button
          type="button"
          className="btn btn-primary assess-copy"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </p>
      <p className="assess-finish-id">
        Recorded for <strong>{studentId}</strong>.
      </p>
      {!storageOk && (
        <p className="assess-storage-note" role="status">
          Your progress won't survive a reload — copy the code now and
          keep it safe.
        </p>
      )}
    </section>
  );
}
