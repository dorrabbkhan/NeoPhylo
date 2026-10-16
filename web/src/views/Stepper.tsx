// Trace stepper bar (plan Task 17, spec §6.1-6.2): prev/next buttons, a
// play button (one step per 800 ms, pausing at the end), a range slider,
// the "step k of N" readout and the RF distance once the final step is
// reached. Global keys: ← and → step, Space toggles play.
//
// Keyboard events are ignored when focus is inside a form control (so the
// slider's own arrow handling and Space on buttons keep their native
// behavior) and when a component already handled the event
// (e.preventDefault, e.g. the matrix grid's arrow navigation).

import { useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface StepperProps {
  /** Current step, 0..max. */
  step: number;
  /** Number of steps in the trace (NJ counts the final three-way join). */
  max: number;
  /** "x / max" RF readout, shown only when step === max; null hides it. */
  rfText: string | null;
  playing: boolean;
  onStep: (to: number) => void;
  onPlayToggle: () => void;
}

export function Stepper({
  step,
  max,
  rfText,
  playing,
  onStep,
  onPlayToggle,
}: StepperProps) {
  // Play: advance every 800 ms and pause automatically at the last step.
  useEffect(() => {
    if (!playing) return;
    if (step >= max) {
      onPlayToggle();
      return;
    }
    const id = setInterval(() => onStep(step + 1), 800);
    return () => clearInterval(id);
  }, [playing, step, max, onStep, onPlayToggle]);

  // Global keys: ←/→ step, Space toggles play.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable ||
        e.defaultPrevented
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        onStep(step - 1);
      } else if (e.key === "ArrowRight") {
        onStep(step + 1);
      } else if (e.key === " ") {
        // Space on a focused button activates that button natively.
        if (tag === "BUTTON") return;
        e.preventDefault();
        onPlayToggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, onStep, onPlayToggle]);

  const onSliderKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Arrow keys on the focused slider change it natively; stop them from
    // double-firing anything else (the global handler skips INPUT anyway,
    // this is belt and suspenders for Space).
    if (e.key === " ") e.preventDefault();
  };

  return (
    <div className="stepper" role="group" aria-label="Trace stepper">
      <button
        type="button"
        aria-label="Previous step"
        disabled={step <= 0}
        onClick={() => onStep(step - 1)}
      >
        ◀ prev
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onPlayToggle}
      >
        {playing ? "⏸ pause" : "⏵ play"}
      </button>
      <button
        type="button"
        aria-label="Next step"
        disabled={step >= max}
        onClick={() => onStep(step + 1)}
      >
        ▶ next
      </button>
      <input
        type="range"
        aria-label="Step"
        min={0}
        max={max}
        value={step}
        onKeyDown={onSliderKey}
        onChange={(e) => onStep(e.target.valueAsNumber)}
      />
      <span className="stepper-status">
        step {step} of {max}
      </span>
      {step === max && rfText !== null && (
        <span className="stepper-rf">RF = {rfText}</span>
      )}
    </div>
  );
}
