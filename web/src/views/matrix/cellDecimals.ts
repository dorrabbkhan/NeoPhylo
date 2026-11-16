// One decimal count for every cell of a displayed matrix (v1.4c owner
// ruling 2A on PR #156, sign-aware after review round 1 on PR #157):
// at a fixed 3 decimals a value ≥ 10 ("15.000") is wider than
// MatrixHeatmap's 34 px cell, and a magnitude-only bucket misses the
// minus sign — "-82.50" measures ~37 px. 0 when every finite value is
// an integer ("15", "5"); otherwise the largest d ≤ 3 such that EVERY
// finite value's toFixed(d) string, sign included, is at most 5
// characters — measured in the running app (Chromium, Inter 12 px)
// every 5-glyph string fits the 34 px cell (worst "-9999" ≈ 33.6 px)
// while 6 glyphs run ~32–37 px — "-114.5" fits but "-144.0" doesn't,
// so the cap is on character count, not per-string width.
// Falls back to 0 when no d ≤ 3 fits (|v| ≥ 10000). Every matrix whose
// values are all in [0, 10) and not all integers keeps the shipped 3
// decimals byte-identically. Non-finite values (∞/saturated cells)
// don't count; an empty list returns the default 3.
export function cellDecimals(values: number[]): number {
  const finite: number[] = [];
  let allInt = true;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    finite.push(v);
    if (!Number.isInteger(v)) allInt = false;
  }
  if (finite.length === 0) return 3;
  if (allInt) return 0;
  for (let d = 3; d >= 0; d -= 1) {
    if (finite.every((v) => v.toFixed(d).length <= 5)) return d;
  }
  return 0;
}
