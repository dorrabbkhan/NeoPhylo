// The PHYLIP lab index, `?labs` (v1.4 plan Task 11, spec §6.5): every
// registry lab as a card — title, the PHYLIP chain it reproduces, its
// objectives and the settings it uses — linking to its `?lab=<id>`
// page. The registry is empty until Task 12 ships the packs, so the
// index shows a plain empty state rather than a broken page.
//
// `LabPickList` is the same list in the compact form the editor's
// "PHYLIP labs" sheet renders: title + chain + a "Load this lab"
// button per row, with the load left to the caller (the editor, which
// owns the unsaved-work question of Review Focus 5).
//
// Like the editor, this page is a lazy route (Root.tsx) — the registry
// and its ajv import never enter the initial bundle.

import type { LabSummary } from "../../labs/registry";
import { listLabs } from "../../labs/registry";
import { Wordmark } from "../Wordmark";

import "./labs.css";

export function LabIndex() {
  const labs = listLabs();
  return (
    <main className="lab-page lab-print">
      <header className="lab-page-head lab-nav">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
        <a className="lab-nav-link" href="?editor">
          Exercise editor
        </a>
      </header>
      <div className="lab-main">
        <h1>PHYLIP labs</h1>
        <p className="lab-intro">
          Guided labs that reproduce the classic PHYLIP chains —
          dnadist, protdist, seqboot, neighbor and consense — with the
          PHYLIP default for every option next to the NeoPhylo setting
          that matches it.
        </p>
        {labs.length === 0 ? (
          <p className="labs-empty">
            No lab packs yet — the PHYLIP lab packs land with the next
            release. Until then,{" "}
            <a href="?editor">build your own exercise</a> or start from
            the Lessons menu in the app.
          </p>
        ) : (
          <ol className="lab-list">
            {labs.map((lab) => (
              <li className="lab-card" key={lab.id}>
                <div className="lab-card-head">
                  <h2>{lab.title}</h2>
                  <p className="lab-chain">
                    {lab.chain.map((step, i) => (
                      <span key={i}>
                        {i > 0 && <span aria-hidden="true"> → </span>}
                        <code>{step}</code>
                      </span>
                    ))}
                  </p>
                </div>
                <ul className="lab-objectives">
                  {lab.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
                <table className="lab-settings">
                  <thead>
                    <tr>
                      <th scope="col">Option</th>
                      <th scope="col">NeoPhylo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lab.settings.map((s, i) => (
                      <tr key={i}>
                        <td>{s.option}</td>
                        <td>{s.neophylo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="lab-card-actions">
                  <a href={`?lab=${encodeURIComponent(lab.id)}`}>
                    Open lab
                  </a>
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}

/** Compact lab rows with a "Load this lab" button each — the editor's
 * lab sheet body. The caller owns what loading means there. */
export function LabPickList({
  labs,
  onLoadLab,
}: {
  labs: LabSummary[];
  onLoadLab: (lab: LabSummary) => void;
}) {
  if (labs.length === 0) {
    return (
      <p className="labs-empty">
        No lab packs yet — they land with the next release.
      </p>
    );
  }
  return (
    <ul className="lab-pick">
      {labs.map((lab) => (
        <li key={lab.id}>
          <span className="lab-pick-info">
            <strong>{lab.title}</strong>
            <span className="lab-pick-chain">
              {lab.chain.join(" → ")}
            </span>
          </span>
          <button type="button" onClick={() => onLoadLab(lab)}>
            Load this lab
          </button>
        </li>
      ))}
    </ul>
  );
}
