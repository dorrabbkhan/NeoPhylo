// The two matrix-session texts App renders (v1.4c spec §6.2; Task 8
// fix round 1, initial-JS budget): a lazy chunk so the alignment-only
// replacement line and the empty-tree reason leave the entry bundle —
// they can only render while a matrix session runs, when the grid's
// chunk is already on the wire.

import "./matrix.css";

/** The single replacement line for every alignment-only view a
 * matrix session suppresses (spec §6.2 — verbatim). */
export function MatrixNote() {
  return (
    <p className="matrix-note">
      This tree was built from a distance matrix, so there are no
      sequences to compare or resample.
    </p>
  );
}

/** What the tree area shows while the grid is incomplete — a matrix
 * session's reason instead of a stale tree (Review Focus 3). */
export function MatrixEmpty() {
  return (
    <p className="matrix-empty">
      Complete the distance matrix to build the tree.
    </p>
  );
}
