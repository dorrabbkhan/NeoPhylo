// Teaching panels for the non-error states of spec §6.3 (plan Task 19):
// saturation, negative branch lengths and the RF comparison result.
// Each notice is driven by Session and applies its suggested fix through
// the same actions the controls use, so the session reducer stays the
// single place that mutates the pipeline.

import { useMemo } from "react";
import type { Dispatch } from "react";

import { engine } from "../engine";
import { errorMessage } from "../explain/errors";
import type { Alignment } from "../engine/generated/Alignment";
import type { Tree } from "../engine/generated/Tree";
import type { Action, Session } from "../state/session";

import type { ChartPoint } from "./SaturationChart";
import { SaturationChart } from "./SaturationChart";

export interface TeachingNoticesProps {
  session: Session;
  dispatch: Dispatch<Action>;
}

/** UI cap on simulated alignment length (Global Constraints). */
const SIM_MAX = 10000;

/** Path length between two leaf ids in `tree`: the sum of branch lengths
 * on the path through the lowest common ancestor. */
function truePathLength(tree: Tree, a: number, b: number): number {
  const distFromA = new Map<number, number>();
  let d = 0;
  for (let id: number | null = a; id !== null; id = tree.nodes[id].parent) {
    distFromA.set(id, d);
    d += tree.branches[id].length ?? 0;
  }
  let acc = 0;
  for (let id: number | null = b; id !== null; id = tree.nodes[id].parent) {
    const via = distFromA.get(id);
    if (via !== undefined) return acc + via;
    acc += tree.branches[id].length ?? 0;
  }
  return 0;
}

/** (p, true distance) for every pair of the alignment. The p values come
 * from the engine's uncorrected "P" distances — no distance math is
 * reimplemented here. Pairs whose labels are absent from the true tree
 * (a mismatched import) are simply left out. */
function chartPoints(
  alignment: Alignment,
  trueTree: Tree | null,
): ChartPoint[] {
  if (trueTree === null) return [];
  const leaf = new Map<string, number>();
  trueTree.nodes.forEach((node, id) => {
    if (node.children.length === 0 && node.label !== null) {
      leaf.set(node.label, id);
    }
  });
  const pd = engine.distances(alignment, "P");
  if (!pd.ok) return [];
  const n = alignment.labels.length;
  const out: ChartPoint[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const cell = pd.value.cells[i * n + j];
      if (cell === "Saturated") continue;
      const a = leaf.get(alignment.labels[i]);
      const b = leaf.get(alignment.labels[j]);
      if (a === undefined || b === undefined) continue;
      out.push({ p: cell.Value, d: truePathLength(trueTree, a, b) });
    }
  }
  return out;
}

export function TeachingNotices({ session, dispatch }: TeachingNoticesProps) {
  const sat = session.error?.kind === "SaturatedMatrix" ? session.error : null;
  const hasNegative = (session.result?.tree.branches ?? []).some(
    (b) => (b.length ?? 0) < 0,
  );
  const wrongClades = session.rf?.missing_in_inferred.length ?? 0;

  // Chart points are only needed while the saturation panel is on
  // screen; the engine call is memoized on the pipeline inputs.
  const points = useMemo(
    () =>
      session.alignment !== null
        ? chartPoints(session.alignment, session.trueTree)
        : [],
    [session.alignment, session.trueTree],
  );

  if (sat === null && !hasNegative && wrongClades === 0) return null;

  const labels = session.matrix?.labels ?? session.alignment?.labels ?? [];
  const pairName = (i: number, j: number) =>
    `${labels[i] ?? String(i)}–${labels[j] ?? String(j)}`;

  return (
    <>
      {sat !== null && (
        <section className="notice" aria-label="Saturation">
          {/* The headline matches errorMessage(SaturatedMatrix).title so the
              same phrase appears wherever this state is explained. */}
          <h2>{errorMessage(sat).title}</h2>
          <p className="notice-pairs">
            cannot estimate:{" "}
            {sat.cells.map(([i, j]) => pairName(i, j)).join(", ")}
          </p>
          <p>
            Once the observed differences between two sequences reach 0.75, the
            JC69 correction has no finite answer — tree building is blocked. To
            keep going:
          </p>
          <SaturationChart points={points} />
          {session.alignmentOrigin === "imported" && (
            <p>Your own data can't be re-simulated.</p>
          )}
          <div className="notice-fixes">
            {session.alignmentOrigin === "simulated" && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "setSim",
                      patch: {
                        length: Math.min(
                          SIM_MAX,
                          session.exercise.sim.length * 2,
                        ),
                      },
                    })
                  }
                >
                  Use longer sequences (×2)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "setBranchScale",
                      scale: session.branchScale * 0.5,
                    })
                  }
                >
                  Use shorter branches (÷2)
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: "setAnalysis",
                  patch: { correction: "P" },
                })
              }
            >
              Switch to p-distance
            </button>
          </div>
        </section>
      )}
      {hasNegative && (
        <section className="notice" aria-label="Negative branches">
          <p>
            The inferred tree has a negative branch length — this happens when
            the distances are not perfectly tree-like. It is drawn dashed; the
            trace is never altered.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={session.clampNegative}
            className="matrix-toggle"
            onClick={() => dispatch({ type: "toggleClamp" })}
          >
            Set negative branches to zero
          </button>
        </section>
      )}
      {wrongClades > 0 && (
        <section className="notice" aria-label="Tree comparison">
          <p>
            {`Your tree differs from the true tree in ${wrongClades} clade${wrongClades === 1 ? "" : "s"} — outlined in the inferred tree.`}
          </p>
        </section>
      )}
    </>
  );
}
