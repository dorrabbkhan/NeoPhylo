// Explanation panel (plan Task 18, spec §6.1-6.3). It owns the global
// Concept/Math toggle — the mode lives in Session.mode so it is
// remembered for the whole session and shared by every view — and its
// body is an aria-live region so step changes are announced (§6.5).
//
// Concept mode shows conceptText; Math mode renders each mathTex line
// with KaTeX. Lines without "=" (the tie notice) are plain text, not
// formulas. Math mode ends with a rounding disclosure — displayed values
// are 3-decimal, calculations use full precision.

import { useMemo } from "react";
import type { Dispatch } from "react";

import katex from "katex";
import "katex/dist/katex.min.css";

import type { Trace } from "../engine/generated/Trace";
import { conceptText } from "../explain/concept";
import { mathTex } from "../explain/math";
import type { Action, Session } from "../state/session";

import { ModeToggle } from "./ModeToggle";

export interface ExplanationPanelProps {
  /** The session's build trace; null when none was requested (>50 taxa). */
  trace: Trace | null;
  /** Current stepper position; join under discussion is steps[step]. */
  step: number;
  /** Node display names indexed by NodeId (leaf labels, then u1, u2, …). */
  labels: string[];
  mode: Session["mode"];
  dispatch: Dispatch<Action>;
}

/** mathTex lines are KaTeX source unless they carry no formula at all —
 * plain notices like "Tie: chosen by input order." render as text. */
const isFormula = (line: string) => line.includes("=");

function MathLine({ source }: { source: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(source, { throwOnError: true });
    } catch {
      return null; // malformed source: show it verbatim rather than fail
    }
  }, [source]);
  if (html === null) {
    return (
      <p className="math-line">
        <code>{source}</code>
      </p>
    );
  }
  return <p className="math-line" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ExplanationPanel({
  trace,
  step,
  labels,
  mode,
  dispatch,
}: ExplanationPanelProps) {
  return (
    <div className="explain">
      <ModeToggle mode={mode} dispatch={dispatch} />
      <div className="explain-body" aria-live="polite">
        {trace === null ? (
          <p>
            Step-by-step explanations appear once a tree with a trace is built.
          </p>
        ) : mode === "concept" ? (
          conceptText(trace, step, labels)
            .split("\n")
            .map((line, i) => <p key={i}>{line}</p>)
        ) : (
          <>
            {mathTex(trace, step, labels).map((line, i) =>
              isFormula(line) ? (
                <MathLine key={i} source={line} />
              ) : (
                <p key={i}>{line}</p>
              ),
            )}
            <p className="math-note">
              Values shown rounded; calculations use full precision.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
