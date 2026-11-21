// Mark-label collision pass (v1.4d checkpoint §21(a)): placeMarks
// keeps the labels of marks that SHARE one branch apart, but a label
// can still land on a tip label, a node- or point-letter badge, a
// glyph on another branch, or another branch's label — on form A's
// printed whale tree the "limbs" / "echolocation" labels on dolphin's
// short stem ran into the "hippo" tip label.
//
// Every mark label that collides walks a deterministic ladder of
// candidate directions beside its own glyph — the stem's mirror side
// first (it keeps the label level with the glyph), then spots tilted
// along the stem on either side — and for each direction the distance
// is re-derived so the label box still sits exactly LABEL_GAP off its
// own glyph along its offset (the legibility contract the layout
// tests pin). A shared mark's label may only land where its own
// glyph is still the nearest one. The first spot that clears every
// obstacle and stays inside the figure wins; a spot that clears but
// escapes the figure reports `grow`, like placeMarks does, so the
// caller can shift the drawing around it.

import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";

import { D2R, LABEL_GAP, PAD, type Box } from "./readingGeom";
import { intersects } from "./labelCollision";
import { markGlyphBox, type PlacedMark } from "./readingMarks";

export interface ResolveMarkLabelsInput {
  view: ReadingTreeView;
  /** placeMarks' placements (undefined for unresolvable clades). */
  placed: (PlacedMark | undefined)[];
  /** Tip label boxes (null on unlabelled/internal nodes). */
  tipBoxes: (Box | null)[];
  /** Letter-badge boxes — lettered nodes and lettered points. */
  badges: Box[];
  asc: number;
  desc: number;
  measure: (s: string) => number;
  width: number;
  height: number;
}

const notNull = <T>(v: T | null | undefined): v is T => v != null;

export function resolveMarkLabels(
  inp: ResolveMarkLabelsInput,
): { gx: number; gy: number; addW: number; addH: number } | null {
  const { view, placed, asc, desc, measure } = inp;
  const boxAt = (w: number, x: number, y: number): Box => ({
    minX: x - w / 2,
    maxX: x + w / 2,
    minY: y - asc,
    maxY: y + desc,
  });

  // Marks sharing a branch keep their exact LABEL_GAP construction
  // (the shared-mark legibility tests pin it); a lone mark's label
  // may also step further out along a direction.
  const groupSize = new Map<string, number>();
  for (const m of view.marks) {
    const k = JSON.stringify([...m.on].sort());
    groupSize.set(k, (groupSize.get(k) ?? 0) + 1);
  }

  const glyphBox = (j: number): Box => {
    const p = placed[j]!;
    return markGlyphBox(view.marks[j].change, p.x, p.y, p.angle);
  };
  const glyphs = view.marks.map((_, j) =>
    placed[j] === undefined ? null : glyphBox(j),
  );
  const fixed: Box[] = [
    ...inp.tipBoxes.filter(notNull),
    ...inp.badges,
  ];
  const done: Box[] = [];

  // A label's own glyph is never its obstacle: placeMarks already
  // guarantees a shared mark clears it, and a lone mark's "10 px
  // above" placement has always been the accepted look.
  const hits = (b: Box, self: number): boolean =>
    fixed.some((o) => intersects(b, o)) ||
    done.some((o) => intersects(b, o)) ||
    glyphs.some((g, k) => k !== self && g !== null && intersects(b, g));
  const inside = (b: Box): boolean =>
    b.minX >= PAD && b.minY >= PAD && b.maxX <= inp.width - PAD && b.maxY <= inp.height - PAD;

  for (let j = 0; j < view.marks.length; j += 1) {
    const p = placed[j];
    if (p === undefined) continue;
    if (!hits(p.labelBox, j)) {
      done.push(p.labelBox);
      continue;
    }

    const shared =
      (groupSize.get(JSON.stringify([...view.marks[j].on].sort())) ?? 1) > 1;
    const a = p.angle * D2R;
    const u = { x: Math.cos(a), y: Math.sin(a) };
    const n1 = { x: -u.y, y: u.x };
    const n2 = { x: u.y, y: -u.x };
    const ox = p.labelX - p.x;
    const oy = p.labelY - p.y;
    const on = ox * n1.x + oy * n1.y;
    const ou = ox * u.x + oy * u.y;
    const w = measure(view.marks[j].trait);
    const glyph = markGlyphBox(view.marks[j].change, 0, 0, p.angle);

    // Extents relative to the anchor along a unit direction.
    const out = (dx: number, dy: number): number => {
      let hi = -Infinity;
      for (const [cx, cy] of [
        [glyph.minX, glyph.minY],
        [glyph.maxX, glyph.minY],
        [glyph.maxX, glyph.maxY],
        [glyph.minX, glyph.maxY],
      ] as const) {
        hi = Math.max(hi, cx * dx + cy * dy);
      }
      return hi;
    };
    const rL = (dx: number, dy: number): number =>
      (w / 2) * Math.abs(dx) + (dy > 0 ? asc : desc) * Math.abs(dy);

    // Candidate directions beside the stem, most conservative first.
    const dirs: { x: number; y: number }[] = [];
    const pushDir = (dx: number, dy: number): void => {
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) return;
      const x = dx / l;
      const y = dy / l;
      if (dirs.some((d) => Math.abs(d.x - x) < 1e-6 && Math.abs(d.y - y) < 1e-6))
        return;
      dirs.push({ x, y });
    };
    // The stem's mirror side keeps the label level with its glyph.
    pushDir(ou * u.x - on * n1.x, ou * u.y - on * n1.y);
    // Then either perpendicular side with tilts along the stem (a
    // slide) — the original side first.
    for (const s of on >= 0 ? [n1, n2] : [n2, n1]) {
      for (const t of [0, -0.5, 0.5, -1, 1]) {
        pushDir(s.x + t * u.x, s.y + t * u.y);
      }
    }

    const nearestOwn = (x: number, y: number): boolean => {
      const dOwn = Math.hypot(x - p.x, y - p.y);
      for (let k = 0; k < view.marks.length; k += 1) {
        const q = placed[k];
        if (k === j || q === undefined) continue;
        if (dOwn >= Math.hypot(x - q.x, y - q.y) - 1e-9) return false;
      }
      return true;
    };

    let fallback: { x: number; y: number } | null = null;
    let chosen: { x: number; y: number } | null = null;
    const nStep = asc + desc + LABEL_GAP;
    for (const d of dirs) {
      const base = out(d.x, d.y) + LABEL_GAP + rL(d.x, d.y);
      // Shared marks keep the exact gap; lone marks may float further
      // out along the same direction when the near spot is taken.
      const tiers = shared ? [0] : [0, nStep, 2 * nStep];
      for (const extra of tiers) {
        const x = p.x + d.x * (base + extra);
        const y = p.y + d.y * (base + extra);
        const b = boxAt(w, x, y);
        if (hits(b, j) || !nearestOwn(x, y)) continue;
        if (inside(b)) {
          chosen = { x, y };
          break;
        }
        if (fallback === null) fallback = { x, y };
      }
      if (chosen !== null) break;
    }
    const spot = chosen ?? fallback;
    if (spot !== null) {
      p.labelX = spot.x;
      p.labelY = spot.y;
      p.labelBox = boxAt(w, spot.x, spot.y);
    }
    done.push(p.labelBox);
  }

  // Room the resolved labels and glyphs need outside the figure box
  // (same contract as placeMarks' grow; the caller shifts).
  let gx = 0;
  let gy = 0;
  let addW = 0;
  let addH = 0;
  for (let j = 0; j < view.marks.length; j += 1) {
    const p = placed[j];
    if (p === undefined) continue;
    for (const b of [p.labelBox, glyphBox(j)]) {
      gx = Math.max(gx, PAD - b.minX);
      addW = Math.max(addW, b.maxX + PAD - inp.width);
      gy = Math.max(gy, PAD - b.minY);
      addH = Math.max(addH, b.maxY + PAD - inp.height);
    }
  }
  if (gx <= 0 && gy <= 0 && addW <= 0 && addH <= 0) return null;
  for (const p of placed) {
    if (p === undefined) continue;
    p.x += gx;
    p.y += gy;
    p.labelX += gx;
    p.labelY += gy;
    p.labelBox = {
      minX: p.labelBox.minX + gx,
      maxX: p.labelBox.maxX + gx,
      minY: p.labelBox.minY + gy,
      maxY: p.labelBox.maxY + gy,
    };
  }
  return { gx, gy, addW, addH };
}
