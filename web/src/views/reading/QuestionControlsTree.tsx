// Tree-driven answer controls (v1.4d plan Task 8, spec §7.3): the
// pick-on-the-tree questions' visible pieces — the order_nodes
// builder (letter chips + an editable sequence, tap only, no drag)
// and the removable selection list every tap answer shows. These
// build `Response` values; correctness stays with `readingCheck`.

import { cladeKey } from "../../layout/readingGeom";
import { joinAnd } from "../../reading/state";
import type { Item } from "../../engine/generated/Item";
import type { Question } from "../../engine/generated/Question";
import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import type { Response } from "../../engine/generated/Response";

/** What one tree-driven control needs — the item's question, the
 *  resolved view (lettered nodes, trait names) and the live
 *  response. Structurally the same props QuestionControls hands down;
 *  declared here so this file never imports its caller. */
export interface TreeControlProps {
  question: Question;
  item: Item;
  view: ReadingTreeView;
  response: Response | null;
  onResponse: (r: Response | null) => void;
}

// --- order_nodes ---------------------------------------------------------------

/** The letter chips append to the sequence; the list edits with
 *  move up/down and remove buttons (tap-in-sequence, never drag —
 *  spec §7.3). Tapping a lettered node on the tree appends too — the
 *  page wires that through the same response. */
export function OrderBuilder({ question: q, view, response, onResponse }: TreeControlProps) {
  if (q.type !== "order_nodes") return null;
  const letters = response?.kind === "order" ? response.letters : [];
  const remaining = q.nodes.filter((l) => !letters.includes(l));
  const setLetters = (next: string[]) =>
    onResponse({ kind: "order", letters: next });
  const desc = (letter: string) => {
    const n = view.nodes.find((x) => x.letter === letter);
    return n === undefined
      ? `node ${letter}`
      : `node ${letter} — the node joining ${joinAnd(n.clade)}`;
  };
  return (
    <div className="read-order">
      <div className="read-order-chips">
        {remaining.map((l) => (
          <button
            key={l}
            type="button"
            className="read-chip"
            aria-label={`Add ${desc(l)}`}
            onClick={() => setLetters([...letters, l])}
          >
            {l}
          </button>
        ))}
      </div>
      <ol className="read-order-list">
        {letters.map((l, i) => (
          <li key={l} className="read-order-row">
            <span className="read-order-name">{desc(l)}</span>
            <button
              type="button"
              aria-label={`Move ${l} up`}
              disabled={i === 0}
              onClick={() => {
                const next = letters.slice();
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setLetters(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${l} down`}
              disabled={i === letters.length - 1}
              onClick={() => {
                const next = letters.slice();
                [next[i], next[i + 1]] = [next[i + 1], next[i]];
                setLetters(next);
              }}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove ${l}`}
              onClick={() => setLetters(letters.filter((x) => x !== l))}
            >
              ✕
            </button>
          </li>
        ))}
        {letters.length === 0 && (
          <li className="read-order-empty">
            Tap the lettered nodes (or the chips above) in order, oldest
            first.
          </li>
        )}
      </ol>
    </div>
  );
}

// --- selection list ------------------------------------------------------------

/** The visible list of what the student picked on the tree, with
 *  remove buttons (spec §7.3). Tips remove one at a time; a node or
 *  point selection clears back to unanswered. */
export function SelectionList({ view, response, onResponse }: TreeControlProps) {
  if (response === null) {
    return (
      <p className="read-sel-empty">
        Tap your answer on the tree — the selection appears here.
      </p>
    );
  }
  if (response.kind === "tips") {
    return (
      <ul className="read-sel-list">
        {response.tips.map((t) => (
          <li key={t}>
            <span>{t}</span>
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() =>
                onResponse({
                  kind: "tips",
                  tips: response.tips.filter((x) => x !== t),
                })
              }
            >
              ✕
            </button>
          </li>
        ))}
        {response.tips.length === 0 && (
          <li className="read-sel-empty">Nothing selected.</li>
        )}
      </ul>
    );
  }
  if (response.kind === "node") {
    if (response.clade.length === 0) return null;
    const node = view.nodes.find(
      (n) => cladeKey(n.clade) === cladeKey(response.clade),
    );
    const label =
      node?.letter !== null && node?.letter !== undefined
        ? `Node ${node.letter} — the node joining ${joinAnd(response.clade)}`
        : `The node joining ${joinAnd(response.clade)}`;
    return (
      <ul className="read-sel-list">
        <li>
          <span>{label}</span>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onResponse(null)}
          >
            ✕
          </button>
        </li>
      </ul>
    );
  }
  if (response.kind === "point" && response.letter !== "") {
    return (
      <ul className="read-sel-list">
        <li>
          <span>Point {response.letter}</span>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onResponse(null)}
          >
            ✕
          </button>
        </li>
      </ul>
    );
  }
  return null;
}