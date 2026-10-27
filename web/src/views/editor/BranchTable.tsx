// Editor branch-length table (v1.4 plan Task 8, spec §5.1): the second
// view over the shared EditorModel — one labelled row per non-root
// edge, leaves named by their taxon and internal edges named by the
// clade below them.
//
// A row's field commits on blur or Enter through
// `model.apply({ kind: "setLength" })` — the engine refuses negative or
// non-finite lengths, and the refusal's message shows inline while the
// field keeps what the user typed. Non-numeric text is a lexical error
// caught before the op (the engine takes a number, not text). Escape
// reverts the field to the model's length; ArrowUp/ArrowDown move
// between rows, and Tab walks them natively.

import { useCallback, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";

import type { EditorModel } from "../../editor/model";
import type { NodeId } from "../../engine/generated/NodeId";
import type { Tree } from "../../engine/generated/Tree";
import { errorMessage } from "../../explain/errors";

export interface BranchTableProps {
  model: EditorModel;
  /** Set inside a sheet: the sheet's title shows the "Branch lengths"
   * heading once, and the table takes its name from it instead of a
   * second visible caption (fix round 1). */
  labelledBy?: string;
}

interface Row {
  id: NodeId;
  /** Leaf label, or "(a, b)" naming the clade below an internal edge. */
  name: string;
  length: number | null;
}

/** Leaf labels under `id`, in the tree's own child order. */
function leafNames(tree: Tree, id: NodeId, out: string[]): void {
  const node = tree.nodes[id];
  if (node === undefined) return;
  if (node.children.length === 0) {
    if (node.label !== null && node.label !== "") out.push(node.label);
    return;
  }
  for (const c of node.children) leafNames(tree, c, out);
}

/** One row per non-root node reachable from the root, in preorder. */
function rowsOf(tree: Tree): Row[] {
  const rows: Row[] = [];
  const visit = (id: NodeId): void => {
    const node = tree.nodes[id];
    if (node === undefined) return;
    for (const c of node.children) {
      const child = tree.nodes[c];
      if (child === undefined) continue;
      const name =
        child.children.length === 0
          ? (child.label ?? `#${c}`)
          : `(${leafList(tree, c)})`;
      rows.push({ id: c, name, length: tree.branches[c]?.length ?? null });
      visit(c);
    }
  };
  visit(tree.root);
  return rows;
}

function leafList(tree: Tree, id: NodeId): string {
  const names: string[] = [];
  leafNames(tree, id, names);
  return names.join(", ");
}

// Plain decimal or scientific notation only — `Number()` also accepts
// hex ("0x10"), binary ("0b1") and octal-style strings, which the field
// must refuse.
const LENGTH_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function BranchRow({
  model,
  row,
}: {
  model: EditorModel;
  row: Row;
}) {
  const [value, setValue] = useState(
    row.length === null ? "" : String(row.length),
  );
  const [error, setError] = useState<string | null>(null);

  // Resync when this edge's model length changes (a Newick edit, an
  // undo, a replace) — the render-phase adjustment pattern, so an
  // unrelated edit that leaves `row.length` alone leaves this field
  // alone too.
  const [shownLength, setShownLength] = useState(row.length);
  if (shownLength !== row.length) {
    setShownLength(row.length);
    setValue(row.length === null ? "" : String(row.length));
    setError(null);
  }

  const commit = () => {
    const t = value.trim();
    if (t === "") {
      setError("Enter a branch length.");
      return;
    }
    const v = LENGTH_TEXT.test(t) ? Number(t) : NaN;
    if (!Number.isFinite(v)) {
      setError(`"${t}" is not a number.`);
      return;
    }
    if (v === row.length) {
      setValue(String(v));
      setError(null);
      return;
    }
    const r = model.apply({ kind: "setLength", child: row.id, length: v });
    if (!r.ok) {
      setError(errorMessage(r.error).body);
      return;
    }
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const tr = e.currentTarget.closest("tr");
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue(row.length === null ? "" : String(row.length));
      setError(null);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      tr?.nextElementSibling?.querySelector("input")?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      tr?.previousElementSibling?.querySelector("input")?.focus();
    }
  };

  const label = `Length of the branch to ${row.name}`;
  return (
    <tr>
      <th scope="row">{row.name}</th>
      <td>
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={error !== null || undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {error !== null && (
          <p role="alert" className="editor-error">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

export function BranchTable({ model, labelledBy }: BranchTableProps) {
  const subscribe = useCallback(
    (fn: () => void) => model.subscribe(fn),
    [model],
  );
  const tree = useSyncExternalStore(subscribe, () => model.tree);
  const rows = rowsOf(tree);

  return (
    <div className="editor-view branch-table-view">
      <table className="branch-table" aria-labelledby={labelledBy}>
        {labelledBy === undefined ? <caption>Branch lengths</caption> : null}
        <thead>
          <tr>
            <th scope="col">Branch to</th>
            <th scope="col">Length</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <BranchRow key={row.id} model={model} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
