// "Open dataset" sheet (v1.4b plan Task 11, spec §5.3): the curated
// data library's picker. One row per index.json entry — title, taxa ×
// sites, alphabet, "good for" and source/license with a provenance
// link. Opening a dataset goes through the same fetch→parse→dispatch
// path as an opened file (registry.ts). Over unsaved sandbox work the
// click asks first — the same confirm pattern the v1.4 labs use
// (Review Focus 5); declining keeps the work exactly.
//
// A lazy chunk (conductor note 3): fetched on first open like
// PhylipHelp/PairPanel, never in the initial bundle. Sheet's
// mount-time focus contract is unchanged — it runs when the chunk
// resolves; the SW's `**/*.js` precache keeps it working offline.

import { useEffect, useState } from "react";

import type { Alignment } from "../engine/generated/Alignment";
import { errorMessage } from "../explain/errors";
import {
  listDatasets,
  loadDataset,
  loadProvenance,
} from "../library/registry";
import type {
  DatasetProvenance,
  DatasetSummary,
} from "../library/registry";

import { Sheet } from "./Sheet";

export interface DatasetSheetProps {
  /** True while the sandbox holds user data — picking a dataset then
   * asks "Replace your unsaved work?" first (Review Focus 5). */
  confirmReplace: boolean;
  /** Called with the chosen summary and its parsed alignment — the
   * caller dispatches the importDataset action and closes the sheet. */
  onOpen: (ds: DatasetSummary, alignment: Alignment) => void;
  onClose: () => void;
}

export function DatasetSheet({
  confirmReplace,
  onOpen,
  onClose,
}: DatasetSheetProps) {
  const [list, setList] = useState<DatasetSummary[] | null>(null);
  const [provenance, setProvenance] = useState<
    Record<string, DatasetProvenance | null>
  >({});
  const [indexError, setIndexError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The dataset waiting on the unsaved-work answer (Review Focus 5).
  const [pending, setPending] = useState<DatasetSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDatasets()
      .then((ds) => {
        if (cancelled) return;
        setList(ds);
        // Provenance fills the source column; a missing file just
        // leaves the index's own fields on the row.
        for (const d of ds) {
          void loadProvenance(d).then((p) => {
            if (cancelled) return;
            setProvenance((prev) => ({ ...prev, [d.id]: p }));
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setIndexError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (ds: DatasetSummary) => {
    if (confirmReplace && pending === null) {
      setPending(ds);
      return;
    }
    setPending(null);
    setLoadError(null);
    setBusy(true);
    void loadDataset(ds.id).then((r) => {
      setBusy(false);
      if (!r.ok) {
        const m = errorMessage(r.error);
        setLoadError(`${m.title} ${m.body}`);
        return;
      }
      onOpen(ds, r.value);
    });
  };

  return (
    <Sheet
      className="dataset-sheet"
      labelledBy="dataset-sheet-title"
      onClose={onClose}
      closeOnBackdrop
    >
      <header className="dataset-sheet-head">
        <h2 id="dataset-sheet-title">Open dataset</h2>
        <button
          type="button"
          className="close"
          aria-label="Close the dataset sheet"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {indexError !== null && (
        <p role="alert" className="error">
          The dataset library could not be loaded — {indexError}
        </p>
      )}
      {indexError === null && list === null && (
        <p className="dataset-loading">Loading the dataset library…</p>
      )}
      {loadError !== null && (
        <p role="alert" className="error">
          {loadError}
        </p>
      )}
      {pending !== null ? (
        <div className="lab-confirm">
          <h3>Replace your unsaved work?</h3>
          <p>
            Opening “{pending.title}” replaces the imported data in the
            sandbox — your current alignment and tree will be lost.
          </p>
          <div className="lab-confirm-actions">
            <button type="button" onClick={() => pick(pending)}>
              Replace my work
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Keep my work
            </button>
          </div>
        </div>
      ) : (
        list !== null && (
          <ul className="dataset-list">
            {list.map((d) => {
              const p = provenance[d.id];
              return (
                <li className="dataset-row" key={d.id}>
                  <button
                    type="button"
                    className="dataset-open"
                    disabled={busy}
                    onClick={() => pick(d)}
                  >
                    <span className="dataset-title">{d.title}</span>
                    <span className="dataset-meta">
                      {d.taxa} taxa × {d.sites} sites ·{" "}
                      {d.alphabet === "dna" ? "DNA" : "protein"}
                    </span>
                    <span className="dataset-goodfor">{d.good_for}</span>
                    <span className="dataset-meta">
                      Source: {p?.source ?? "…"} · {d.license}
                    </span>
                  </button>
                  <a
                    className="dataset-prov"
                    href={`${import.meta.env.BASE_URL}library/${d.provenance}`}
                  >
                    provenance
                  </a>
                </li>
              );
            })}
          </ul>
        )
      )}
    </Sheet>
  );
}
