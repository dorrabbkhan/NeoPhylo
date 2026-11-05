// The lab index, `?labs` (v1.4 plan Task 11, spec §6.5; v1.4b Task
// 12, spec §7.3): every registry lab as a card — title, the tool
// chain it reproduces, its objectives and the settings it uses —
// linking to its `?lab=<id>` page, grouped under "PHYLIP labs" and
// "MEGA labs" (the owner's "Labs" rename, 2026-11-02). The MEGA group
// is empty until the Task 13 handouts land, so it shows a short
// coming-soon line rather than a bare heading.
//
// `LabPickList` is the same list in the compact form the editor's
// "Labs" sheet renders: title + chain + a "Load this lab" button per
// row, with the load left to the caller (the editor, which owns the
// unsaved-work question of Review Focus 5).
//
// Like the editor, this page is a lazy route (Root.tsx) — the registry
// and its ajv import never enter the initial bundle.

import type { LabSummary } from "../../labs/registry";
import { listLabs } from "../../labs/registry";
import { Wordmark } from "../Wordmark";

import "./labs.css";

function LabCard({ lab }: { lab: LabSummary }) {
  return (
    <li className="lab-card">
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
        {lab.minutes !== undefined && (
          <p className="lab-minutes">About {lab.minutes} min</p>
        )}
      </div>
      <ul className="lab-objectives">
        {lab.objectives.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
      {/* issue #135: the same scroll-in-place region the lab page
          uses — the card shrinks to the column (min-width: 0 in
          labs.css) and a too-wide table scrolls inside it. The label
          names the lab so every region on the index stays unique. */}
      <div
        className="lab-settings-scroll"
        role="region"
        tabIndex={0}
        aria-label={`${lab.title} settings`}
      >
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
      </div>
      <p className="lab-card-actions">
        <a href={`?lab=${encodeURIComponent(lab.id)}`}>Open lab</a>
      </p>
    </li>
  );
}

function LabGroup({
  title,
  labs,
  empty,
}: {
  title: string;
  labs: LabSummary[];
  /** Shown under the heading when the group has no labs yet. */
  empty?: string;
}) {
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {labs.length === 0 ? (
        <p className="labs-empty">{empty}</p>
      ) : (
        <ol className="lab-list">
          {labs.map((lab) => (
            <LabCard key={lab.id} lab={lab} />
          ))}
        </ol>
      )}
    </section>
  );
}

export function LabIndex() {
  const labs = listLabs();
  const phylipLabs = labs.filter((l) => l.tool === "phylip");
  const megaLabs = labs.filter((l) => l.tool === "mega");
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
        <h1>Labs</h1>
        <p className="lab-intro">
          Guided labs that reproduce classic PHYLIP chains —
          dnadist, protdist, seqboot, neighbor and consense — and MEGA
          analyses, with the tool's default for every option next to
          the NeoPhylo setting that matches it.
        </p>
        {labs.length === 0 ? (
          <p className="labs-empty">
            No lab packs yet — the lab packs land with the next
            release. Until then,{" "}
            <a href="?editor">build your own exercise</a> or start from
            the Lessons menu in the app.
          </p>
        ) : (
          <>
            <LabGroup title="PHYLIP labs" labs={phylipLabs} />
            <LabGroup
              title="MEGA labs"
              labs={megaLabs}
              empty="MEGA handouts are coming."
            />
          </>
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
