// The reading area (v1.4d plan Task 8, spec §4.4/§4.6/§7): one item
// at a time — question, tree(s), answer control, Check — with
// progress and Back/Next. `?read=<id>` loads a shipped set through
// the registry; `#r=` links carry a whole set in the fragment. Like
// the editor and lab pages this is a lazy route: the page, the
// reading state and the controls stay out of the initial bundle
// (spec §8.2 budget).
//
// Practice mode: Check asks the engine's `readingCheck` for the
// verdict — the first wrong verdict offers a retry without the
// explanation; a second Check or "Show answer" resolves the item and
// shows the explanation and note_after (the §7.4 deviation the owner
// approved, checkpoint §21(c)). Test mode shows none of that until
// Finish — the reducer's `checked` flag can only be set in practice
// mode, so nothing can leak. All answers are checked by the engine;
// the page computes nothing itself.

import { useEffect, useReducer, useState } from "react";

import { initEngine, type Result } from "../../engine/index";
import { readErrorMessage } from "../../reading/errors";
import { loadBuiltinReadingSet } from "../../reading/registry";
import { initSession, readingReducer } from "../../reading/state";
import { decodeReadingLink } from "../../reading/url";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import { Wordmark } from "../Wordmark";

import { ItemView } from "./ItemView";
import { TestSummary } from "./TestSummary";
// The shared subpage header (wordmark + back link) comes from
// labs.css — the same header labs, library, guide and worksheets use.
import "../labs/labs.css";
import "./reading.css";

type PageState =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "ready"; set: ReadingSet };

export function ReadingPage({
  id,
  hash,
}: {
  id: string | null;
  hash: string | null;
}) {
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void initEngine()
      .then(async (): Promise<Result<ReadingSet> | null> => {
        if (hash !== null && hash.includes("#r=")) {
          return decodeReadingLink(hash);
        }
        if (id !== null && id !== "") {
          return await loadBuiltinReadingSet(id);
        }
        return null;
      })
      .then((r) => {
        if (cancelled) return;
        if (r === null) {
          setState({
            status: "error",
            msg: "This page needs a reading set — open one from the library or a shared link.",
          });
        } else if (!r.ok) {
          setState({ status: "error", msg: readErrorMessage(r.error) });
        } else {
          setState({ status: "ready", set: r.value });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "error",
            msg: "The NeoPhylo engine could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, hash]);

  return (
    <main className="read-page">
      <header className="lab-page-head lab-nav">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
        {state.status === "ready" && (
          <p className="read-mode">{state.set.mode}</p>
        )}
      </header>
      {state.status === "loading" && (
        <p className="read-loading">Loading the set…</p>
      )}
      {state.status === "error" && (
        <>
          <h1>Reading set not available</h1>
          <p role="alert" className="error">
            {state.msg}
          </p>
        </>
      )}
      {state.status === "ready" && <SessionView set={state.set} />}
    </main>
  );
}

function SessionView({ set }: { set: ReadingSet }) {
  const [s, dispatch] = useReducer(readingReducer, set, initSession);
  if (s.finished) {
    return (
      <TestSummary
        set={set}
        responses={s.responses}
        onRestart={() => dispatch({ type: "restart" })}
      />
    );
  }
  return <ItemView set={set} s={s} dispatch={dispatch} />;
}
