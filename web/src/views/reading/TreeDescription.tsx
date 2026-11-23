// The screen-reader form of a reading tree (v1.4d plan Task 7, spec
// §7.3): a nested "Node P contains: …" list that mirrors the drawing.
// It is visually hidden but always in the accessibility tree; a "Show
// as text" toggle opens it for sighted readers who prefer the nested
// form. Every tip appears exactly once — internal nodes name their
// children through the nested list, never by re-listing their tips, so
// unlettered nodes read "An unnamed node contains:" instead of a tip
// dump.
//
// Checkpoint §21(p) (owner NVDA pass, 2026-11-23): the toggle controls
// the region (`aria-controls`), opening moves focus into it so the
// text is read instead of skipped, and closing returns focus to the
// toggle. The region stays reachable to browse-mode arrows whether it
// is open or not. The svg's `aria-describedby` points at the LIST id,
// not the region — an accessible name on the referenced element would
// replace the list text in the description.

import { useEffect, useRef, useState } from "react";

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";

export interface TreeDescriptionProps {
  /** The (possibly locally rotated) view the drawing shows — the
   * description lists children in the same order they are drawn. */
  view: ReadingTreeView;
  /** The figure's caption ("Tree 1") — names the region
   *  "<label> as text". */
  label: string;
  /** The region's id — the toggle's `aria-controls` target. */
  regionId: string;
  /** The list's id — the svg's `aria-describedby` target. */
  textId: string;
}

export function TreeDescription({
  view,
  label,
  regionId,
  textId,
}: TreeDescriptionProps) {
  const [open, setOpen] = useState(false);
  const descRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const { nodes, root } = view;

  // Opening drops focus into the now-visible region so a screen
  // reader voices it; on close the toggle takes focus back — a
  // no-op when it already has it (keyboard users activate it in
  // place).
  useEffect(() => {
    if (open) descRef.current?.focus();
  }, [open]);

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
        ref={toggleRef}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          if (open) toggleRef.current?.focus();
          setOpen((o) => !o);
        }}
      >
        {open ? "Hide text" : "Show as text"}
      </button>
      <div
        className="rt-desc"
        id={regionId}
        ref={descRef}
        role="region"
        aria-label={`${label} as text`}
        tabIndex={-1}
        data-open={open || undefined}
      >
        <ul id={textId}>{renderNode(root)}</ul>
      </div>
    </div>
  );
}
