// Sandbox import box (plan Task 20, spec §3.1 and §6.2; PHYLIP support
// v1.1 plan Task 10, v1.1 spec §5.1). Rendered only while the session
// source is "sandbox"; the lesson → sandbox switch lives in App. The
// format is auto-detected: input whose first non-space character is ">"
// goes to engine.parseFasta, input whose first non-blank line is two
// numbers (`n m`, a PHYLIP header) goes to engine.parsePhylip, and
// everything else to engine.parseNewick.
//
// After a PHYLIP import a "Strict / Relaxed names" toggle shows the
// name mode Auto actually used; toggling it re-parses the same pasted
// text with that mode forced, so a mis-sniffed file can be corrected
// without re-pasting.
//
// Error flow: a parse failure is stored locally and shown under the
// box; a successful parse dispatches importAlignment/importTree and any
// downstream failure (too few taxa, ragged alignment, label mismatch)
// arrives back through session.error. SaturatedMatrix is handled by the
// §6.3 teaching notice instead of being repeated here.

import { lazy, Suspense, useId, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent } from "react";

import { engine } from "../engine";
import type { MatrixFormat } from "../engine/generated/MatrixFormat";
import type { NameMode } from "../engine/generated/NameMode";
import type { NeoError } from "../engine/generated/NeoError";
import type { SiteFilter } from "../engine/generated/SiteFilter";
import { errorMessage } from "../explain/errors";
import { loadLesson } from "../lessons/loader";
import type { Action, Session } from "../state/session";
import { hasImportedData, siteFilterName } from "../state/session";

import { EmptyState } from "./EmptyState";

// The Distance-matrix tab — paste, file and the typing grid — is a
// lazy chunk (v1.4c Task 8, initial-JS budget): it ships MatrixGrid,
// the ambiguity-question UI and the matrix parsers' glue only when a
// student opens the tab.
const MatrixImport = lazy(() =>
  import("./matrix/MatrixImport").then((m) => ({
    default: m.MatrixImport,
  })),
);

export interface ImportPanelProps {
  session: Session;
  dispatch: Dispatch<Action>;
  /** Opens the dataset-library sheet (v1.4b Task 11); App renders it
   * at the shell level so it also works over the Settings drawer. */
  onOpenDatasets: () => void;
}

const ACCEPT = ".fasta,.fa,.fas,.nwk,.tre,.phy,.phylip,.meg,.txt";

/** True when the first non-blank line is a PHYLIP header `n m`
 * (v1.1 spec §5.1): one or more digits, whitespace, digits. */
function looksLikePhylip(input: string): boolean {
  const first = input.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return /^\s*\d+\s+\d+/.test(first);
}

/** True when the first non-blank line starts with `#mega`
 * (case-insensitive), after a BOM is stripped (v1.4b Task 11; the
 * parser's own header check decides from there). */
function looksLikeMeg(input: string): boolean {
  const stripped = input.replace(/^\uFEFF/, "");
  const first =
    stripped.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return first.trimStart().toLowerCase().startsWith("#mega");
}

/** A fetch/lookup failure for a §6.8 sample button, as a NeoError so
 * it renders in the panel's usual error line. */
function sampleError(detail: string): NeoError {
  return {
    kind: "InvalidExercise",
    field: "sample",
    msg: `could not load the sample (${detail})`,
  };
}

/** The hint under the box tracks the active site filter (v1.4b Task
 * 10 fix round 2): "skipped pair by pair" is only true of pairwise
 * deletion. Complete and partial describe the column removal their
 * treatment performs — "(complete deletion)" names the filter the
 * same way the GapControl count line does (`siteFilterName`); the
 * partial sentence already carries the cutoff in "less than N%
 * coverage", so its parenthetical stays "(partial deletion)". */
function gapHint(f: SiteFilter): string {
  if (f.kind === "complete") {
    return `Columns with a gap or ambiguous base in any sequence are removed (${siteFilterName(f)} deletion).`;
  }
  if (f.kind === "partial") {
    return `Columns with less than ${f.cutoff_pct}% coverage are removed (${f.kind} deletion).`;
  }
  return "Gaps and ambiguous bases are skipped pair by pair.";
}

export function ImportPanel({
  session,
  dispatch,
  onOpenDatasets,
}: ImportPanelProps) {
  const [text, setText] = useState("");
  // `meg` marks an error from the .meg import path so errorMessage
  // shows the MEGA hint instead of the FASTA/Newick one (Task 11 fix
  // round 2); it rides with the error so it can't outlive it.
  const [localError, setLocalError] = useState<{
    error: NeoError;
    meg?: boolean;
  } | null>(null);
  // The last pasted PHYLIP text, the name mode the parse used and the
  // import's `name` (a picked file's name, undefined for a paste), so
  // the Strict/Relaxed toggle can re-parse without re-pasting.
  const [phylip, setPhylip] = useState<{
    text: string;
    namesUsed: NameMode;
    name?: string;
  } | null>(null);
  // `.meg` parser notices — ignored !commands, auto-detected alphabet
  // and the matrix-file refusal pointing at v1.4c (v1.4b Task 11).
  const [megNotices, setMegNotices] = useState<string[] | null>(null);
  // An asymmetric square PHYLIP matrix offers "Use the lower
  // triangle" — one click re-parses with use_lower_if_asymmetric
  // (v1.4c Task 8; matrix_parse names the first differing cell).
  const [asym, setAsym] = useState<{ text: string; name?: string } | null>(
    null,
  );
  const tabId = useId();
  // The tab strip's selection. A matrix session defaults to the
  // Distance matrix tab (fix round 1) and a later origin change
  // re-derives it — a matrix import selects its tab, an alignment
  // import brings "Sequences or tree" back (adjust-state-in-render).
  const inMatrix = session.alignmentOrigin === "matrix";
  const [tab, setTab] = useState<"seq" | "matrix">(
    inMatrix ? "matrix" : "seq",
  );
  const [lastOrigin, setLastOrigin] = useState(session.alignmentOrigin);
  if (session.alignmentOrigin !== lastOrigin) {
    setLastOrigin(session.alignmentOrigin);
    setTab(inMatrix ? "matrix" : "seq");
  }
  // The matrix tab's component mounts whenever its tab is selected —
  // click, arrow keys, the origin-change re-derive above, the initial
  // render or a URL restore — and stays mounted afterwards (the
  // tabpanel is only `hidden`), so the lazy chunk fetches on the first
  // selection and the panel's state survives a switch (fix round 2:
  // an origin-driven selection counts too, not only selectTab).
  const [matrixOpened, setMatrixOpened] = useState(inMatrix);
  const tabRef = useRef<(HTMLButtonElement | null)[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const TABS: readonly ("seq" | "matrix")[] = ["seq", "matrix"];
  const selectTab = (t: "seq" | "matrix") => {
    setTab(t);
    if (t === "matrix") setMatrixOpened(true);
  };
  // ARIA tabs keyboard pattern (same as ConsensusTabs): Left/Right
  // move through the tabs with wrap-around, Home/End to the ends —
  // focus follows and the tab activates (roving tabindex below).
  const onTabsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = TABS.indexOf(tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (cur + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (cur - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0 || next === cur) return;
    e.preventDefault();
    selectTab(TABS[next]);
    tabRef.current[next]?.focus();
  };

  if (session.source !== "sandbox") return null;

  // `name` is the picked file's name for the importAlignment action
  // (the `.meg` export's !Title); a paste passes none. It is an
  // argument, not state, so a failed or tree-shaped file can't leave
  // its name behind for a later import to pick up (Task 11 fix).
  const importText = (input: string, name?: string) => {
    const t = input.trimStart();
    if (t === "") {
      setLocalError(null);
      return;
    }
    setAsym(null);
    // A recognized matrix format routes to the matrix parsers BEFORE
    // the alignment ones (v1.4c spec §6.1): a matrix .meg opens a
    // matrix session instead of hitting the alignment parser's
    // distance-matrix refusal (Task 8 — detection replaces the
    // message-prefix match).
    const det = engine.detectMatrixFormat(input);
    if (det.ok && det.value !== null) {
      importMatrixText(input, det.value, false, name);
      return;
    }
    // A picked file named *.meg goes to the .meg parser on its
    // extension alone (Task 11 fix round 2): the #mega sniff only
    // applies to pasted text, so a file saved without the header gets
    // the engine's missing-#mega error, not a Newick one.
    if (name !== undefined && /\.meg$/i.test(name)) {
      importMeg(input, name);
      return;
    }
    if (t.startsWith(">")) {
      const r = engine.parseFasta(input);
      if (!r.ok) {
        setLocalError({ error: r.error });
        return;
      }
      setLocalError(null);
      setPhylip(null);
      setMegNotices(null);
      dispatch({
        type: "importAlignment",
        alignment: r.value,
        name,
      });
    } else if (looksLikeMeg(input)) {
      importMeg(input, name);
    } else if (looksLikePhylip(input)) {
      importPhylip(input, "Auto", name);
    } else {
      const r = engine.parseNewick(input);
      if (!r.ok) {
        setLocalError({ error: r.error });
        return;
      }
      setLocalError(null);
      setPhylip(null);
      dispatch({ type: "importTree", tree: r.value });
    }
  };

  const importPhylip = (input: string, names: NameMode, name?: string) => {
    const r = engine.parsePhylip(input, names);
    if (!r.ok) {
      setLocalError({ error: r.error });
      return;
    }
    setLocalError(null);
    setPhylip({ text: input, namesUsed: r.value.names_used, name });
    setMegNotices(null);
    dispatch({
      type: "importAlignment",
      alignment: r.value.alignment,
      name,
    });
  };

  // Matrix file/paste import (v1.4c Task 8): PHYLIP parses with the
  // Auto name mode and no lower-triangle override; a `MatrixFile`
  // `!Title` becomes the session's display name, falling back to the
  // picked file's name.
  const importMatrixText = (
    input: string,
    format: MatrixFormat,
    useLower: boolean,
    name?: string,
  ) => {
    const r =
      format === "Meg"
        ? engine.parseMegMatrix(input)
        : engine.parsePhylipMatrix(input, {
            names: "Auto",
            use_lower_if_asymmetric: useLower,
          });
    setPhylip(null);
    if (!r.ok) {
      setMegNotices(null);
      setLocalError({ error: r.error });
      setAsym(
        r.error.kind === "InvalidMatrix" &&
          r.error.msg.startsWith("matrix is not symmetric")
          ? { text: input, name }
          : null,
      );
      return;
    }
    setLocalError(null);
    setAsym(null);
    setMegNotices(r.value.notices.length > 0 ? r.value.notices : null);
    dispatch({
      type: "importMatrix",
      input: r.value.matrix,
      name: r.value.title ?? name ?? null,
    });
  };

  // `.meg` (v1.4b Task 11): notices ride the session's notice area.
  // A matrix .meg never reaches here — `detectMatrixFormat` routes it
  // to `importMatrixText` first, so only sequence .meg errors show
  // the engine's line number.
  const importMeg = (input: string, name?: string) => {
    const r = engine.parseMeg(input);
    if (!r.ok) {
      setPhylip(null);
      setMegNotices(null);
      setLocalError({ error: r.error, meg: true });
      return;
    }
    setLocalError(null);
    setPhylip(null);
    setMegNotices(r.value.notices.length > 0 ? r.value.notices : null);
    dispatch({
      type: "importAlignment",
      alignment: r.value.alignment,
      name,
    });
  };

  const onFile = async (file: File) => {
    importText(await file.text(), file.name);
    // Reset so picking the same file again still fires onChange.
    if (fileRef.current !== null) fileRef.current.value = "";
  };

  // The §6.8 sample buttons: the weak-support FASTA ships in
  // public/samples (regenerated by scripts/samples/weak_support.py);
  // cytochrome c reuses the lesson file's embedded alignment. A fetch
  // or parse failure lands in the panel's normal error line.
  const importSampleFasta = (fasta: string, name: string) => {
    const r = engine.parseFasta(fasta);
    if (!r.ok) {
      setLocalError({ error: r.error });
      return;
    }
    setLocalError(null);
    dispatch({ type: "importAlignment", alignment: r.value, name });
  };
  const onWeakSupport = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}samples/weak-support.fasta`,
      );
      if (!res.ok) {
        setLocalError({
          error: sampleError(`sample fetch failed (HTTP ${res.status})`),
        });
        return;
      }
      importSampleFasta(await res.text(), "weak-support");
    } catch (e) {
      setLocalError({ error: sampleError(String(e)) });
    }
  };
  const onCytochromeC = async () => {
    const r = await loadLesson("cytochrome-c");
    if (!r.ok || r.value.data.kind !== "embedded") {
      setLocalError({
        error: sampleError("the cytochrome-c lesson is unavailable"),
      });
      return;
    }
    importSampleFasta(r.value.data.fasta, "cytochrome-c");
  };

  const shown =
    localError?.error ??
    (session.error !== null && session.error.kind !== "SaturatedMatrix"
      ? session.error
      : null);
  const msg =
    shown !== null
      ? errorMessage(shown, localError?.meg === true ? "meg" : undefined)
      : null;

  return (
    <section className="import-panel" aria-label="Import data">
      <h2>Import data</h2>
      <div
        role="tablist"
        aria-label="Import kind"
        className="import-tabs"
        onKeyDown={onTabsKeyDown}
      >
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              tabRef.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${tabId}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${tabId}-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => selectTab(t)}
          >
            {t === "seq" ? "Sequences or tree" : "Distance matrix"}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel-matrix`}
        aria-labelledby={`${tabId}-tab-matrix`}
        hidden={tab !== "matrix"}
      >
        {(matrixOpened || tab === "matrix") && (
          <Suspense fallback={null}>
            <MatrixImport session={session} dispatch={dispatch} />
          </Suspense>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel-seq`}
        aria-labelledby={`${tabId}-tab-seq`}
        hidden={tab !== "seq"}
      >
        <>
          {!hasImportedData(session) && (
            <EmptyState text="Paste or upload sequences, or try a sample:">
              <div className="empty-actions">
                <button type="button" onClick={() => void onCytochromeC()}>
                  Cytochrome c (protein)
                </button>
                <button type="button" onClick={() => void onWeakSupport()}>
                  Weak-support example (DNA)
                </button>
              </div>
            </EmptyState>
          )}
          <label className="field import-text">
            <span>Paste sequences or a tree</span>
            <textarea
              rows={6}
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="import-actions">
            <button type="button" onClick={() => importText(text)}>
              Import
            </button>
            <label className="field import-file">
              <span>Choose a file</span>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f !== undefined) void onFile(f);
                }}
              />
            </label>
            <button type="button" onClick={onOpenDatasets}>
              Open dataset…
            </button>
          </div>
          {phylip !== null && (
            <div
              className="phylip-names"
              role="radiogroup"
              aria-label="PHYLIP name style"
            >
              <p className="import-hint">
                PHYLIP names: Strict takes the first 10 characters of each
                line; Relaxed ends the name at the first space.
              </p>
              {(["Strict", "Relaxed"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={phylip.namesUsed === mode}
                  onClick={() =>
                    importPhylip(phylip.text, mode, phylip.name)
                  }
                >
                  {mode} names
                </button>
              ))}
            </div>
          )}
          <p className="import-hint">
            {gapHint(
              session.exercise.analysis.site_filter ?? { kind: "pairwise" },
            )}
          </p>
        </>
      </div>
      {asym !== null && (
        <p className="phylip-note" role="status">
          <button
            type="button"
            onClick={() => {
              importMatrixText(asym.text, "Phylip", true, asym.name);
            }}
          >
            Use the lower triangle
          </button>
        </p>
      )}
      {megNotices !== null && (
        <div className="phylip-note" role="status">
          {megNotices.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {msg !== null && (
        <p role="alert" className="error">
          <strong>{msg.title}.</strong> {msg.body}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          if (
            hasImportedData(session) &&
            !window.confirm(
              "Leave sandbox? Your imported data will be cleared.",
            )
          ) {
            return;
          }
          dispatch({ type: "exitSandbox" });
        }}
      >
        Back to the lesson
      </button>
    </section>
  );
}
