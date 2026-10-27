// Simulation and analysis controls (plan Task 17, spec §6.1-6.2, §7).
// Every change dispatches setSim or setAnalysis; the session reducer
// re-runs the pipeline synchronously. Fields named in exercise.locked
// render disabled with the "Fixed for this lesson." tooltip (Task 21).
// Without a re-simulatable alignment the Simulation section collapses
// to a single line instead of greyed fields (checkpoint 11): embedded
// lesson data says "Real sequences: not simulated." and an imported
// alignment says "Your sequences: not simulated."
//
// Number inputs keep a local text copy so typing multi-digit values is
// not clobbered by clamping: a commit only happens when the typed value
// is inside the allowed range.

import { useState } from "react";
import type { Dispatch, ReactNode } from "react";

import type { Action, Session } from "../state/session";
import {
  CORRECTIONS,
  DIST_LABEL,
  SIM_LABEL,
  SIM_MODEL_NAMES,
  distModelName,
  k2pLabel,
  simModelName,
} from "../state/session";
import type { SimModelName } from "../state/session";
import type { Alphabet } from "../engine/generated/Alphabet";
import type { Analysis } from "../engine/generated/Analysis";
import type { SimModel } from "../engine/generated/SimModel";
import type { SimSpec } from "../engine/generated/SimSpec";

export interface ControlsProps {
  /** The exercise's sim spec; `null` for embedded data. Without a
   * re-simulatable alignment the section collapses to a single line
   * (checkpoints 11–12). */
  sim: SimSpec | null;
  analysis: Analysis;
  /** Locked field paths from the exercise, e.g. "sim.model". */
  locked: string[];
  matrixView: "distance" | "q";
  /** The "Distance / Q" switch is NJ-only and needs a trace (spec §6.1). */
  qAvailable: boolean;
  /** True while an unanswered predict_pair prompt gates the step: the
   * lowest Q is the answer, so the switch is disabled with a tooltip
   * (checkpoint 12). */
  qGated?: boolean;
  /** Where the alignment came from: "simulated" enables the sim fields;
   * "imported" and "embedded" both collapse the Simulation section to a
   * single line (checkpoints 11–12). */
  alignmentOrigin: Session["alignmentOrigin"];
  /** The active alphabet: model menus are filtered to the models valid
   * for it (v1.1 spec §5.1). */
  alphabet: Alphabet;
  dispatch: Dispatch<Action>;
  /** The "How sure are we?" bootstrap panel (v1.2 §6.2): App passes it
   * only while the stepper sits at its final position; it renders
   * under the Analysis section. */
  bootstrapPanel?: ReactNode;
}

const KAPPA_DEFAULT = 2;
const MAX_SEED = Number.MAX_SAFE_INTEGER;
export const LOCKED_TOOLTIP = "Fixed for this lesson.";
const REAL_SEQUENCES_TOOLTIP =
  "This lesson uses real sequences; they can't be re-simulated.";

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  title,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** Tooltip explaining why the field is disabled (locked, or the
   * alignment can't be re-simulated). */
  title?: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Re-sync the editable text when the committed value changes from
  // outside (adjust-state-during-render pattern; no effect needed).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        title={title}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v) && v >= min && v <= max) onCommit(v);
        }}
      />
    </label>
  );
}

export function Controls({
  sim,
  analysis,
  locked,
  matrixView,
  qAvailable,
  qGated = false,
  alignmentOrigin,
  alphabet,
  dispatch,
  bootstrapPanel,
}: ControlsProps) {
  const isLocked = (path: string) => locked.includes(path);
  const simEnabled = alignmentOrigin === "simulated";
  const simDisabled = !simEnabled || sim === null;
  // A disabled sim control always says why: a non-re-simulatable
  // alignment wins over a lesson lock, and so does a missing sim spec.
  // Imported and embedded data never reach these controls — the
  // section renders its single not-simulated line instead.
  const simTitle = (path: string) =>
    !simEnabled || sim === null
      ? REAL_SEQUENCES_TOOLTIP
      : isLocked(path)
        ? LOCKED_TOOLTIP
        : undefined;

  // `null` for embedded data: no sim spec exists, so no model name is
  // shown — the menu renders a disabled empty placeholder.
  const modelName = sim === null ? null : simModelName(sim.model);
  const kappa =
    sim === null || typeof sim.model === "string" || !("K80" in sim.model)
      ? KAPPA_DEFAULT
      : sim.model.K80.kappa;

  const setModel = (name: SimModelName) => {
    let model: SimModel;
    switch (name) {
      case "Jc69":
        model = "Jc69";
        break;
      case "K80":
        model = { K80: { kappa } };
        break;
      case "F84":
        // Unreachable from the menu (SIM_MODEL_NAMES lists it for no
        // alphabet) but SimModelName is exhaustive — dnadist's fixed
        // ratio and equal frequencies.
        model = { F84: { kappa: 2, base_freqs: [0.25, 0.25, 0.25, 0.25] } };
        break;
      case "Jtt":
        model = "Jtt";
        break;
      default: {
        const _exhaustive: never = name;
        throw new Error(`unhandled SimModelName: ${_exhaustive}`);
      }
    }
    dispatch({ type: "setSim", patch: { model } });
  };

  return (
    <div className="controls">
      <h2>Simulation</h2>
      {alignmentOrigin !== "simulated" ? (
        <p className="sim-real">
          {alignmentOrigin === "embedded"
            ? "Real sequences: not simulated."
            : "Your sequences: not simulated."}
        </p>
      ) : (
        <>
      <label className="field">
        <span>Model</span>
        <select
          aria-label="Simulation model"
          value={modelName ?? ""}
          disabled={simDisabled || isLocked("sim.model")}
          title={simTitle("sim.model")}
          onChange={(e) => setModel(e.target.value as SimModelName)}
        >
          {modelName === null && <option value=""></option>}
          {SIM_MODEL_NAMES[alphabet].map((m) => (
            <option key={m} value={m}>
              {SIM_LABEL[m]}
            </option>
          ))}
          {/* v1.4: an exercise's F84 sim model displays as a
            * conditional option — the menu itself is unchanged. */}
          {modelName === "F84" && <option value="F84">F84</option>}
        </select>
      </label>
      {modelName === "K80" && (
        <NumberField
          label="Kappa (κ)"
          value={kappa}
          min={0.1}
          max={100}
          step={0.1}
          disabled={simDisabled || isLocked("sim.model")}
          title={simTitle("sim.model")}
          onCommit={(v) =>
            dispatch({
              type: "setSim",
              patch: { model: { K80: { kappa: v } } },
            })
          }
        />
      )}
      <NumberField
        label="Length"
        value={sim?.length ?? 0}
        min={10}
        max={10000}
        disabled={simDisabled || isLocked("sim.length")}
        title={simTitle("sim.length")}
        onCommit={(v) =>
          dispatch({ type: "setSim", patch: { length: Math.round(v) } })
        }
      />
      <div className="field seed">
        <NumberField
          label="Seed"
          value={sim?.seed ?? 0}
          min={0}
          max={MAX_SEED}
          disabled={simDisabled || isLocked("sim.seed")}
          title={simTitle("sim.seed")}
          onCommit={(v) =>
            dispatch({ type: "setSim", patch: { seed: Math.round(v) } })
          }
        />
        <button
          type="button"
          disabled={simDisabled || isLocked("sim.seed")}
          title={simTitle("sim.seed")}
          onClick={() =>
            sim !== null &&
            dispatch({ type: "setSim", patch: { seed: sim.seed + 1 } })
          }
        >
          New seed
        </button>
      </div>
        </>
      )}

      <h2>Analysis</h2>
      <label className="field">
        <span>Correction</span>
        <select
          aria-label="Distance correction"
          value={distModelName(analysis.correction)}
          disabled={isLocked("analysis.correction")}
          title={isLocked("analysis.correction") ? LOCKED_TOOLTIP : undefined}
          onChange={(e) => {
            // The K2P_PHYLIP option exists only to DISPLAY the current
            // correction — selecting it is a no-op (its ratio lives in
            // the exercise, not in this menu).
            if (e.target.value === "K2P_PHYLIP") return;
            dispatch({
              type: "setAnalysis",
              patch: {
                correction: e.target.value as Analysis["correction"],
              },
            });
          }}
        >
          {CORRECTIONS[alphabet].map((c) => (
            <option key={c} value={c}>
              {c === "P" ? "p (uncorrected)" : DIST_LABEL[c]}
            </option>
          ))}
          {/* v1.4 models that only an exercise file can prescribe:
            * displayed as the current value, never menu-selectable
            * (K2P_PHYLIP's ratio lives in the exercise). */}
          {analysis.correction === "F84" && (
            <option value="F84">F84</option>
          )}
          {typeof analysis.correction === "object" && (
            <option value="K2P_PHYLIP">
              {k2pLabel(analysis.correction.K2pPhylip.ratio)}
            </option>
          )}
        </select>
      </label>
      <label className="field">
        <span>Method</span>
        <select
          aria-label="Tree-building method"
          value={analysis.method}
          disabled={isLocked("analysis.method")}
          title={isLocked("analysis.method") ? LOCKED_TOOLTIP : undefined}
          onChange={(e) =>
            dispatch({
              type: "setAnalysis",
              patch: { method: e.target.value as Analysis["method"] },
            })
          }
        >
          <option value="Nj">Neighbor-Joining</option>
          <option value="Upgma">UPGMA</option>
        </select>
      </label>
      {qAvailable && (
        <button
          type="button"
          role="switch"
          aria-checked={matrixView === "q"}
          className="matrix-toggle"
          disabled={qGated}
          title={qGated ? "Available after you answer." : undefined}
          onClick={() =>
            dispatch({
              type: "setMatrixView",
              view: matrixView === "q" ? "distance" : "q",
            })
          }
        >
          Distance / Q
        </button>
      )}
      {bootstrapPanel}
    </div>
  );
}
