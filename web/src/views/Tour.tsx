// First-visit tour (v1.3 plan Task 12, spec §6.7): four steps highlight
// the stepper, the two trees, the matrix and the Concept/Math toggle,
// with Next/Back/Skip, an aria-live description and keyboard control
// (Esc/ArrowLeft/ArrowRight, Tab to the buttons). Shown once per device
// via the neophylo.tourSeen localStorage key — never in links — and
// reopened from More → "Take the tour". Where storage is blocked the
// write fails quietly and a module flag keeps it to once per page
// session (Review Focus 3); the app never errors on it.

import { useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, ReactNode } from "react";

import { markTourSeen } from "../design/tour";
import { TOUR_STEP_COUNT } from "../state/ui";
import type { Action } from "../state/session";

interface TourStep {
  /** CSS selector of the element the step highlights. */
  selector: string;
  title: string;
  text: string;
}

/** The four spec steps (§6.7), in order. */
const TOUR_STEPS: TourStep[] = [
  {
    selector: ".stepper",
    title: "the stepper",
    text: "Walk through how the algorithm joins pairs. Previous and Next move one join at a time; Play runs the whole build.",
  },
  {
    selector: ".trees",
    title: "the two trees",
    text: "The true or reference tree on the left, the tree built from the distances on the right. Each step highlights the join in both.",
  },
  {
    selector: ".matrix-wrap",
    title: "the distance matrix",
    text: "Every pairwise distance between the sequences. The pair about to join is highlighted; hover a cell to see it in the trees.",
  },
  {
    selector: ".mode-toggle",
    title: "Concept or Math",
    text: "The explanation panel describes each step in words or formulas — switch at any time.",
  },
];

const RING_PAD = 6;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TourProps {
  /** The open step, 0..TOUR_STEP_COUNT-1. */
  step: number;
  dispatch: Dispatch<Action>;
}

export function Tour({ step, dispatch }: TourProps): ReactNode {
  const s = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)];
  const [target, setTarget] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(120);
  const cardRef = useRef<HTMLDivElement>(null);

  // Locate the highlighted element on every step and on resize, and
  // give the card focus so Esc and the arrow keys work immediately.
  // Below the wide breakpoint .col-explain is a second grid row under
  // the centre column, so a step's target can start below the fold —
  // scroll it into view first and keep measuring on scroll (the smooth
  // scroll animates the rect; the backdrop is non-interactive, so the
  // page still scrolls under the tour) as well as on resize.
  useLayoutEffect(() => {
    const el = document.querySelector(s.selector);
    const measure = () => {
      const r = el?.getBoundingClientRect();
      setTarget(
        r === undefined || r === null
          ? null
          : { x: r.x, y: r.y, w: r.width, h: r.height },
      );
      const card = cardRef.current;
      if (card !== null) setCardH(card.offsetHeight);
    };
    // jsdom (the unit tests) implements neither scrollIntoView nor
    // matchMedia — feature-check both. No smooth scroll under
    // prefers-reduced-motion (§6.10).
    if (el !== null && typeof el.scrollIntoView === "function") {
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduced ? "auto" : "smooth",
      });
    }
    measure();
    cardRef.current?.focus();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [s.selector]);

  const end = () => {
    markTourSeen();
    dispatch({ type: "tourEnd" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      end();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      dispatch({ type: "tourNext" });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      dispatch({ type: "tourBack" });
    }
  };

  // The card docks under the target when it fits, above it otherwise,
  // horizontally centred on the target and clamped inside the page.
  // The final clamp also covers a taller-than-viewport target (the
  // matrix at short heights), where neither dock exists — the card and
  // its buttons must stay fully on screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(320, vw - 16);
  let top = 16;
  let left = (vw - cardW) / 2;
  if (target !== null) {
    top =
      target.y + target.h + cardH + 24 < vh
        ? target.y + target.h + 12
        : Math.max(8, target.y - cardH - 12);
    top = Math.max(8, Math.min(top, Math.max(8, vh - cardH - 8)));
    left = Math.max(
      8,
      Math.min(vw - cardW - 8, target.x + target.w / 2 - cardW / 2),
    );
  }

  // The ring outlines the part of the target actually on screen: for
  // a target taller than the viewport the full border would run off
  // the page and draw nothing where the user is looking.
  const vis =
    target === null
      ? null
      : {
          x: Math.max(0, target.x),
          y: Math.max(0, target.y),
          r: Math.min(target.x + target.w, vw),
          b: Math.min(target.y + target.h, vh),
        };
  const ring =
    vis !== null && vis.r - vis.x > 0 && vis.b - vis.y > 0 ? vis : null;

  return (
    <div
      className="tour"
      data-tour-target={s.selector}
      onKeyDown={onKeyDown}
    >
      <div className="tour-backdrop" aria-hidden="true" />
      {ring !== null && (
        <div
          className="tour-ring"
          aria-hidden="true"
          style={{
            left: ring.x - RING_PAD,
            top: ring.y - RING_PAD,
            width: ring.r - ring.x + RING_PAD * 2,
            height: ring.b - ring.y + RING_PAD * 2,
          }}
        />
      )}
      <div
        className="tour-card"
        role="dialog"
        aria-label="Take the tour"
        ref={cardRef}
        tabIndex={-1}
        style={{ top, left, width: cardW }}
      >
        <p className="tour-status" aria-live="polite">
          Tour step {step + 1} of {TOUR_STEP_COUNT}: {s.title}
        </p>
        <p className="tour-text">{s.text}</p>
        <div className="tour-actions">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => dispatch({ type: "tourBack" })}
          >
            Back
          </button>
          <button type="button" onClick={end}>
            Skip
          </button>
          <button
            type="button"
            className="tour-next"
            onClick={() =>
              step + 1 < TOUR_STEP_COUNT
                ? dispatch({ type: "tourNext" })
                : end()
            }
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
