// The answer-key page, `?key=<id>&kind=paper|app` (v1.4c plan Task
// 11, spec §7.2). The whole page sits behind InstructorGate — nothing
// about the key is in the DOM until the visitor confirms (and storage
// says so for the rest of the session). Every number is formatted
// straight from the engine values the builders already pulled: the
// join's distance/Q matrices from the trace, row sums, the chosen and
// closest pairs, branch lengths, new distances, the common-mistake
// lines, the seeded bootstrap run and the finished tree.

import { useEffect, useState } from "react";

import { engine, initEngine } from "../../engine/index";
import { fmt } from "../../explain/math";
import type { JoinFacts } from "../../engine/generated/JoinFacts";
import { Wordmark } from "../Wordmark";
import { TreeView } from "../TreeView";
import {
  bootstrapKeyFacts,
  companionKey,
  companionSheet,
  exerciseDistanceInput,
  exerciseOf,
  paperKey,
  paperSheet,
  samePair,
  worksheetRun,
} from "../../worksheets/build";
import type {
  BootstrapKeyFacts,
  WorksheetRun,
} from "../../worksheets/build";
import type { CompanionKey, PaperKey } from "../../worksheets/types";
import { LabPrintStyles } from "../labs/LabPrintStyles";

import { InstructorGate } from "./InstructorGate";
import { PrintMatrix } from "./blocks";
import {
  exerciseLink,
  keyHref,
  loadWorksheetSource,
  worksheetHref,
} from "./load";
import type { WorksheetSource } from "./load";
import { joinContext, matrixLower } from "./steps";
import type { JoinContext } from "./steps";
import "../labs/labs.css";
import "./worksheets.css";

export interface KeyPageProps {
  id: string;
  kind: string;
}

type PageState =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "ready"; src: WorksheetSource };

export function KeyPage({ id, kind }: KeyPageProps) {
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
        <InstructorGate workHref={worksheetHref(id, kind)}>
          <KeyContent id={id} kind={kind} />
        </InstructorGate>
      </div>
    </main>
  );
}

function KeyContent({ id, kind }: KeyPageProps) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      // A thrown load — the wasm fetch or the lesson fetch aborted by
      // navigation, or a body read that fails mid-stream — lands in the
      // error state for a live page and is dropped for a dead one;
      // it must never escape as an unhandled rejection.
      try {
        await initEngine();
        const r = await loadWorksheetSource(id);
        if (!live) return;
        if (r.ok) setState({ status: "ready", src: r.src });
        else setState({ status: "error", msg: r.msg });
      } catch (e) {
        if (!live) return;
        setState({
          status: "error",
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  if (state.status === "loading") {
    return <p className="lab-loading">Computing the answer key…</p>;
  }
  if (state.status === "error") {
    return (
      <>
        <h1>Answer key not available</h1>
        <p role="alert" className="error">
          This key could not be loaded — {state.msg}
        </p>
      </>
    );
  }
  const { src } = state;
  const model = src.kind === "lab" ? src.lab : src.exercise;
  if (kind === "app") return <CompanionKeyContent src={src} model={model} id={id} />;
  if (kind !== "paper") {
    return (
      <>
        <h1>Unknown key kind</h1>
        <p role="alert" className="error">
          <code>kind</code> must be <code>paper</code> or <code>app</code>.
        </p>
      </>
    );
  }
  const sheet = paperSheet(model, exerciseLink(src, id));
  if (sheet === null) {
    const input = exerciseDistanceInput(exerciseOf(model));
    const tooMany = input !== null && input.names.length > 8;
    return (
      <>
        <h1>{exerciseOf(model).title} — answer key</h1>
        <p>
          {tooMany
            ? "This exercise has too many taxa for a paper worksheet — it has an in-app worksheet and key instead."
            : "This exercise's distances can't be printed on a worksheet — it has an in-app worksheet and key instead."}
        </p>
        <p>
          <a href={keyHref(id, "app")}>Open the in-app answer key</a>
        </p>
      </>
    );
  }
  const dm = engine.matrixToDistances(sheet.matrix);
  if (!dm.ok) return <KeyError msg="the matrix could not be read" />;
  const run = worksheetRun(dm.value, sheet.method);
  if (!run.ok) return <KeyError msg="the exercise could not be run" />;
  return (
    <PaperKeyView
      keyModel={paperKey(sheet, run.value.joins, run.value.build.tree)}
      run={run.value}
    />
  );
}

function KeyError({ msg }: { msg: string }) {
  return (
    <>
      <h1>Answer key not available</h1>
      <p role="alert" className="error">
        This key could not be built — {msg}.
      </p>
    </>
  );
}

function CompanionKeyContent({
  src,
  model,
  id,
}: {
  src: WorksheetSource;
  model: Parameters<typeof companionSheet>[0];
  id: string;
}) {
  const sheet = companionSheet(model);
  // The engine values the key needs — predict_pair joins and, for
  // bootstrap content, the seeded replicate tally — computed after
  // the first paint so the loading state shows while a seeded run
  // works (Task 11 notes: no freeze). `null` when the exercise has no
  // printable matrix or no bootstrap content.
  const [ctx, setCtx] = useState<{
    joins: JoinFacts[] | null;
    bootstrap: BootstrapKeyFacts | null;
    msg: string | null;
  } | null>(null);
  useEffect(() => {
    // Deferred so the loading state paints before a seeded run works.
    const timer = window.setTimeout(() => {
      const ex = src.kind === "lab" ? src.lab.exercise : src.exercise;
      const input = exerciseDistanceInput(ex);
      const dm = input === null ? null : engine.matrixToDistances(input);
      const run =
        dm !== null && dm.ok
          ? worksheetRun(dm.value, ex.analysis.method)
          : null;
      const boot = bootstrapKeyFacts(ex);
      setCtx({
        joins: run !== null && run.ok ? run.value.joins : null,
        bootstrap: boot.ok ? boot.value : null,
        msg:
          (dm !== null && !dm.ok) || (run !== null && !run.ok) || !boot.ok
            ? "some engine values could not be computed — those items show no answer"
            : null,
      });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [src]);
  if (ctx === null) {
    return (
      <p className="lab-loading">
        Computing the seeded run — this takes a moment…
      </p>
    );
  }
  const key = companionKey(sheet, model, {
    joins: ctx.joins,
    bootstrap: ctx.bootstrap,
  });
  return <CompanionKeyView keyModel={key} id={id} warn={ctx.msg} />;
}

/** The in-app companion key: each item's question, then the answer —
 * engine pairs for predict_pair, the seeded run for bootstrap items,
 * "writing prompt" for notes and chain steps with no checkable
 * number. */
function CompanionKeyView({
  keyModel,
  id,
  warn,
}: {
  keyModel: CompanionKey;
  id: string;
  warn: string | null;
}) {
  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">NeoPhylo — answer key</p>
        <h1>{keyModel.sheet.title} — answer key</h1>
        <p className="ws-meta">
          Answers for the in-app worksheet (
          <a href={worksheetHref(id, "app")}>student sheet</a>).
        </p>
      </header>
      {warn !== null && (
        <p role="alert" className="error">
          {warn}
        </p>
      )}
      <ol className="ws-items ws-key-items">
        {keyModel.sheet.items.map((item, i) => (
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
            <p className="ws-answer">
              {keyModel.answers[i] ?? "Writing prompt — no fixed answer."}
            </p>
          </li>
        ))}
      </ol>
      {keyModel.caption !== null && (
        <p className="ws-caption">{keyModel.caption}</p>
      )}
      <footer className="lab-print-foot">
        Printed from NeoPhylo — answer key for {keyModel.sheet.title}.
      </footer>
    </>
  );
}

/** The paper key: the filled matrix, each hand-worked join answered
 * in full, the joins NeoPhylo finishes (when hand_steps < joins), the
 * common mistakes and the finished tree. */
export function PaperKeyView({
  keyModel,
  run,
}: {
  keyModel: PaperKey;
  run: WorksheetRun;
}) {
  const { sheet, joins, mistakes, tree } = keyModel;
  const isNj = sheet.method === "Nj";
  const worked = joins.slice(0, sheet.handSteps);
  const rest = joins.slice(sheet.handSteps);
  return (
    <>
      <header className="lab-mast">
        <p className="lab-print-head">NeoPhylo — answer key</p>
        <h1>{sheet.title} — answer key</h1>
        <p className="ws-meta">
          {isNj ? "Neighbor-Joining" : "UPGMA"}
          {sheet.minutes !== null && ` · about ${sheet.minutes} minutes`}
        </p>
      </header>
      <section aria-labelledby="wk-matrix-h">
        <h2 id="wk-matrix-h">1. The distance matrix</h2>
        <PrintMatrix
          names={sheet.matrix.names}
          values={sheet.matrix.lower}
          label={`${sheet.title} distance matrix`}
        />
      </section>
      {worked.map((j, i) => (
        <JoinKeyBlock
          key={j.step}
          num={i + 2}
          join={j}
          ctx={joinContext(run, j.step)}
          isNj={isNj}
        />
      ))}
      {rest.length > 0 && (
        <section aria-labelledby="wk-rest-h">
          <h2 id="wk-rest-h">{worked.length + 2}. NeoPhylo finishes</h2>
          <ol className="ws-rest" start={worked.length + 1}>
            {rest.map((j) => (
              <RestLine key={j.step} join={j} ctx={joinContext(run, j.step)} />
            ))}
          </ol>
        </section>
      )}
      <section aria-labelledby="wk-mistakes-h">
        <h2 id="wk-mistakes-h">
          {(rest.length > 0 ? worked.length + 3 : worked.length + 2)}. Common
          mistakes
        </h2>
        {mistakes.length === 0 ? (
          <p>None — every join picks the closest pair.</p>
        ) : (
          <ul className="ws-mistakes">
            {mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="wk-tree-h">
        <h2 id="wk-tree-h">
          {(rest.length > 0 ? worked.length + 4 : worked.length + 3)}. The
          finished tree
        </h2>
        <TreeView
          tree={tree}
          layoutKind="phylogram"
          highlight={new Set()}
          wrong={new Set()}
          clampNegative={false}
          title={`${sheet.title} — finished tree`}
        />
      </section>
      <footer className="lab-print-foot">
        Printed from NeoPhylo — answer key for {sheet.title}.
      </footer>
    </>
  );
}

function pairText(pair: [string, string]): string {
  return `${pair[0]}–${pair[1]}`;
}

/** The "Closest pair: …" verdict (fix round 1, R2): a closest pair
 * that is itself one of the join's `tied` pairs is a correct answer,
 * so the line says so; only a closest pair outside the tie earns
 * "the join is not the closest pair". Order-insensitive comparison. */
function closestVerdict(join: JoinFacts): string {
  if (join.chosen_is_closest) return "the join is the closest pair.";
  const tiedClosest = join.closest.filter((c) =>
    join.tied.some((t) => samePair(t, c)),
  );
  if (tiedClosest.length === join.closest.length) {
    return "tied with the join, also correct.";
  }
  const parts: string[] = [];
  if (tiedClosest.length > 0) {
    parts.push(
      `${tiedClosest.map(pairText).join(" and ")} tied with the join, also correct`,
    );
  }
  parts.push("the join is not the closest pair");
  return parts.join("; ") + ".";
}

/** One join, answered: the step's distance matrix (and Q table for
 * NJ), row sums or cluster sizes, the joined pair with every tie, the
 * closest-pair verdict, the branch lengths and the new distances —
 * all engine values. */
function JoinKeyBlock({
  num,
  join,
  ctx,
  isNj,
}: {
  num: number;
  join: JoinFacts;
  ctx: JoinContext;
  isNj: boolean;
}) {
  const tied = join.tied.filter(
    (t) => t[0] !== join.chosen[0] || t[1] !== join.chosen[1],
  );
  return (
    <section className="ws-join" aria-labelledby={`wk-join-${join.step}`}>
      <h2 id={`wk-join-${join.step}`}>
        {num}. Join {join.step}
      </h2>
      <p className="ws-clusters">
        Clusters in play: {ctx.active.join(", ")}
      </p>
      {ctx.distance !== null && (
        <PrintMatrix
          names={ctx.active}
          values={matrixLower(ctx.distance)}
          label={`distance matrix before join ${join.step}`}
          caption={isNj ? "Distances" : "Cluster averages"}
        />
      )}
      {join.row_sums !== null && !join.final_join && (
        <p className="ws-sums">
          Row sums:{" "}
          {ctx.active.map((n, i) => (
            <span key={n}>
              R({n}) = {fmt(join.row_sums?.[i] ?? 0)}
              {i < ctx.active.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
      {ctx.q !== null && (
        <PrintMatrix
          names={ctx.active}
          values={matrixLower(ctx.q)}
          label={`Q table for join ${join.step}`}
          caption="Q values"
        />
      )}
      {ctx.sizes !== null && (
        <p className="ws-sums">
          Cluster sizes:{" "}
          {ctx.active.map((n, i) => (
            <span key={n}>
              {n} = {ctx.sizes?.[i]}
              {i < ctx.active.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
      {join.final_join ? (
        <p>
          The last three clusters meet at {ctx.newName}:{" "}
          {ctx.active.map((n, i) => (
            <span key={n}>
              len({n}) = {fmt(ctx.finalLens?.[i] ?? 0)}
              {i < ctx.active.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      ) : (
        <>
          <p>
            <strong>Joins: {pairText(join.chosen)}</strong>
            {join.tied.length > 1 && (
              <>
                {" "}
                — tied with {tied.map(pairText).join(" and ")}
                {join.tie_same_split
                  ? "; either pair gives the same tree"
                  : ""}
                .
              </>
            )}
          </p>
          <p>
            Closest pair: {join.closest.map(pairText).join(" or ")} —{" "}
            {closestVerdict(join)}
          </p>
          <p>
            Branch lengths to {ctx.newName}: len({join.chosen[0]}) ={" "}
            {fmt(join.len_i)}, len({join.chosen[1]}) = {fmt(join.len_j)}
            {ctx.height !== null && <>; height = {fmt(ctx.height)}</>}.
          </p>
          <p>
            New distances:{" "}
            {join.new_distances
              .map(([n, v]) => `d(${ctx.newName}, ${n}) = ${fmt(v)}`)
              .join(", ")}
          </p>
        </>
      )}
    </section>
  );
}

/** The compact line for a join past the hand-worked steps. */
function RestLine({
  join,
  ctx,
}: {
  join: JoinFacts;
  ctx: JoinContext;
}) {
  if (join.final_join) {
    return (
      <li>
        join {join.step}: the last three clusters meet at {ctx.newName} —{" "}
        {ctx.active.map((n, i) => `len(${n}) = ${fmt(ctx.finalLens?.[i] ?? 0)}`).join(", ")}
        .
      </li>
    );
  }
  return (
    <li>
      join {join.step}: {pairText(join.chosen)}
      {join.tied.length > 1 && ` (tied with ${join.tied.slice(1).map(pairText).join(", ")})`}{" "}
      — len({join.chosen[0]}) = {fmt(join.len_i)}, len({join.chosen[1]}) ={" "}
      {fmt(join.len_j)}; new distances:{" "}
      {join.new_distances.map(([n, v]) => `d(${ctx.newName}, ${n}) = ${fmt(v)}`).join(", ")}
      .
    </li>
  );
}
