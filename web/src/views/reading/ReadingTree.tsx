// The reading-area tree component (v1.4d plan Task 7, spec §6-§7.3):
// draws exactly what `readingLayout` returns — flat or circular shapes
// in four tip directions, node letters, lettered points, trait marks
// and a numeric or schematic time axis (the visible layer lives in
// readingDraw.tsx) — and layers invisible hit targets on nodes, tips,
// points and branches for tap/click selection plus full keyboard
// access (Tab into the tree, arrows move parent/child/sibling, Enter
// selects, R rotates, "Rotate here" is the pointer equivalent).
//
// Selection and rotation are both keyed by `CladeKey` (a node's tip
// set), never by screen position (Review Focus 4): rotating a node
// swaps its children in a LOCAL copy of the view (`rotated`), so the
// `selected` prop still marks the same clades after a mid-question
// rotation. The swap animates at 300 ms ease-in-out, or instantly
// under prefers-reduced-motion (plan decision; §6.10's global
// zero-duration rule also applies).
//
// Hit areas (spec §6): an always-on small target, plus an invisible
// ≥40×40 pad shown under `(pointer: coarse)` only — a tip's pad
// covers its label box so a tap on the name lands too.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  fontsStatus,
  onFontsLateLoad,
  whenFontsReady,
} from "../../design/fontsReady";
import { PRESENTER_SCALE, size } from "../../design/tokens";
import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import {
  readingLayout,
  type ReadingFigure,
  type ReadingStyle,
} from "../../layout/readingLayout";
import { cladeKey } from "../../layout/readingGeom";
import { MIN_FONT_PX } from "../../layout/treePanel";
import { makeTextMeasurer } from "../../measureText";

import { ReadingDraw } from "./readingDraw";
import { BranchHits, PointHits } from "./readingHits";
import {
  anim,
  describe,
  FOCUS_R,
  HIT_CORE,
  hitPad,
  type PickKind,
  scrollCue,
} from "./readingHelpers";
import { TreeDescription } from "./TreeDescription";
import "./reading.css";

/** What a tap on the tree may select (plan Task 7 interface). */
export type ReadingSelectable =
  | "none"
  | "node"
  | "tips"
  | "points"
  | "branch";

export interface ReadingTreeProps {
  /** The resolved tree (Task 5 `readingTree` output). */
  view: ReadingTreeView;
  style: ReadingStyle;
  selectable: ReadingSelectable;
  /** The currently selected clades — stable across rotations because
   * they are tip sets, not positions. Controlled by the parent. */
  selected: string[][];
  onSelect: (clade: string[]) => void;
  /** A clade to emphasise (tip set); empty = none. */
  highlight: string[];
  rotatable: boolean;
  /** Reported after the component swaps a node's children locally —
   * parents learn that the display order changed. */
  onRotate: (clade: string[]) => void;
  /** Panel caption and the svg's accessible name ("Tree 1", …). */
  label: string;
}

interface Size {
  width: number;
  x: number;
  y: number;
}

/** Measures the panel width via ResizeObserver; 0 until it fires. */
function usePanelWidth(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [s, setS] = useState<Size>({ width: 0, x: 0, y: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setS({ width: r.width, x: r.x, y: r.y });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, s];
}

/** Live `(prefers-reduced-motion: reduce)` state; false without
 * matchMedia (jsdom). Drives the rotation animation's duration. */
function useReducedMotion(): boolean {
  const mq = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null,
    [],
  );
  return useSyncExternalStore(
    useCallback(
      (notify) => {
        mq?.addEventListener("change", notify);
        return () => mq?.removeEventListener("change", notify);
      },
      [mq],
    ),
    () => mq?.matches ?? false,
  );
}

export function ReadingTree({
  view,
  style,
  selectable,
  selected,
  onSelect,
  highlight,
  rotatable,
  onRotate,
  label,
}: ReadingTreeProps) {
  const [boxRef, box] = usePanelWidth();
  const reduced = useReducedMotion();

  // Marker ids must be unique when several reading trees share a page.
  const markerId = `rt-arrow-${useId().replace(/:/g, "")}`;

  // Fonts-ready gate, as in TreeView: measured label widths must come
  // from the bundled faces. jsdom (no document.fonts) is open at once.
  const fontsSupported =
    typeof document !== "undefined" && document.fonts !== undefined;
  const [fontsSettled, setFontsSettled] = useState(
    !fontsSupported || fontsStatus() !== "pending",
  );
  const [, bumpFontsTick] = useReducer((t: number) => t + 1, 0);
  useEffect(() => {
    if (!fontsSupported) return;
    let live = true;
    void whenFontsReady().then(() => {
      if (live) setFontsSettled(true);
    });
    const off = onFontsLateLoad(() => {
      if (live) bumpFontsTick();
    });
    return () => {
      live = false;
      off();
    };
  }, [fontsSupported]);

  const presenter =
    typeof document !== "undefined" &&
    document.documentElement.dataset.presenter === "true";
  const fontPx = Math.max(
    MIN_FONT_PX,
    size.xs * (presenter ? PRESENTER_SCALE : 1),
  );
  const measurer = useMemo(() => makeTextMeasurer(), []);
  const measure = (s: string) =>
    measurer(s, fontPx)?.w ?? s.length * fontPx * 0.625;

  // The local copy: nodes whose children are drawn in swapped order.
  const [rotated, setRotated] = useState<Set<string>>(new Set());
  const derived = useMemo<ReadingTreeView>(
    () => ({
      ...view,
      nodes: view.nodes.map((n) =>
        rotated.has(cladeKey(n.clade))
          ? { ...n, children: [...n.children].reverse() }
          : n,
      ),
    }),
    [view, rotated],
  );
  const nodes = derived.nodes;
  const byKey = useMemo(
    () => new Map(nodes.map((n, i) => [cladeKey(n.clade), i])),
    [nodes],
  );

  // Laid out on every render, as in TreeView: the fonts gate holds the
  // figure until the bundled faces resolve (metrics before that would
  // bake fallback widths in), and a late arrival re-renders through
  // fontsTick for the single permitted re-layout (spec §4.2).
  const fig: ReadingFigure | null =
    nodes.length === 0 || !fontsSettled
      ? null
      : readingLayout(
          derived,
          style,
          { width: Math.max(1, box.width), fontPx },
          measure,
        );

  // The scroll cue marks the edge(s) that still hide part of the
  // drawing, read from the canvas's real scroll metrics — never the
  // layout's fig.scroll flag alone, so at the scroll end the shadow
  // sits on the left edge instead of over the last labels (owner-
  // requested follow-up, 2026-11-20). The passive listener catches
  // every scroll source alike: wheel, touch and keyboard focus that
  // scrolls an off-screen node into view. The layout effect re-reads
  // the metrics whenever fig is (re)computed — rotation, style and
  // font changes reflow the svg, and panel resizes arrive through
  // usePanelWidth's ResizeObserver → new fig — none of which fire a
  // scroll event.
  const [cue, setCue] = useState<"left" | "right" | "both" | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const onScroll = () => setCue(scrollCue(el));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [boxRef]);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el !== null) setCue(scrollCue(el));
  }, [fig, boxRef]);

  // Roving focus across node hits, keyed by clade so it follows a
  // rotated node to its new position.
  const rootKey = cladeKey(nodes[derived.root]?.clade ?? []);
  const [focusKey, setFocusKey] = useState(rootKey);
  const effFocusKey = byKey.has(focusKey) ? focusKey : rootKey;
  const hitRefs = useRef(new Map<string, SVGGElement>());
  const moveFocus = (i: number | null) => {
    if (i === null) return;
    const k = cladeKey(nodes[i].clade);
    setFocusKey(k);
    hitRefs.current.get(k)?.focus();
  };

  const [announce, setAnnounce] = useState("");
  const selSet = useMemo(() => new Set(selected.map(cladeKey)), [selected]);

  const interactive = selectable !== "none" || rotatable;
  const canPickNode = (i: number) =>
    selectable === "node" ||
    (selectable === "tips" && nodes[i].children.length === 0);

  const pick = (i: number, kind: PickKind, letter?: string) => {
    const n = nodes[i];
    const what =
      kind === "point"
        ? `point ${letter ?? ""}`
        : kind === "branch"
          ? `the branch to ${n.clade.join(", ")}`
          : describe(n.clade, n.letter, n.label);
    onSelect(n.clade);
    setAnnounce(`Selected ${what}`);
  };

  const rotate = (i: number) => {
    const n = nodes[i];
    const key = cladeKey(n.clade);
    setRotated((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
    onRotate(n.clade);
    setAnnounce(`Rotated ${describe(n.clade, n.letter, null)}`);
  };
  const focusIdx = byKey.get(effFocusKey) ?? derived.root;
  const focusRotatable =
    rotatable && (nodes[focusIdx]?.children.length ?? 0) > 1;

  const onNodeKey = (e: React.KeyboardEvent, i: number) => {
    const n = nodes[i];
    const sib = (dir: 1 | -1): number | null => {
      if (n.parent === null) return null;
      const sibs = nodes[n.parent].children;
      const at = sibs.indexOf(i) + dir;
      return at >= 0 && at < sibs.length ? sibs[at] : null;
    };
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveFocus(n.parent);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveFocus(n.children[0] ?? null);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(sib(e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" || e.key === " ") {
      if (canPickNode(i)) {
        e.preventDefault();
        pick(i, "node");
      }
    } else if (e.key === "r" || e.key === "R") {
      if (rotatable && n.children.length > 1) {
        e.preventDefault();
        rotate(i);
      }
    }
  };

  const fullLabel = (clade: string[]) =>
    nodes[byKey.get(cladeKey(clade)) ?? -1]?.label;

  return (
    <figure
      className="rt-figure"
      data-shape={style.shape}
      data-tips={style.tips}
    >
      <figcaption className="rt-caption">{label}</figcaption>
      <div className="rt-canvas" ref={boxRef} data-cue={cue || undefined}>
        {fontsSettled && fig !== null && (
          <svg
            role={interactive ? "tree" : "img"}
            aria-label={label}
            aria-multiselectable={
              interactive && selectable !== "none" ? true : undefined
            }
            viewBox={`0 0 ${fig.width} ${fig.height}`}
            width={fig.width}
            height={fig.height}
          >
            <ReadingDraw
              fig={fig}
              view={derived}
              style={style}
              fontPx={fontPx}
              selected={selected}
              highlight={highlight}
              reduced={reduced}
              markerId={markerId}
            />
            {interactive &&
              fig.nodes.map((nd) => {
                const key = cladeKey(nd.clade);
                const i = byKey.get(key) ?? -1;
                if (i < 0) return null;
                const pad = hitPad(0, 0);
                const lb = nd.labelBox;
                // The coarse pad covers the node AND its label box; the
                // label box rect stays always-on so name taps select
                // under fine pointers too.
                const tipPad =
                  lb !== undefined
                    ? {
                        x: Math.min(pad.x, lb.minX - nd.x),
                        y: Math.min(pad.y, lb.minY - nd.y),
                        width:
                          Math.max(pad.x + pad.width, lb.maxX - nd.x) -
                          Math.min(pad.x, lb.minX - nd.x),
                        height:
                          Math.max(pad.y + pad.height, lb.maxY - nd.y) -
                          Math.min(pad.y, lb.minY - nd.y),
                      }
                    : pad;
                return (
                  <g
                    key={key}
                    ref={(el) => {
                      if (el !== null) hitRefs.current.set(key, el);
                      else hitRefs.current.delete(key);
                    }}
                    className="rt-hit"
                    role="treeitem"
                    aria-selected={selSet.has(key) || undefined}
                    aria-label={describe(
                      nd.clade,
                      nd.letter ?? null,
                      fullLabel(nd.clade),
                    )}
                    tabIndex={key === effFocusKey ? 0 : -1}
                    data-clade={key}
                    data-kind={nd.isTip ? "tip" : "node"}
                    data-selected={selSet.has(key) || undefined}
                    data-focus={key === effFocusKey || undefined}
                    style={anim(nd.x, nd.y, reduced)}
                    onClick={
                      canPickNode(i) ? () => pick(i, "node") : undefined
                    }
                    onKeyDown={(e) => onNodeKey(e, i)}
                  >
                    <rect className="rt-hit-pad" {...tipPad} />
                    {lb !== undefined && (
                      <rect
                        className="rt-hit-labelbox"
                        x={lb.minX - nd.x}
                        y={lb.minY - nd.y}
                        width={lb.maxX - lb.minX}
                        height={lb.maxY - lb.minY}
                      />
                    )}
                    <circle className="rt-hit-core" r={HIT_CORE} />
                    <circle className="rt-hit-ring" r={FOCUS_R} />
                  </g>
                );
              })}
            {selectable === "points" && (
              <PointHits
                fig={fig}
                view={view}
                style={style}
                byKey={byKey}
                selSet={selSet}
                reduced={reduced}
                pick={pick}
              />
            )}
            {selectable === "branch" && (
              <BranchHits
                fig={fig}
                view={view}
                byKey={byKey}
                selSet={selSet}
                reduced={reduced}
                pick={pick}
              />
            )}
          </svg>
        )}
      </div>
      <div className="rt-controls">
        {rotatable && (
          <button
            type="button"
            className="rt-rotate"
            disabled={!focusRotatable}
            onClick={() => rotate(focusIdx)}
          >
            Rotate here
          </button>
        )}
        <p role="status" className="rt-live">
          {announce}
        </p>
        <TreeDescription view={derived} />
      </div>
    </figure>
  );
}
