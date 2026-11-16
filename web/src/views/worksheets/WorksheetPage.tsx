// The worksheet page, `?worksheet=<id>&kind=paper|app` (v1.4c plan
// Task 11, spec §7.2). kind=paper prints the pencil-and-paper sheet —
// the matrix, one ruled block per hand-worked join, then "finish the
// tree and sketch it" with the exercise link and its QR code. kind=app
// is the in-app companion sheet — one item per prompt (and per lab
// chain entry). The student sheet never carries an answer: every
// blank is a ruled space, and nothing about the joins is in the DOM.
//
// Like the lab page this is a lazy route — the registry, the builders
// and the QR encoder stay out of the initial bundle.

import { useEffect, useState } from "react";

import { engine, initEngine } from "../../engine/index";
import { Wordmark } from "../Wordmark";
import {
  companionSheet,
  exerciseOf,
  paperSheet,
  worksheetRun,
} from "../../worksheets/build";
import type { WorksheetRun } from "../../worksheets/build";
import type { CompanionSheet, PaperSheet } from "../../worksheets/types";
import type { JoinFacts } from "../../engine/generated/JoinFacts";
import { LabPrintStyles } from "../labs/LabPrintStyles";

import { Blank, LinkBlock, PrintMatrix, RuledLines, SketchBox } from "./blocks";
import {
  exerciseLink,
  loadWorksheetSource,
  worksheetHref,
} from "./load";
import type { WorksheetSource } from "./load";
import { joinContext } from "./steps";
import type { JoinContext } from "./steps";
import "../labs/labs.css";
import "./worksheets.css";

export interface WorksheetPageProps {
  /** Lesson id, lab id, or "custom" (exercise in the `#x=` fragment). */
  id: string;
  /** "paper" for the print sheet, "app" for the in-app companion. */
  kind: string;
}

type PageState =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "ready"; src: WorksheetSource };

export function WorksheetPage({ id, kind }: WorksheetPageProps) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      await initEngine();
      const r = await loadWorksheetSource(id);
      if (!live) return;
      if (r.ok) setState({ status: "ready", src: r.src });
      else setState({ status: "error", msg: r.msg });
    })();
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <main className="lab-page lab-print ws-page">
      <LabPrintStyles />
      <header className="lab-page-head lab-nav">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
        <button
          type="button"
          className="lab-nav-link"
          onClick={() => window.print()}
        >
          Print
        </button>
      </header>
      <div className="lab-main">
        {state.status === "loading" && (
          <p className="lab-loading">Loading the worksheet…</p>
        )}
        {state.status === "error" && (
          <>
            <h1>Worksheet not available</h1>
            <p role="alert" className="error">
              This worksheet could not be loaded — {state.msg}
            </p>
          </>
        )}
        {state.status === "ready" && (
          <WorksheetContent src={state.src} id={id} kind={kind} />
        )}
      </div>
    </main>
  );
}

function WorksheetContent({
  src,
  id,
  kind,
}: {
  src: WorksheetSource;
  id: string;
  kind: string;
}) {
  const model = src.kind === "lab" ? src.lab : src.exercise;
  if (kind === "app") {
    return <CompanionSheetView sheet={companionSheet(model)} />;
  }
  if (kind !== "paper") {
    return (
      <>
        <h1>Unknown worksheet kind</h1>
        <p role="alert" className="error">
          <code>kind</code> must be <code>paper</code> or <code>app</code>.
        </p>
      </>
    );
  }
  const sheet = paperSheet(model, exerciseLink(src, id));
  if (sheet === null) {
    return (
      <>
        <h1>{exerciseOf(model).title}</h1>
        <p>
          This exercise has too many taxa for a paper worksheet — it has
          an in-app worksheet instead.
        </p>
        <p>
          <a href={worksheetHref(id, "app")}>Open the in-app worksheet</a>
        </p>
      </>
    );
  }
  const dm = engine.matrixToDistances(sheet.matrix);
  if (!dm.ok) {
    return <RunError msg="the matrix could not be read" />;
  }
  const run = worksheetRun(dm.value, sheet.method);
  if (!run.ok) {
    return <RunError msg="the exercise could not be run" />;
  }
  return <PaperSheetView sheet={sheet} run={run.value} />;
}

function RunError({ msg }: { msg: string }) {
  return (
    <>
      <h1>Worksheet not available</h1>
      <p role="alert" className="error">
        This worksheet could not be built — {msg}.
      </p>
    </>
  );
}

/** The in-app companion sheet: one numbered item per prompt (and per
 * lab chain entry), each with ruled writing space. */
export function CompanionSheetView({ sheet }: { sheet: CompanionSheet }) {
  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">NeoPhylo — worksheet</p>
        <h1>{sheet.title}</h1>
        <p className="ws-meta">
          In-app worksheet — fill this in while you work the exercise in
          NeoPhylo.
        </p>
      </header>
      <ol className="ws-items">
        {sheet.items.map((item, i) => (
          <li key={i} className="ws-item">
            <p className="ws-question">
              {item.step === "lab" && (
                <span className="ws-item-tag">Lab step — </span>
              )}
              {item.step === "bootstrap" && (
                <span className="ws-item-tag">Bootstrap — </span>
              )}
              {item.question}
            </p>
            <RuledLines count={2} />
          </li>
        ))}
      </ol>
      <footer className="lab-print-foot">
        Printed from NeoPhylo — worksheet for {sheet.title}.
      </footer>
    </>
  );
}

/** The paper worksheet: matrix, one block per hand-worked join, then
 * the finish-and-sketch block with the exercise link and QR. */
export function PaperSheetView({
  sheet,
  run,
}: {
  sheet: PaperSheet;
  run: WorksheetRun;
}) {
  const isNj = sheet.method === "Nj";
  const joins = run.joins.slice(0, sheet.handSteps);
  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">NeoPhylo — worksheet</p>
        <h1>{sheet.title}</h1>
        <p className="ws-meta">
          {isNj ? "Neighbor-Joining" : "UPGMA"}
          {sheet.minutes !== null && ` · about ${sheet.minutes} minutes`}
        </p>
      </header>
      <section aria-labelledby="ws-matrix-h">
        <h2 id="ws-matrix-h">1. The distance matrix</h2>
        <PrintMatrix
          names={sheet.matrix.names}
          values={sheet.matrix.lower}
          label={`${sheet.title} distance matrix`}
        />
      </section>
      {joins.map((j, i) => (
        <JoinBlankBlock
          key={j.step}
          num={i + 2}
          join={j}
          ctx={joinContext(run, j.step)}
          isNj={isNj}
          first={i === 0}
        />
      ))}
      <section aria-labelledby="ws-finish-h">
        <h2 id="ws-finish-h">{joins.length + 2}. Finish the tree</h2>
        <p>
          Finish the tree in NeoPhylo — open the exercise and let it run
          the rest of the joins. Scan the code or follow the link:
        </p>
        <LinkBlock link={sheet.link} />
        <p>Sketch the tree it builds:</p>
        <SketchBox />
      </section>
      <footer className="lab-print-foot">
        Printed from NeoPhylo — worksheet for {sheet.title}.
      </footer>
    </>
  );
}

/** One hand-worked join block: the clusters in play, the working
 * grids the method needs (NJ: row sums + a blank Q table; UPGMA: the
 * cluster-average matrix), then ruled blanks for the join, the
 * closest-pair question, the branch lengths and the new distances. */
function JoinBlankBlock({
  num,
  join,
  ctx,
  isNj,
  first,
}: {
  num: number;
  join: JoinFacts;
  ctx: JoinContext;
  isNj: boolean;
  first: boolean;
}) {
  return (
    <section className="ws-join" aria-labelledby={`ws-join-${join.step}`}>
      <h2 id={`ws-join-${join.step}`}>
        {num}. Join {join.step}
      </h2>
      <p className="ws-clusters">
        Clusters in play: {ctx.active.join(", ")}
      </p>
      {!first &&
        (isNj ? (
          <PrintMatrix
            names={ctx.active}
            values={null}
            label={`blank distance matrix before join ${join.step}`}
          />
        ) : (
          <PrintMatrix
            names={ctx.active}
            values={null}
            label={`blank cluster-average matrix before join ${join.step}`}
          />
        ))}
      {isNj && !join.final_join && (
        <>
          <p className="ws-sums">
            Row sums:{" "}
            {ctx.active.map((n) => (
              <Blank key={n} label={`R(${n}) =`} />
            ))}
          </p>
          <PrintMatrix
            names={ctx.active}
            values={null}
            label={`blank Q table for join ${join.step}`}
          />
        </>
      )}
      {!isNj && first && !join.final_join && (
        <p>
          No row sums or Q values here — UPGMA always joins the pair
          whose cluster-average distance is smallest.
        </p>
      )}
      {join.final_join ? (
        <>
          <p>
            The last three clusters meet at {ctx.newName}. Work out all
            three branch lengths from the final matrix:
          </p>
          <p className="ws-fill-line">
            <Blank label={`len(${ctx.active[0] ?? ""}) =`} />
            <Blank label={`len(${ctx.active[1] ?? ""}) =`} />
            <Blank label={`len(${ctx.active[2] ?? ""}) =`} />
          </p>
        </>
      ) : (
        <>
          <p className="ws-fill-line">
            <Blank label="The pair NeoPhylo joins:" wide />
            <Blank label="Is it the closest pair?" wide />
          </p>
          <p className="ws-fill-line">
            <Blank label={`Branch length to ${ctx.newName}:`} wide />
            <Blank label="and" wide />
          </p>
          <p className="ws-fill-line">
            New distances:{" "}
            {join.new_distances.map((_, i) => (
              // The remaining cluster names would reveal the pair —
              // the blanks stay unlabeled so the student names them.
              <Blank key={i} label={`d(${ctx.newName}, __) =`} />
            ))}
          </p>
        </>
      )}
    </section>
  );
}
