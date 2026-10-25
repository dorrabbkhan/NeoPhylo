// Pair panel: "How was this distance computed?" (v1.1 plan Task 11,
// spec §5.2). Opens from a protein distance-matrix cell (App passes the
// `jtt_pair_detail` result) and shows:
//
// - the two sequences aligned as a grid of fixed-width columns, one per
//   site: position number every 10 columns, top residue, a marker cell
//   (× for comparable differing sites, blank otherwise, dimmed for
//   missing), bottom residue — never color alone; amino acids tinted by
//   property class on a colorblind-safe (Okabe-Ito) palette. The strip
//   scrolls horizontally so every position is reachable;
// - p, Kimura and JTT side by side at 3 decimals, "can't estimate" for
//   Saturated;
// - the likelihood curve, then the explanation following the global
//   Concept/Math mode — Concept shows the spec sentence, Math the KaTeX
//   lines (log L(d), comparable sites, d̂). The panel carries the same
//   ModeToggle as the explanation column, bound to the same
//   `Session.mode` via `setMode`, inside the dialog's focus trap.
//
// A pair with no comparable sites (engine error InsufficientOverlap)
// renders the no-overlap message inside the open dialog — the panel
// never fails (Review Focus 5). It renders inside Sheet (v1.3 §6.2):
// a centered dialog above 1024 px, a full-screen sheet below it —
// focus moves in on open, Tab is trapped, Esc closes and focus
// returns to the element that opened it (§6.5).

import { useMemo } from "react";
import type { Dispatch } from "react";

import type { Result } from "../engine";
import type { Alignment } from "../engine/generated/Alignment";
import type { Cell } from "../engine/generated/Cell";
import type { PairDetail } from "../engine/generated/PairDetail";
import { errorMessage } from "../explain/errors";
import { MATH_LOADING, renderMath, useKatex } from "../explain/katex";
import { pairConcept, pairMathTex } from "../explain/pair";
import type { Action, Session } from "../state/session";

import { LikelihoodCurve } from "./LikelihoodCurve";
import { ModeToggle } from "./ModeToggle";
import { Sheet } from "./Sheet";

export interface PairPanelProps {
  /** The protein alignment the pair was picked from. */
  aln: Alignment;
  /** `engine.jttPairDetail` for the picked pair; an `InsufficientOverlap`
   * error renders the no-overlap message instead of the detail. */
  detail: Result<PairDetail>;
  /** The global Concept/Math mode the explanation follows (§5.2). */
  mode: Session["mode"];
  /** Session dispatch — the in-panel ModeToggle calls `setMode`. */
  dispatch: Dispatch<Action>;
  onClose: () => void;
}

/** The 20 standard amino acids in engine state order; anything else
 * (B Z J X U O * - ?) is a missing character (v1.1 spec §3.1). */
const STANDARD = new Set("ARNDCQEGHILKMFPSTWYV");

/** Property class → CSS modifier, for the Okabe-Ito tints in index.css.
 * Colorblind safety: hue groups plus the symbol row, so color never
 * carries meaning alone. */
const AA_CLASS: Record<string, string> = {};
for (const c of "AILMFVW") AA_CLASS[c] = "aa-hydro";
for (const c of "NCQSTY") AA_CLASS[c] = "aa-polar";
for (const c of "HKR") AA_CLASS[c] = "aa-pos";
for (const c of "DE") AA_CLASS[c] = "aa-neg";
for (const c of "GP") AA_CLASS[c] = "aa-special";

function cellText(c: Cell): string {
  return c === "Saturated" ? "can't estimate" : c.Value.toFixed(3);
}

function KaTeXLine({ source }: { source: string }) {
  const katex = useKatex();
  const html = useMemo(
    () => (katex === null ? null : renderMath(katex, source)),
    [katex, source],
  );
  if (katex === null) {
    return <p className="math-line math-loading">{MATH_LOADING}</p>;
  }
  if (html === null) {
    return (
      <p className="math-line">
        <code>{source}</code>
      </p>
    );
  }
  return <p className="math-line" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PairPanel({
  aln,
  detail,
  mode,
  dispatch,
  onClose,
}: PairPanelProps) {
  const d = detail.ok ? detail.value : null;
  const labels =
    d !== null
      ? [aln.labels[d.a] ?? `#${d.a}`, aln.labels[d.b] ?? `#${d.b}`]
      : !detail.ok && detail.error.kind === "InsufficientOverlap"
        ? [detail.error.a, detail.error.b]
        : ["", ""];

  // The aligned sequences as plain text — sequences are uppercase ASCII,
  // one char per site (Alignment is equal-length by construction).
  const seqA = d !== null ? String.fromCharCode(...aln.seqs[d.a]) : "";
  const seqB = d !== null ? String.fromCharCode(...aln.seqs[d.b]) : "";

  return (
    <Sheet
      className="pair-panel"
      labelledBy="pair-panel-title"
      onClose={onClose}
    >
        <header className="pair-panel-head">
          <h2 id="pair-panel-title">
            How was this distance computed?{" "}
            <span className="pair-names">
              {labels[0]} vs {labels[1]}
            </span>
          </h2>
          <ModeToggle mode={mode} dispatch={dispatch} />
          <button
            type="button"
            className="close"
            aria-label="Close pair details"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {d !== null && (
          <>
            <div className="pair-seqs">
              <div className="pair-seq-legend" aria-hidden="true">
                <span className="seq-label">{"\u00a0"}</span>
                <span className="seq-label">{labels[0]}</span>
                <span className="seq-label">{"\u00a0"}</span>
                <span className="seq-label">{labels[1]}</span>
              </div>
              <div
                className="pair-seq-strip"
                role="group"
                aria-label="Aligned sequences"
                tabIndex={0}
              >
                <div className="pair-seq-grid">
                  {seqA.split("").map((ca, k) => {
                    const cb = seqB[k];
                    const comparable = STANDARD.has(ca) && STANDARD.has(cb);
                    return (
                      <div className="pair-col" key={k}>
                        <span className="pair-pos" aria-hidden="true">
                          {(k + 1) % 10 === 0 ? k + 1 : "\u00a0"}
                        </span>
                        <span
                          className={`pair-res${AA_CLASS[ca] ? ` ${AA_CLASS[ca]}` : ""}`}
                          data-missing={comparable ? undefined : true}
                        >
                          {ca}
                        </span>
                        <span
                          className="pair-marker"
                          aria-hidden="true"
                          data-missing={comparable ? undefined : true}
                        >
                          {comparable && ca !== cb ? "×" : "\u00a0"}
                        </span>
                        <span
                          className={`pair-res${AA_CLASS[cb] ? ` ${AA_CLASS[cb]}` : ""}`}
                          data-missing={comparable ? undefined : true}
                        >
                          {cb}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <dl className="pair-numbers">
              <div>
                <dt>p (proportion different)</dt>
                <dd>{d.p.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Kimura</dt>
                <dd>{cellText(d.kimura)}</dd>
              </div>
              <div>
                <dt>JTT</dt>
                <dd>{cellText(d.jtt)}</dd>
              </div>
            </dl>

            <LikelihoodCurve
              curve={d.curve}
              dHat={d.d_hat}
              loglHat={d.logl_hat}
              saturated={d.d_hat === null}
            />

            {mode === "concept" ? (
              <p className="pair-concept">{pairConcept(d)}</p>
            ) : (
              <div className="pair-math">
                {pairMathTex(d).map((line, i) => (
                  <KaTeXLine key={i} source={line} />
                ))}
              </div>
            )}
          </>
        )}

        {!detail.ok && (
          <p className="pair-no-overlap" role="status">
            {detail.error.kind === "InsufficientOverlap"
              ? "These two sequences share no comparable sites."
              : `${errorMessage(detail.error).title} ${errorMessage(detail.error).body}`}
          </p>
        )}
    </Sheet>
  );
}
