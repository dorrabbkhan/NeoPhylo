// Math layer for the explanation panel (plan Task 18, spec §6.2 and §4.5).
// Each line is KaTeX source with the step's own numbers substituted,
// formatted to 4 decimals with trailing zeros trimmed (fmt). Every value
// is read out of the trace record — no distances are recomputed in
// TypeScript; the only arithmetic is index lookup into the stored
// row-major matrices.

import type { NjFinal } from "../engine/generated/NjFinal";
import type { NjStep } from "../engine/generated/NjStep";
import type { Trace } from "../engine/generated/Trace";
import type { UpgmaStep } from "../engine/generated/UpgmaStep";

/** Trace numbers render as `toFixed(4)` with trailing zeros (and a bare
 * decimal point) trimmed: 31 -> "31", 8.5 -> "8.5", -0.12345 -> "-0.1235". */
export function fmt(v: number): string {
  return v.toFixed(4).replace(/\.?0+$/, "");
}

/** Characters that are unsafe inside KaTeX \text{...}. */
const TEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "%": "\\%",
  "#": "\\#",
  "&": "\\&",
  _: "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
};

/** A node display name as a KaTeX operand. Labels always go through
 * \text{...} with specials escaped, so spaces, apostrophes, markup or
 * underscores in taxon names can never break the formula (Review Focus 2). */
function tex(label: string): string {
  const esc = label.replace(/[\\{}$%#&_^~]/g, (c) => TEX_ESCAPES[c]);
  return `\\text{${esc}}`;
}

/** Display name of NodeId `id`, formatted for KaTeX. */
function at(labels: string[], id: number): string {
  return tex(labels[id] ?? `#${id}`);
}

/** Row-major lookup into a step's stored active-cluster matrix. */
function cell(m: { n: number; data: number[] }, i: number, j: number): number {
  return m.data[i * m.n + j];
}

/** The first active index that is not in the chosen pair — the example k
 * in d(u,k), and the index of new_row[0]'s cluster. */
function firstRemaining(s: NjStep | UpgmaStep): number {
  return s.active.findIndex(
    (_, idx) => idx !== s.chosen[0] && idx !== s.chosen[1],
  );
}

const TIE_LINE = "Tie: chosen by input order.";

/** NJ Math lines (task order): R sums, the chosen Q, both δ formulas,
 * one example d(u,k), then the tie notice when the step tied. */
function njStepLines(s: NjStep, labels: string[]): string[] {
  const n = s.active.length;
  const [i, j] = s.chosen;
  const a = at(labels, s.active[i]);
  const b = at(labels, s.active[j]);
  const u = at(labels, s.new_node);
  const dij = cell(s.distance, i, j);
  const q = cell(s.q, i, j);
  const lines = [
    `R_{${a}} = ${fmt(s.r[i])}, \\quad R_{${b}} = ${fmt(s.r[j])}`,
    `Q(${a},${b}) = (${fmt(n)}-2)\\,d(${a},${b}) - R_{${a}} - R_{${b}} = ` +
      `${fmt(n - 2)} \\cdot ${fmt(dij)} - ${fmt(s.r[i])} - ${fmt(s.r[j])} = ${fmt(q)}`,
    `\\delta(${a},${u}) = \\frac{d(${a},${b})}{2} + \\frac{R_{${a}} - R_{${b}}}{2(${fmt(n)}-2)} = ` +
      `\\frac{${fmt(dij)}}{2} + \\frac{${fmt(s.r[i])} - ${fmt(s.r[j])}}{${fmt(2 * (n - 2))}} = ${fmt(s.len_i)}`,
    `\\delta(${b},${u}) = d(${a},${b}) - \\delta(${a},${u}) = ${fmt(dij)} - ${fmt(s.len_i)} = ${fmt(s.len_j)}`,
  ];
  const k = firstRemaining(s);
  if (k >= 0 && s.new_row.length > 0) {
    const kn = at(labels, s.active[k]);
    lines.push(
      `d(${u},${kn}) = \\frac{d(${a},${kn}) + d(${b},${kn}) - d(${a},${b})}{2} = ` +
        `\\frac{${fmt(cell(s.distance, i, k))} + ${fmt(cell(s.distance, j, k))} - ${fmt(dij)}}{2} = ${fmt(s.new_row[0])}`,
    );
  }
  if (s.tie) lines.push(TIE_LINE);
  return lines;
}

/** Distance between two of the final three clusters, recovered from the
 * last stored NJ step: pairs that were both still active come from its
 * `distance` matrix, pairs involving the node it made come from `new_row`
 * (whose order is the remaining active nodes' order). */
function lastStepDist(s: NjStep, x: number, y: number): number | null {
  if (x === y) return 0;
  const xi = s.active.indexOf(x);
  const yi = s.active.indexOf(y);
  if (xi >= 0 && yi >= 0) return cell(s.distance, xi, yi);
  if (x === s.new_node || y === s.new_node) {
    const other = x === s.new_node ? y : x;
    const rem = s.active.filter(
      (_, idx) => idx !== s.chosen[0] && idx !== s.chosen[1],
    );
    const t = rem.indexOf(other);
    if (t >= 0 && t < s.new_row.length) return s.new_row[t];
  }
  return null;
}

/** Lines for NJ's final three-way join (spec §4.5 step 5): the three
 * l formulas with the distances substituted when they are recoverable
 * from the last stored step. */
function njFinalLines(steps: NjStep[], f: NjFinal, labels: string[]): string[] {
  const a = at(labels, f.a);
  const b = at(labels, f.b);
  const c = at(labels, f.c);
  const lines: string[] = [];
  const last = steps.length > 0 ? steps[steps.length - 1] : null;
  const dab = last ? lastStepDist(last, f.a, f.b) : null;
  const dac = last ? lastStepDist(last, f.a, f.c) : null;
  const dbc = last ? lastStepDist(last, f.b, f.c) : null;
  if (dab !== null && dac !== null && dbc !== null) {
    lines.push(
      `d(${a},${b}) = ${fmt(dab)}, \\quad d(${a},${c}) = ${fmt(dac)}, \\quad d(${b},${c}) = ${fmt(dbc)}`,
    );
  }
  lines.push(
    `l_${a} = \\frac{d(${a},${b}) + d(${a},${c}) - d(${b},${c})}{2} = ${fmt(f.la)}`,
    `l_${b} = \\frac{d(${a},${b}) + d(${b},${c}) - d(${a},${c})}{2} = ${fmt(f.lb)}`,
    `l_${c} = \\frac{d(${a},${c}) + d(${b},${c}) - d(${a},${b})}{2} = ${fmt(f.lc)}`,
  );
  return lines;
}

/** UPGMA Math lines: the chosen (smallest) distance, the new cluster's
 * height, both branch lengths, and one size-weighted example d(u,k). */
function upgmaStepLines(s: UpgmaStep, labels: string[]): string[] {
  const [i, j] = s.chosen;
  const a = at(labels, s.active[i]);
  const b = at(labels, s.active[j]);
  const u = at(labels, s.new_node);
  const dij = cell(s.distance, i, j);
  const lines = [
    `d(${a},${b}) = ${fmt(dij)} \\quad \\text{(smallest distance)}`,
    `h = \\frac{d(${a},${b})}{2} = \\frac{${fmt(dij)}}{2} = ${fmt(s.height)}`,
    `\\delta(${a},${u}) = ${fmt(s.len_i)}, \\quad \\delta(${b},${u}) = ${fmt(s.len_j)}`,
  ];
  const k = firstRemaining(s);
  if (k >= 0 && s.new_row.length > 0) {
    const kn = at(labels, s.active[k]);
    const si = s.sizes[i];
    const sj = s.sizes[j];
    lines.push(
      `d(${u},${kn}) = \\frac{s_${a}\\,d(${a},${kn}) + s_${b}\\,d(${b},${kn})}{s_${a} + s_${b}} = ` +
        `\\frac{${fmt(si)} \\cdot ${fmt(cell(s.distance, i, k))} + ${fmt(sj)} \\cdot ${fmt(cell(s.distance, j, k))}}{${fmt(si + sj)}} = ${fmt(s.new_row[0])}`,
    );
  }
  if (s.tie) lines.push(TIE_LINE);
  return lines;
}

/**
 * KaTeX source lines explaining the join shown at position `step`.
 *
 * `step` follows the stepper convention: position k discusses join
 * steps[k] (the *next* join). NJ's extra final position shows the
 * three-way join from `final_join`; positions past the end keep showing
 * that join. `labels[id]` is the display name of NodeId `id` — leaf
 * labels first, then u1, u2, … (state/names.ts `nodeName`).
 */
export function mathTex(
  trace: Trace,
  step: number,
  labels: string[],
): string[] {
  const k = Math.max(0, step);
  if ("Nj" in trace) {
    const steps = trace.Nj.steps;
    if (k >= steps.length)
      return njFinalLines(steps, trace.Nj.final_join, labels);
    return njStepLines(steps[k], labels);
  }
  const steps = trace.Upgma.steps;
  if (steps.length === 0) return [];
  return upgmaStepLines(steps[Math.min(k, steps.length - 1)], labels);
}
