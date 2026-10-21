// Consensus tabs above the inferred tree (v1.2 plan Task 12, spec
// §6.4): "Your tree with support" | "Majority-rule" | "Extended
// majority" | "Strict". The strip is a real ARIA tablist — arrow keys
// and Home/End move through the ENABLED tabs and activate on focus
// (roving tabindex); the three consensus tabs stay disabled until a
// run is done. The active view lives in Session.bootstrap.view (URL v3
// carries it); App picks the tree to draw, this component owns the
// strip, the tabpanel wrapper and the "Dropped from this consensus"
// line. Tab metadata lives in ./consensusTabs.ts.

import { useRef } from "react";
import type { Dispatch, KeyboardEvent, ReactNode } from "react";

import type { Action, BootstrapView, Session } from "../state/session";

import {
  CONSENSUS_TABS,
  consensusKind,
  droppedLine,
} from "./consensusTabs";

export interface ConsensusTabsProps {
  session: Session;
  dispatch: Dispatch<Action>;
  /** The tree panel the tabs switch between — App renders the
   * TreeView; this wrapper adds the strip, the tabpanel semantics and
   * the dropped list. */
  children: ReactNode;
}

export function ConsensusTabs({
  session,
  dispatch,
  children,
}: ConsensusTabsProps) {
  const b = session.bootstrap;
  const done = b.status === "done";
  const enabled = CONSENSUS_TABS.filter((t) => t.kind === null || done);
  // A stored consensus view with no results behind it (a `ran: false`
  // link naming a tab, or results cleared by a data change — the view
  // survives `clearBootstrap`) can't draw: the support tab is the
  // selected one and the drawn tree falls back the same way in App.
  const active: BootstrapView = enabled.some((t) => t.view === b.view)
    ? b.view
    : "support";
  const activeKind = consensusKind(active);
  // Roving tabindex target: the selected tab, or the first enabled tab
  // when the stored view is one of the disabled consensus tabs.
  const roving: BootstrapView = enabled.some((t) => t.view === active)
    ? active
    : enabled[0].view;

  const tabRef = useRef<(HTMLButtonElement | null)[]>([]);

  // ARIA tabs keyboard pattern: arrows move to the next/previous
  // enabled tab (wrap-around), Home/End to the ends; focus follows and
  // the tab activates — the view changes and App redraws.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = enabled.map((t) => t.view);
    const cur = Math.max(0, ids.indexOf(roving));
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (cur + 1) % ids.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (cur - 1 + ids.length) % ids.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = ids.length - 1;
    }
    if (next < 0 || next === cur) return;
    e.preventDefault();
    const view = ids[next];
    dispatch({ type: "setBootstrapView", view });
    const i = CONSENSUS_TABS.findIndex((t) => t.view === view);
    tabRef.current[i]?.focus();
  };

  return (
    <div className="consensus-tabs">
      <div
        role="tablist"
        aria-label="Bootstrap tree views"
        onKeyDown={onKeyDown}
      >
        {CONSENSUS_TABS.map((t, i) => {
          const isEnabled = t.kind === null || done;
          const selected = t.view === active;
          return (
            <button
              key={t.view}
              ref={(el) => {
                tabRef.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`consensus-tab-${t.view}`}
              aria-selected={selected}
              aria-controls="consensus-tree-panel"
              disabled={!isEnabled}
              tabIndex={t.view === roving ? 0 : -1}
              onClick={() =>
                dispatch({ type: "setBootstrapView", view: t.view })
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id="consensus-tree-panel"
        aria-labelledby={`consensus-tab-${active}`}
        className="consensus-tabpanel"
      >
        {children}
        {activeKind !== null && done && b.dropped !== null && (
          <p className="consensus-dropped">
            {droppedLine(b.dropped[activeKind])}
          </p>
        )}
      </div>
    </div>
  );
}
