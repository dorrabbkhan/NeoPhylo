// Gap-treatment control (v1.4b plan Task 10, spec §3.1, §6.1–6.2):
// MEGA's three gap treatments as a radio group — Pairwise (default),
// Complete, and Partial with a site-coverage cutoff (integer 0–100,
// default 95) — plus the count of removed sites in a polite live
// region ("312 of 1,480 sites removed by complete deletion"). Sandbox
// only; a lesson that locked it renders every input disabled.
//
// The cutoff field keeps a local text copy like the other number
// inputs: an out-of-range or non-integer value is refused with a
// message and the last valid value stays (Review Focus 2).

import { useState } from "react";

import type { SiteFilter } from "../engine/generated/SiteFilter";
import { siteFilterName } from "../state/session";

import { LOCKED_TOOLTIP } from "./Controls";

export interface GapControlProps {
  /** The active filter; absent `analysis.site_filter` is pairwise. */
  value: SiteFilter;
  onChange: (f: SiteFilter) => void;
  /** Columns the filter removed and the alignment's column count
   * (the pair panel marks the same indices). */
  removed: number;
  total: number;
  locked: boolean;
}

const PARTIAL_DEFAULT = 95;

export function GapControl({
  value,
  onChange,
  removed,
  total,
  locked,
}: GapControlProps) {
  // The cutoff field's last committed value; it persists while the
  // user flips between radios so re-picking Partial restores it.
  const [cutoff, setCutoff] = useState(
    value.kind === "partial" ? value.cutoff_pct : PARTIAL_DEFAULT,
  );
  const [text, setText] = useState(String(cutoff));
  const [invalid, setInvalid] = useState(false);
  // Sync from a prop change the way NumberField does.
  const shown = value.kind === "partial" ? value.cutoff_pct : cutoff;
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    setCutoff(shown);
    setText(String(shown));
    setInvalid(false);
  }

  const pick = (kind: SiteFilter["kind"]) => {
    if (kind === "partial") onChange({ kind, cutoff_pct: cutoff });
    else onChange({ kind });
  };

  const title = locked ? LOCKED_TOOLTIP : undefined;
  const radios: { kind: SiteFilter["kind"]; label: string }[] = [
    { kind: "pairwise", label: "Pairwise deletion" },
    { kind: "complete", label: "Complete deletion" },
    { kind: "partial", label: "Partial deletion" },
  ];

  return (
    <fieldset className="gap-control" disabled={locked}>
      <legend>Gap treatment</legend>
      {radios.map(({ kind, label }) => (
        <label className="gap-radio" key={kind} title={title}>
          <input
            type="radio"
            name="gap-treatment"
            checked={value.kind === kind}
            disabled={locked}
            onChange={() => pick(kind)}
          />
          {label}
        </label>
      ))}
      {value.kind === "partial" && (
        <>
          <label className="field">
            <span>Site coverage cutoff (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={text}
              disabled={locked}
              title={title}
              onChange={(e) => {
                setText(e.target.value);
                const v = e.target.valueAsNumber;
                if (Number.isInteger(v) && v >= 0 && v <= 100) {
                  setInvalid(false);
                  setCutoff(v);
                  onChange({ kind: "partial", cutoff_pct: v });
                } else {
                  setInvalid(true);
                }
              }}
            />
          </label>
          {invalid && (
            <p className="field-error" role="alert">
              Enter a whole number from 0 to 100.
            </p>
          )}
        </>
      )}
      <p className="gap-count" aria-live="polite">
        {removed.toLocaleString("en-US")} of {total.toLocaleString("en-US")}{" "}
        sites removed by {siteFilterName(value)} deletion
      </p>
    </fieldset>
  );
}
