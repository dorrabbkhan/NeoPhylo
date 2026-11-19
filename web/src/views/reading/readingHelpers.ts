// Small shared helpers for the reading tree (split out of
// readingDraw.tsx so that file exports only the draw component — the
// react-refresh lint rule). `anim`/`animD` give both the drawing
// layer and the hit layer the same 300 ms ease-in-out swap
// transition (none under prefers-reduced-motion); `pointOffsets`
// de-collides a lettered point from a node letter at the same spot.

import type { CSSProperties } from "react";

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import type { ReadingStyle } from "../../layout/readingLayout";
import { cladeKey } from "../../layout/readingGeom";

/** Node-letter and point-letter badge radius. */
export const LETTER_R = 9;

/** ≥40 px hit pad — a hair over, like TreeView's: WebKit quantizes
 * layout to 1/64 px, so an exact 40 renders back as 39.999 (§6.5). */
export const HIT_PAD = 40.05;
/** The always-on (fine pointer) target radius around a node/point. */
export const HIT_CORE = 9;
/** Radius of the focus ring drawn around a focused target. */
export const FOCUS_R = 11;

export const hitPad = (cx: number, cy: number) => ({
  x: cx - HIT_PAD / 2,
  y: cy - HIT_PAD / 2,
  width: HIT_PAD,
  height: HIT_PAD,
});

export type PickKind = "node" | "point" | "branch";
export type PickFn = (i: number, kind: PickKind, letter?: string) => void;

/** A node's spoken name: its letter when lettered, its label at a tip,
 * else "the node joining …" (the answer.rs convention). */
export function describe(
  clade: string[],
  letter: string | null,
  tip: string | null,
) {
  if (letter !== null) return `node ${letter}`;
  if (tip !== null) return `tip ${tip}`;
  return `the node joining ${clade.join(", ")}`;
}

export const pointOffsets = (
  view: ReadingTreeView,
  byKey: Map<string, number>,
  style: ReadingStyle,
): { x: number; y: number }[] =>
  view.points.map((p) => {
    // A point letter would stack on a node letter at the same spot —
    // shift it perpendicular off the tip axis with a leader line.
    const conflict =
      p.at === "node" &&
      view.nodes[byKey.get(cladeKey(p.on)) ?? -1]?.letter !== null;
    if (!conflict) return { x: 0, y: 0 };
    const d = 2 * LETTER_R + 4;
    return style.tips === "up" || style.tips === "down"
      ? { x: -d, y: 0 }
      : { x: 0, y: -d };
  });

export const anim = (x: number, y: number, reduced: boolean) => ({
  transform: `translate(${x}px, ${y}px)`,
  transition: reduced ? "none" : "transform 300ms ease-in-out",
});

export const animD = (d: string, reduced: boolean): CSSProperties =>
  ({
    d: `path("${d}")`,
    transition: reduced ? "none" : "d 300ms ease-in-out",
  }) as CSSProperties;
