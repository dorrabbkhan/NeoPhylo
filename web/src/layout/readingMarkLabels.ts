// Mark-label collision pass (v1.4d checkpoint §21(a)): placeMarks
// keeps the labels of marks that SHARE one branch apart, but a label
// can still land on a tip label, a tip dot, a node- or point-letter
// badge, another branch's segment, a glyph on another branch, or
// another branch's label — on form A's printed whale tree the "limbs"
// / "echolocation" labels on dolphin's short stem sat on the hippo
// branch line and ran into the "hippo" tip dot.
//
// Every mark label that collides walks a deterministic ladder of
// candidate directions beside its own glyph — the stem's mirror side
// first (it keeps the label level with the glyph), then spots tilted
// along the stem on either side — and for each direction the distance
// is re-derived so the label box still sits exactly LABEL_GAP off its
// own glyph along its offset (the legibility contract the layout
// tests pin). A shared mark's label may only land where its own
// glyph is still the nearest one. The first spot that clears every
// obstacle by MARK_CLEAR and stays inside the figure wins; a spot
// that clears but escapes the figure reports `grow`, like placeMarks
// does, so the caller can shift the drawing around it.

import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";

import { D2R, LABEL_GAP, MARK_CLEAR, PAD, type Box } from "./readingGeom";
import { intersects, segBoxDist, type Seg } from "./labelCollision";
import { markGlyphBox, type PlacedMark } from "./readingMarks";

export interface ResolveMarkLabelsInput {
  view: ReadingTreeView;
  /** placeMarks' placements (undefined for unresolvable clades). */
  placed: (PlacedMark | undefined)[];
  /** Tip label boxes (null on unlabelled/internal nodes). */
  tipBoxes: (Box | null)[];
  /** Letter-badge boxes — lettered nodes and lettered points. */
  badges: Box[];
  /** Node-dot boxes — every unlettered node (tip and internal). */
  dots: Box[];
  /** Drawn branch chains per non-root node; a mark's own branch (the
   * chain tagged with its clade's node, resolved through `find`) is
   * the only line a label may sit on. */
  segs: { node: number; pts: { x: number; y: number }[] }[];
  /** Clade → node index, the layout's own resolver. */
  find: (clade: string[]) => number | undefined;
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
  // The node whose branch each mark rides on — its own chain is the
  // one line its label may touch.
  const ownNode = view.marks.map((m) => inp.find(m.on));
  const fixed: Box[] = [
    ...inp.tipBoxes.filter(notNull),
    ...inp.badges,
    ...inp.dots,
  ];
  const done: Box[] = [];

  // MARK_CLEAR between a label and everything that is not its own
  // mark — inflate the candidate and test. A label's own glyph is
  // never its obstacle (placeMarks already guarantees a shared mark
  // clears it, and a lone mark's "10 px above" placement has always
  // been the accepted look), and its own branch is the line it
  // legitimately sits on.
  const hits = (b: Box, self: number): boolean => {
    const near: Box = {
      minX: b.minX - MARK_CLEAR,
      maxX: b.maxX + MARK_CLEAR,
      minY: b.minY - MARK_CLEAR,
      maxY: b.maxY + MARK_CLEAR,
    };
    if (
      fixed.some((o) => intersects(near, o)) ||
      done.some((o) => intersects(near, o)) ||
      glyphs.some((g, k) => k !== self && g !== null && intersects(near, g))
    ) {
      return true;
    }
    const own = ownNode[self];
    for (const chain of inp.segs) {
      if (own !== undefined && chain.node === own) continue;
      for (let s = 0; s + 1 < chain.pts.length; s += 1) {
        const seg: Seg = {
          x1: chain.pts[s].x,
          y1: chain.pts[s].y,
          x2: chain.pts[s + 1].x,
          y2: chain.pts[s + 1].y,
        };
        if (segBoxDist(seg, b) < MARK_CLEAR - 1e-9) return true;
      }
    }
    return false;
  };
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
    // slide) — the original side first. Big tilts land the label
    // nearly parallel to its stem, the slot that slips past the
    // neighbouring branches a boxed-in label must clear.
    for (const s of on >= 0 ? [n1, n2] : [n2, n1]) {
      for (const t of [0, -0.3, 0.3, -0.6, 0.6, -1, 1, -1.5, 1.5, -2.5, 2.5, -4, 4]) {
        pushDir(s.x + t * u.x, s.y + t * u.y);
      }
    }
    // No along-stem candidates on purpose: a label centred on the
    // stem is struck through by its own branch line — every
    // perpendicular slide and, failing that, the growth fallback is
    // preferable.

    const nearestOwn = (x: number, y: number): boolean => {
      const dOwn = Math.hypot(x - p.x, y - p.y);
      for (let k = 0; k < view.marks.length; k += 1) {
        const q = placed[k];
        if (k === j || q === undefined) continue;
        if (dOwn >= Math.hypot(x - q.x, y - q.y) - 1e-9) return false;
      }
      return true;
    };

    const nStep = asc + desc + LABEL_GAP;
    // A shared branch's labels form a row on one side of the stem.
    // Keep the row coherent: try same-side spots at the construction
    // distance first, then anywhere at that distance, then float
    // along the label's own direction (it stays level with its glyph
    // and on the row's side), then float anywhere. Each pass prefers
    // inside spots; the first pass's outside spot beats a later
    // pass's inside one (coherence > compactness).
    const od = Math.hypot(ox, oy);
    const sameDir =
      od > 1e-9 ? { x: ox / od, y: oy / od } : { x: n1.x, y: n1.y };
    const onSide = (x: number, y: number): boolean =>
      od < 1e-9 || (x - p.x) * ox + (y - p.y) * oy > 0;
    const spots: ({ x: number; y: number } | null)[] = [];
    const run = (
      ds: { x: number; y: number }[],
      extras: number[],
      sideOnly: boolean,
    ): { c: { x: number; y: number } | null; f: { x: number; y: number } | null } => {
      let c: { x: number; y: number } | null = null;
      let f: { x: number; y: number } | null = null;
      for (const d of ds) {
        const base = out(d.x, d.y) + LABEL_GAP + rL(d.x, d.y);
        for (const extra of extras) {
          const x = p.x + d.x * (base + extra);
          const y = p.y + d.y * (base + extra);
          if (sideOnly && !onSide(x, y)) continue;
          const b = boxAt(w, x, y);
          if (hits(b, j) || !nearestOwn(x, y)) continue;
          if (inside(b)) {
            c = { x, y };
            break;
          }
          if (f === null) f = { x, y };
        }
        if (c !== null) break;
      }
      return { c, f };
    };
    if (shared) {
      const a = run(dirs, [0], true);
      const b = run(dirs, [0], false);
      const c = run([sameDir], [nStep, 2 * nStep], false);
      // The row's own direction floated (level, same side) beats an
      // exact-gap spot that would leave this label on its own side.
      spots.push(a.c, a.f, c.c, c.f, b.c, b.f);
      // tsc narrows `spots` to null[] inside an `.every(=== null)`
      // branch — gate the run on the ternary, push outside it.
      const d = spots.every((s) => s === null)
        ? run(dirs, [nStep, 2 * nStep], false)
        : { c: null, f: null };
      spots.push(d.c, d.f);
    } else {
      const d = run(dirs, [0, nStep, 2 * nStep], false);
      spots.push(d.c, d.f);
    }
    let spot = spots.find((s) => s !== null) ?? null;
    if (spot === null) {
      // Rare, and mostly a tips-up/down layout: the vertical tip
      // risers are a picket fence a wide label cannot slip between.
      // Sweep every direction in fine steps, nearest radius first —
      // a label out in open water still beats one over a branch.
      // Along-stem angles stay excluded (text struck through by its
      // own line) but near-along angles may slide past the node.
      let f: { x: number; y: number } | null = null;
      const rStep = nStep / 2;
      const maxR = Math.hypot(inp.width, inp.height);
      for (let r = 0; r <= maxR && spot === null; r += rStep) {
        for (let k = 0; k < 48; k += 1) {
          const th = (k / 48) * 2 * Math.PI;
          const dx = Math.cos(th);
          const dy = Math.sin(th);
          if (Math.abs(dx * u.x + dy * u.y) > 0.985) continue;
          const base = out(dx, dy) + LABEL_GAP + rL(dx, dy);
          const x = p.x + dx * (base + r);
          const y = p.y + dy * (base + r);
          const b = boxAt(w, x, y);
          if (hits(b, j) || !nearestOwn(x, y)) continue;
          if (inside(b)) {
            spot = { x, y };
            break;
          }
          if (f === null) f = { x, y };
        }
      }
      if (spot === null) spot = f;
    }
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
