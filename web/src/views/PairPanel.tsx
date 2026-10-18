// Pair panel: "How was this distance computed?" (v1.1 plan Task 11,
// spec §5.2). Opens from a protein distance-matrix cell (App passes the
// `jtt_pair_detail` result) and shows:
//
// - the two sequences aligned, differing comparable sites marked in a
//   separate symbol row (never color alone), missing sites dimmed via
//   `data-missing`, amino acids tinted by property class on a
//   colorblind-safe (Okabe-Ito) palette;
// - p, Kimura and JTT side by side at 3 decimals, "can't estimate" for
//   Saturated;
// - the likelihood curve, the spec's Concept sentence and KaTeX Math
//   lines.
//
// A pair with no comparable sites (engine error InsufficientOverlap)
// renders the no-overlap message inside the open dialog — the panel
// never fails (Review Focus 5). It is a `role="dialog"`: focus moves in
// on open, Tab is trapped, Esc closes and focus returns to the element
// that opened it (§6.5).

import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";

import katex from "katex";
import "katex/dist/katex.min.css";

import type { Result } from "../engine";
import type { Alignment } from "../engine/generated/Alignment";
import type { Cell } from "../engine/generated/Cell";
import type { PairDetail } from "../engine/generated/PairDetail";
import { errorMessage } from "../explain/errors";
import { pairConcept, pairMathTex } from "../explain/pair";

import { LikelihoodCurve } from "./LikelihoodCurve";

export interface PairPanelProps {
  /** The protein alignment the pair was picked from. */
  aln: Alignment;
  /** `engine.jttPairDetail` for the picked pair; an `InsufficientOverlap`
   * error renders the no-overlap message instead of the detail. */
  detail: Result<PairDetail>;
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
  const html = useMemo(() => {
    try {
      return katex.renderToString(source, { throwOnError: true });
    } catch {
      return null; // show the source verbatim rather than fail
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

/** One aligned sequence as per-site spans: missing sites get
 * `data-missing` (dimmed, and pairwise-deleted by every protein model);
 * standard residues get their property-class tint. */
function SeqRow({
  label,
  seq,
  other,
}: {
  label: string;
  seq: string;
  other: string;
}) {
  return (
    <div className="pair-seq-row">
      <span className="seq-label">{label}</span>
      <span className="seq-chars">
        {seq.split("").map((c, k) => (
          <span
            key={k}
            className={AA_CLASS[c] ?? undefined}
            data-missing={
              !STANDARD.has(c) || !STANDARD.has(other[k]) ? true : undefined
            }
          >
            {c}
          </span>
        ))}
      </span>
    </div>
  );
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function PairPanel({ aln, detail, onClose }: PairPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<Element | null>(null);

  // Focus management (spec §6.5): on open, remember the focused element
  // (the matrix cell) and move focus into the dialog; on close, put it
  // back — the cell is gone only if the data changed, which is guarded.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      const el = restoreRef.current;
      if (el instanceof HTMLElement || el instanceof SVGElement) {
        if (el.isConnected) el.focus();
      }
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (panel === null) return;
    const els = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && (idx <= 0 || document.activeElement === panel)) {
      e.preventDefault();
      els[els.length - 1].focus();
    } else if (!e.shiftKey && idx === els.length - 1) {
      e.preventDefault();
      els[0].focus();
    }
  };

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
    <div className="pair-panel-backdrop">
      <section
        className="pair-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-panel-title"
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="pair-panel-head">
          <h2 id="pair-panel-title">
            How was this distance computed?{" "}
            <span className="pair-names">
              {labels[0]} vs {labels[1]}
            </span>
          </h2>
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
              <SeqRow label={labels[0]} seq={seqA} other={seqB} />
              <div className="pair-marker-row" aria-hidden="true">
                <span className="seq-label" />
                <span className="seq-chars">
                  {seqA.split("").map((ca, k) => {
                    const cb = seqB[k];
                    const diff =
                      STANDARD.has(ca) && STANDARD.has(cb) && ca !== cb;
                    return <span key={k}>{diff ? "×" : " "}</span>;
                  })}
                </span>
              </div>
              <SeqRow label={labels[1]} seq={seqB} other={seqA} />
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
              saturated={d.d_hat === null}
            />

            <p className="pair-concept">{pairConcept(d)}</p>
            <div className="pair-math">
              {pairMathTex(d).map((line, i) => (
                <KaTeXLine key={i} source={line} />
              ))}
            </div>
          </>
        )}

        {!detail.ok && (
          <p className="pair-no-overlap" role="status">
            {detail.error.kind === "InsufficientOverlap"
              ? "These two sequences share no comparable sites."
              : `${errorMessage(detail.error).title} ${errorMessage(detail.error).body}`}
          </p>
        )}
      </section>
    </div>
  );
}
