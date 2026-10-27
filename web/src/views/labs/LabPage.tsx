// One lab's page, `?lab=<id>` (v1.4 plan Task 11, spec §6.2): the lab
// title, the PHYLIP chain it reproduces, its objectives, the settings
// table (PHYLIP default vs the matching NeoPhylo setting), the
// handout, and the "what PHYLIP's outfile showed you vs NeoPhylo
// shows you" note. "Load this lab" opens the exercise in the app as
// the standard `#x=` payload — the same link shape the editor's Share
// writes, so the dataset and the model, seed and replicate settings
// arrive exactly as the pack ships them. The exercise-file link lets
// an instructor copy or adapt the pack in the editor, and the Print
// button prints the handout in light colors (LabPrintStyles +
// labs.css's @media print block, which hides .lab-controls/.lab-nav
// and shows .lab-print-head).
//
// handout_md and phylip_note_md render through the tiny markdown
// subset below — headings, lists, paragraphs, `code` and **bold** as
// React elements. Raw HTML is never injected, so pack markdown cannot
// carry markup into the page.
//
// Like the editor this is a lazy route — the registry and its ajv
// import stay out of the initial bundle.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { initEngine } from "../../engine/index";
import { loadLab } from "../../labs/registry";
import type { LabExercise } from "../../labs/registry";
import { encode } from "../../state/url";
import { Wordmark } from "../Wordmark";

import { LabPrintStyles } from "./LabPrintStyles";
import "./labs.css";

/** Inline markdown: **bold** and `code` spans only. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(
      t.startsWith("**") ? (
        <strong key={key++}>{t.slice(2, -2)}</strong>
      ) : (
        <code key={key++}>{t.slice(1, -1)}</code>
      ),
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MdBlock({ block }: { block: string }) {
  const heading = /^#{1,6}\s/.exec(block);
  if (heading !== null) {
    const text = block.replace(/^#+\s*/, "");
    const level = heading[0].trim().length;
    return level <= 2 ? <h3>{inline(text)}</h3> : <h4>{inline(text)}</h4>;
  }
  const lines = block.split("\n").map((l) => l.trim());
  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    return (
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^[-*]\s+/, ""))}</li>
        ))}
      </ul>
    );
  }
  if (lines.every((l) => /^\d+\.\s+/.test(l))) {
    return (
      <ol>
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\d+\.\s+/, ""))}</li>
        ))}
      </ol>
    );
  }
  return (
    <p>
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {inline(l)}
        </span>
      ))}
    </p>
  );
}

/** The markdown subset the lab fields use: blank-line-separated
 * blocks of headings, unordered/ordered lists and paragraphs. */
function Md({ source }: { source: string }) {
  const blocks = source
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
  return (
    <div className="lab-md">
      {blocks.map((b, i) => (
        <MdBlock key={i} block={b} />
      ))}
    </div>
  );
}

type LabState =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "ready"; lab: LabExercise };

export function LabPage({ id }: { id: string }) {
  const [state, setState] = useState<LabState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    initEngine()
      .then(() => {
        if (cancelled) return;
        const r = loadLab(id);
        if (r.ok) {
          setState({ status: "ready", lab: r.value });
        } else {
          const e = r.error;
          const msg =
            e.kind === "InvalidExercise"
              ? `${e.field}: ${e.msg}`
              : e.kind;
          setState({ status: "error", msg });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            msg: `the NeoPhylo engine could not be loaded. ${String(e)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="lab-page lab-print">
      <LabPrintStyles />
      <header className="lab-page-head lab-nav">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
        <a className="lab-nav-link" href="?labs">
          PHYLIP labs
        </a>
      </header>
      <div className="lab-main">
        {state.status === "loading" && (
          <p className="lab-loading">Loading the lab…</p>
        )}
        {state.status === "error" && (
          <>
            <h1>Lab not available</h1>
            <p role="alert" className="error">
              This lab could not be loaded — {state.msg}
            </p>
          </>
        )}
        {state.status === "ready" && <LabContent lab={state.lab} />}
      </div>
    </main>
  );
}

function LabContent({ lab }: { lab: LabExercise }) {
  const { lab: block } = lab;
  // "Load this lab" is the app's `#x=` link form: the whole exercise —
  // dataset, model, seed and bootstrap settings — travels in the
  // fragment (spec §6.2).
  const appHref = `${import.meta.env.BASE_URL}${encode({ v: 3, x: lab.exercise, step: 0, mode: "concept" })}`;
  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">
          NeoPhylo — PHYLIP lab handout
        </p>
        <h1>{block.title}</h1>
        <p className="lab-chain">
          {block.chain.map((step, i) => (
            <span key={i}>
              {i > 0 && <span aria-hidden="true"> → </span>}
              <code>{step}</code>
            </span>
          ))}
        </p>
      </header>
      <div className="lab-controls">
        <a className="lab-load" href={appHref}>
          Load this lab
        </a>
        {lab.shipped && (
          <a
            className="lab-file"
            href={`${import.meta.env.BASE_URL}exercises/labs/${encodeURIComponent(lab.fileName)}`}
          >
            Exercise file
          </a>
        )}
        <button type="button" onClick={() => window.print()}>
          Print handout
        </button>
      </div>
      <section aria-labelledby="lab-objectives-title">
        <h2 id="lab-objectives-title">Objectives</h2>
        <ul className="lab-objectives">
          {block.objectives.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="lab-settings-title">
        <h2 id="lab-settings-title">
          Settings — PHYLIP default vs NeoPhylo
        </h2>
        <table
          className="lab-settings"
          aria-label="PHYLIP defaults and the matching NeoPhylo settings"
        >
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">PHYLIP default</th>
              <th scope="col">NeoPhylo</th>
            </tr>
          </thead>
          <tbody>
            {block.settings.map((s, i) => (
              <tr key={i}>
                <td>{s.option}</td>
                <td>{s.phylip_default}</td>
                <td>{s.neophylo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="lab-handout-title">
        <h2 id="lab-handout-title">Handout</h2>
        <Md source={block.handout_md} />
      </section>
      <section aria-labelledby="lab-note-title">
        <h2 id="lab-note-title">
          What PHYLIP's outfile showed you vs NeoPhylo
        </h2>
        <Md source={block.phylip_note_md} />
      </section>
      <footer className="lab-print-foot">
        Printed from NeoPhylo — {block.chain.join(" → ")} lab (
        {lab.fileName}).
      </footer>
    </>
  );
}
