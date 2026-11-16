// One decimal count for every cell of a displayed matrix (v1.4c owner
// ruling 2A on PR #156): at a fixed 3 decimals a value ≥ 10 ("15.000")
// is wider than MatrixHeatmap's 34 px cell. 0 when every finite value
// is an integer ("15", "5"); otherwise the largest d ≤ 3 whose widest
// formatted value still fits the cell at 12 px — in practice keyed on
// the widest |v| (<10 → 3, <100 → 2, <1000 → 1, else 0). Every matrix
// whose values are all < 10 and not all integers keeps the shipped 3
// decimals byte-identically. Non-finite values (∞/saturated cells)
// don't count; an empty list returns the default 3.
export function cellDecimals(values: number[]): number {
  let widest = 0;
  let any = false;
  let allInt = true;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    any = true;
    if (!Number.isInteger(v)) allInt = false;
    const a = Math.abs(v);
    if (a > widest) widest = a;
  }
  if (!any) return 3;
  if (allInt) return 0;
  return widest < 10 ? 3 : widest < 100 ? 2 : widest < 1000 ? 1 : 0;
}
