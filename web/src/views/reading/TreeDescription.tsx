// The screen-reader form of a reading tree (v1.4d plan Task 7, spec
// §7.3): a nested "Node P contains: …" list that mirrors the drawing.
// It is visually hidden but always in the accessibility tree; a "Show
// as text" toggle opens it for sighted readers who prefer the nested
// form. Every tip appears exactly once — internal nodes name their
// children through the nested list, never by re-listing their tips, so
// unlettered nodes read "An unnamed node contains:" instead of a tip
// dump.

import { useState } from "react";

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";

export interface TreeDescriptionProps {
  /** The (possibly locally rotated) view the drawing shows — the
   * description lists children in the same order they are drawn. */
  view: ReadingTreeView;
}

export function TreeDescription({ view }: TreeDescriptionProps) {
  const [open, setOpen] = useState(false);
  const { nodes, root } = view;

  const renderNode = (id: number): React.ReactNode => {
    const n = nodes[id];
    if (n.children.length === 0) {
      return (
        <li key={id} className="rt-desc-tip">
          {n.label}
        </li>
      );
    }
    return (
      <li key={id}>
        {n.letter !== null ? `Node ${n.letter}` : "An unnamed node"}{" "}
        contains:
        <ul>{n.children.map(renderNode)}</ul>
      </li>
    );
  };

  return (
    <div className="rt-desc-wrap">
      <button
        type="button"
        className="rt-desc-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide text" : "Show as text"}
      </button>
      <div className="rt-desc" data-open={open || undefined}>
        <ul>{renderNode(root)}</ul>
      </div>
    </div>
  );
}
