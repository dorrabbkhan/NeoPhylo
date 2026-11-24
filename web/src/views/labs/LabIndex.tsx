// The lab index, `?labs` (v1.4 plan Task 11, spec §6.5; v1.4c plan
// Task 12, spec §7.1): since Task 12 the index is the library page
// pre-filtered to the two lab types — the same cards, groups, print
// styles and "MEGA handouts are coming" empty line the standalone
// index had, plus the library's worksheet and answer-key actions.
//
// `LabPickList` below is unchanged: the compact rows the editor's
// "Labs" sheet renders, with the load left to the caller (the editor,
// which owns the unsaved-work question of Review Focus 5).
//
// Like the library it wraps, this page is a lazy route (Root.tsx) —
// the registry and its ajv import never enter the initial bundle.

import type { LabSummary } from "../../labs/registry";
import { LibraryPage } from "../library/LibraryPage";

import "./labs.css";

/** `?labs`: the library filtered to PHYLIP and MEGA labs. The index
 * keeps its always-open settings tables (owner request 2026-11-17 —
 * the disclosure fold is the library's, not the index's). */
export function LabIndex() {
  return (
    <LibraryPage
      initialTypes={new Set(["phylip", "mega"])}
      collapseSettings={false}
    />
  );
}

/** Compact lab rows with a "Load this lab" button each — the editor's
 * lab sheet body. The caller owns what loading means there. */
export function LabPickList({
  labs,
  onLoadLab,
}: {
  labs: LabSummary[];
  onLoadLab: (lab: LabSummary) => void;
}) {
  if (labs.length === 0) {
    return (
      <p className="labs-empty">
        No lab packs yet — they land with the next release.
      </p>
    );
  }
  return (
    <ul className="lab-pick">
      {labs.map((lab) => (
        <li key={lab.id}>
          <span className="lab-pick-info">
            <strong>{lab.title}</strong>
            <span className="lab-pick-chain">
              {lab.chain.join(" → ")}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onLoadLab(lab)}
          >
            Load this lab
          </button>
        </li>
      ))}
    </ul>
  );
}
