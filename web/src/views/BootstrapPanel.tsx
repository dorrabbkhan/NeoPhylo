// "How sure are we?" bootstrap panel (v1.2 plan Task 11, spec §6.2,
// §6.6). App renders it under Analysis only while the stepper sits at
// its final position. The panel is a pure view over Session.bootstrap:
// every button dispatches a session action and the App effect is the
// only code that talks to the bootstrap client.
//
// The grouping-count line is method-aware (Review Focus 1): NJ builds
// an unrooted tree with n−3 internal edges, UPGMA a rooted one with
// n−2 internal branches. For tiny trees the line explains why there
// is nothing (or little) to test instead of showing an empty result.

import { useMemo } from "react";
import type { Dispatch } from "react";

import katex from "katex";

import { bootstrapConcept, bootstrapMathTex } from "../explain/bootstrap";
import { errorMessage } from "../explain/errors";
import {
  MAX_REPLICATES,
  MIN_REPLICATES,
} from "../state/session";
import type { Action, Session } from "../state/session";

import { NumberField } from "./Controls";

export interface BootstrapPanelProps {
  session: Session;
  dispatch: Dispatch<Action>;
}

/** "4 s" / "2 min" — the T in "Replicate k of N · about T left" and
 * the N in "This will take about N" (spec §5). */
function aboutMs(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** KaTeX for math-mode lines that carry a formula ("="); the rest are
 * plain text — the same convention as ExplanationPanel. */
function MathLine({ source }: { source: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(source, { throwOnError: true });
    } catch {
      return null;
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

export function BootstrapPanel({ session, dispatch }: BootstrapPanelProps) {
  const b = session.bootstrap;
  const taxa = session.alignment?.labels.length ?? 0;
  const method = session.exercise.analysis.method;
  // NJ trees are unrooted (n−3 internal edges), UPGMA rooted (n−2
  // internal branches) — spec §6.2 / Global Constraints.
  const groupings = Math.max(0, taxa - (method === "Nj" ? 3 : 2));
  const shape = method === "Nj" ? "an unrooted tree" : "a rooted tree";

  const active =
    b.status === "estimating" ||
    b.status === "confirming" ||
    b.status === "running";
  const running = b.status === "running" || b.status === "estimating";
  const settingsChanged =
    b.settingsUsed !== null &&
    (b.settingsUsed.replicates !== b.replicates ||
      b.settingsUsed.seed !== b.seed);
  const error = b.status === "error" && b.error !== null
    ? errorMessage(b.error)
    : null;

  return (
    <section className="bootstrap-panel" aria-label="How sure are we?">
      <h2>How sure are we?</h2>
      <p className="grouping-count">
        With {taxa} taxa, {shape} has {groupings} grouping
        {groupings === 1 ? "" : "s"} to test.
      </p>

      <div className="bootstrap-explain">
        {session.mode === "concept" ? (
          <p>{bootstrapConcept()}</p>
        ) : (
          bootstrapMathTex().map((line, i) =>
            line.includes("=") ? (
              <MathLine key={i} source={line} />
            ) : (
              <p key={i}>{line}</p>
            ),
          )
        )}
      </div>

      <NumberField
        label="Replicates"
        value={b.replicates}
        min={MIN_REPLICATES}
        max={MAX_REPLICATES}
        disabled={false}
        onCommit={(replicates) =>
          dispatch({ type: "setBootstrapSettings", patch: { replicates } })
        }
      />
      <NumberField
        label="Seed"
        value={b.seed}
        min={0}
        max={Number.MAX_SAFE_INTEGER}
        disabled={false}
        onCommit={(seed) =>
          dispatch({ type: "setBootstrapSettings", patch: { seed } })
        }
      />

      {running && (
        <div
          role="progressbar"
          className="bootstrap-progress"
          aria-label="Bootstrap progress"
          aria-valuemin={0}
          aria-valuemax={b.total}
          aria-valuenow={b.done}
        >
          <p className="bootstrap-progress-text">
            {b.status === "estimating"
              ? "Estimating run time…"
              : `Replicate ${b.done} of ${b.total}` +
                (b.etaMs !== null ? ` · about ${aboutMs(b.etaMs)} left` : "")}
          </p>
        </div>
      )}

      {b.status === "confirming" && (
        <p className="bootstrap-confirm">
          This will take about {aboutMs(b.etaMs ?? 0)}.
        </p>
      )}

      {(b.status === "done" || b.status === "cancelled") && (
        <div className="bootstrap-status" role="status" aria-live="polite">
          {b.status === "done" ? (
            <p>
              Run complete: {b.done - b.failed} of {b.total} replicates
              counted.
            </p>
          ) : (
            <p>Cancelled.</p>
          )}
        </div>
      )}

      {b.status === "done" && b.settingsUsed !== null && (
        <p className="bootstrap-results-label">
          Results for {b.settingsUsed.replicates} replicates, seed{" "}
          {b.settingsUsed.seed}
          {settingsChanged
            ? "; settings changed, run again to update."
            : "."}
        </p>
      )}

      {b.failed > 0 && (
        <p className="bootstrap-skipped">
          {b.failed} replicates skipped (saturated)
        </p>
      )}
      {b.total > 0 && b.failed / b.total > 0.1 && (
        <p className="bootstrap-warning">
          The data is close to saturation; support is based on fewer
          replicates.
        </p>
      )}

      {error !== null && (
        <p className="error bootstrap-error" role="alert">
          <strong>{error.title}.</strong> {error.body}
        </p>
      )}

      <div className="bootstrap-actions">
        {b.status === "confirming" && (
          <button
            type="button"
            disabled={b.jobId === null}
            onClick={() =>
              b.jobId !== null &&
              dispatch({ type: "bootstrapConfirmed", jobId: b.jobId })
            }
          >
            Start
          </button>
        )}
        {active ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "bootstrapCancelRequested" })}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled={groupings === 0 || session.alignment === null}
            onClick={() => dispatch({ type: "bootstrapRequested" })}
          >
            {b.prefilledRun
              ? `Run bootstrap (${b.replicates} replicates)`
              : "Run bootstrap"}
          </button>
        )}
      </div>
    </section>
  );
}
