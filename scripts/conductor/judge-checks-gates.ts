/**
 * judge-checks-gates.ts — the files-block, engine-rules, content-numbers,
 * protected-paths, diff-stat, pr-events and owner-gate checks (plan order
 * 5, 6, 7, 8, 10, 11 and 12), split out of judge-checks.ts to keep every
 * file under the ~400-line rule. Shared Check helpers and the
 * uninspectable-entry rule live in judge-checks.ts.
 */
import { addedLines, uninspectable, type DiffFile, type DiffLine } from "./diff-parse.ts";
import {
  baseName,
  blind,
  decisionsAdditions,
  filesBlockPatterns,
  flag,
  matchesPat,
  na,
  pass,
  taskSection,
  type Check,
} from "./judge-checks.ts";

// ---------- 5. files-block ----------

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A file counts as named when decisions.md has its full path, or its bare
 * basename (not part of a longer name or path) and no other file in the
 * diff shares that basename.
 */
function namedInDecisions(decText: string, path: string, files: DiffFile[]): boolean {
  if (decText.includes(path)) return true;
  const base = baseName(path);
  if (files.filter((f) => baseName(f.path) === base).length > 1) return false;
  return new RegExp(`(^|[^\\w./-])${reEscape(base)}(?![\\w/-]|\\.\\w)`).test(decText);
}

export function checkFilesBlock(
  files: DiffFile[],
  planText: string | null,
  task: string,
): Check {
  const pats = planText ? filesBlockPatterns(planText, task) : null;
  if (!pats)
    return flag("files-block", [`no **Files:** block found for task ${task} in plan`]);
  const extras = files.filter(
    (f) => f.path !== "docs/decisions.md" && !matchesPat(pats, f.path),
  );
  if (!extras.length) return pass("files-block", "every diff file is in the task's Files block");
  const decText = decisionsAdditions(files);
  const unnamed = extras.filter((e) => !namedInDecisions(decText, e.path, files));
  return unnamed.length
    ? flag(
        "files-block",
        unnamed.map((e) => `${e.path} outside Files block and not named in a decisions.md hunk`),
      )
    : pass("files-block", "extra files named in decisions.md");
}

// ---------- 6. engine-rules ----------

const PANIC_RE = /\bunwrap\s*\(\s*\)|\.expect\s*\(|\bpanic!\s*|\bunreachable!|\btodo!|\bunimplemented!/;
const ENGINE_SRC_RE = /^crates\/neophylo-core\/src\//;
const GENERATED_RE = /^web\/src\/engine\/generated\//;
const PROPTEST_FILE_RE = /^crates\/.*\/tests\/[^/]*props[^/]*\.rs$/;
const CFG_TEST_RE = /#\[\s*cfg\s*\(\s*test/;
const TEST_MOD_RE = /\bmod\s+\w*test\w*\s*\{?/i;
const FN_OR_MOD_RE = /\b(?:fn|mod)\s+\w+/;
const PROPTEST_OPEN_RE = /\bproptest!/;
const STRATEGY_FN_RE = /\bfn\s+\w+[^;{]*->[^;{]*Strategy/;
const braces = (s: string) => {
  const code = s.replace(/\/\/.*$/, "");
  return (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
};

/** Added unwrap/expect/panic lines outside `#[cfg(test)]` regions. The
 * region is tracked by new-file brace depth; a test module or cfg(test)
 * fn that ends before the added line does not cover it. */
function panicLines(f: DiffFile): string[] {
  const reasons: string[] = [];
  let depth = 0;
  let testDepth: number | null = null;
  let cfgPending = false;
  const seen = (l: DiffLine) => {
    if (l.kind === "del") return;
    if (testDepth === null) {
      if (TEST_MOD_RE.test(l.text)) testDepth = depth + 1;
      else if (CFG_TEST_RE.test(l.text)) cfgPending = true;
      else if (cfgPending && FN_OR_MOD_RE.test(l.text)) {
        testDepth = depth + 1;
        cfgPending = false;
      } else if (cfgPending && l.text.trim() !== "" && !l.text.trim().startsWith("#["))
        cfgPending = false;
    }
    if (l.kind === "add" && testDepth === null && PANIC_RE.test(l.text))
      reasons.push(
        `${f.path}:${l.line} panic-prone call added outside test code: ${l.text.trim()}`,
      );
    depth += braces(l.text);
    if (testDepth !== null && depth < testDepth) testDepth = null;
  };
  for (const h of f.hunks) for (const l of h.lines) seen(l);
  return reasons;
}

/** Added/removed lines inside an existing `proptest!` block or strategy
 * fn (`-> …Strategy`) in crates/** tests/*props*.rs. Blocks and fns the
 * diff itself adds are new — they don't flag. */
function proptestEdits(f: DiffFile): string[] {
  const reasons: string[] = [];
  let depth = 0;
  let existing: { what: string; depth: number } | null = null;
  const fresh: number[] = []; // depths of blocks this diff added
  const inside = () => existing !== null && depth >= existing.depth;
  for (const h of f.hunks) {
    // The hunk header carries the enclosing signature; when it names a
    // proptest block or strategy fn the hunk is inside existing code.
    const head = h.header.includes("proptest") || STRATEGY_FN_RE.test(h.header);
    for (const l of h.lines) {
      const opens = PROPTEST_OPEN_RE.test(l.text) || STRATEGY_FN_RE.test(l.text);
      if (opens && l.kind === "add") fresh.push(depth + 1);
      else if (opens) {
        existing = { what: PROPTEST_OPEN_RE.test(l.text) ? "proptest! block" : "strategy fn", depth: depth + 1 };
        if (l.kind === "del")
          reasons.push(`${f.path} ${h.header}: ${existing.what} header removed`);
      }
      const isNew = opens && l.kind === "add";
      const skip = fresh.some((d) => depth >= d);
      if (!skip && !isNew && (inside() || head) && l.kind !== "ctx")
        reasons.push(
          `${f.path}:${l.line || h.header} ${l.kind === "add" ? "added" : "removed"} inside an existing proptest! block or strategy fn: ${l.text.trim()}`,
        );
      if (l.kind !== "del") depth += braces(l.text);
      for (let i = fresh.length - 1; i >= 0; i--) if (depth < fresh[i]) fresh.splice(i, 1);
      if (existing && depth < existing.depth) existing = null;
    }
  }
  return reasons;
}

export function checkEngineRules(files: DiffFile[]): Check {
  const reasons = blind(files);
  const cratesChanged = files.some((f) => f.path.startsWith("crates/"));
  for (const f of files) {
    if (uninspectable(f)) continue;
    if (f.path.startsWith("web/src/"))
      for (const l of addedLines(f))
        if (/\bMath\.random\s*\(/.test(l.text))
          reasons.push(`${f.path}:${l.line} added Math.random under web/src/`);
    if (ENGINE_SRC_RE.test(f.path)) reasons.push(...panicLines(f));
    if (GENERATED_RE.test(f.path) && !cratesChanged)
      reasons.push(
        `${f.path}: web/src/engine/generated/ changed with no crates/ change — hand edit of generated types`,
      );
    if (PROPTEST_FILE_RE.test(f.path)) reasons.push(...proptestEdits(f));
  }
  return reasons.length ? flag("engine-rules", reasons) : pass("engine-rules");
}

// ---------- 7. content-numbers ----------

const EXERCISES_RE = /^exercises\/.*\.json$/;
const CONTENT_KEY_RE = /"(concept|math|reveal|text|note_after|summary)"\s*:\s*"([^"]*)"/;

export function checkContentNumbers(files: DiffFile[]): Check {
  const targets = files.filter((f) => EXERCISES_RE.test(f.path));
  if (!targets.length) return na("content-numbers", "no exercises/**/*.json changed");
  const reasons = blind(targets);
  for (const f of targets) {
    if (uninspectable(f)) continue;
    for (const l of addedLines(f)) {
      const m = CONTENT_KEY_RE.exec(l.text);
      if (m && /\d/.test(m[2]))
        reasons.push(
          `${f.path}:${l.line} digit(s) added inside a "${m[1]}" string — lesson content must not hard-code data numbers`,
        );
    }
  }
  return reasons.length ? flag("content-numbers", reasons) : pass("content-numbers");
}

// ---------- 8. protected-paths ----------

// `LICENSE*` is the plan's glob: LICENSE, LICENSE.md, LICENSE-MIT and
// LICENSES/… all match the root-level prefix.
const PROTECTED_RES = [
  /^\.claude\//,
  /^\.github\//,
  /^LICENSE/,
  /(^|\/)AGENTS\.md$/,
];

export function checkProtectedPaths(
  files: DiffFile[],
  planText: string | null,
  task: string,
): Check {
  const reasons: string[] = [];
  // `.devin/**` is protected unless this task's Files block names the path.
  const pats = planText ? filesBlockPatterns(planText, task) : null;
  for (const f of files) {
    if (f.path.startsWith(".devin/")) {
      if (!matchesPat(pats, f.path)) reasons.push(`protected path touched: ${f.path}`);
    } else if (PROTECTED_RES.some((r) => r.test(f.path))) {
      reasons.push(`protected path touched: ${f.path}`);
    }
  }
  return reasons.length ? flag("protected-paths", [...new Set(reasons)]) : pass("protected-paths");
}

// ---------- 9. secrets → judge-checks.ts ----------

// ---------- 10. diff-stat ----------

export function claimedStatFiles(text: string): string[] {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    const m = /^\s*(.+?)\s*\|\s+(?:\d+|Bin\b)/.exec(l);
    if (!m) continue;
    let p = m[1].trim().replace(/^"|"$/g, "");
    const brace = /\{[^}]*=>\s*([^}]*)\}/.exec(p);
    if (brace) p = p.replace(/\{[^}]*=>[^}]*\}/, brace[1].trim());
    else if (p.includes("=>")) p = p.split("=>").pop()!.trim();
    if (p) out.push(p);
  }
  return out;
}

/** One session output whose stat block joins the claimed union. */
export interface ClaimedSource {
  /** Name used in FLAG reasons (the .out.md basename). */
  name: string;
  text: string;
}

// Owner decision (PR #163 follow-up): a stat block that is abbreviated
// (git's "..." path shortening) or unparseable (a block marker but no
// readable rows) is a FLAG naming the source file, never a PASS — the
// union is only as good as its weakest session output. A file with no
// stat-block markers at all contributes nothing: it belongs to a stopped
// or still-running session.
export function claimedStat(source: ClaimedSource): { files: string[]; bad: string[] } {
  const raw = claimedStatFiles(source.text);
  const files = raw.filter((p) => !p.startsWith("..."));
  const bad = raw
    .filter((p) => p.startsWith("..."))
    .map((p) => `abbreviated git diff --stat path in ${source.name}: ${p}`);
  if (!raw.length && /^\s*\d+ files? changed/m.test(source.text))
    bad.push(`unparseable git diff --stat block in ${source.name}`);
  return { files, bad };
}

export function checkDiffStat(files: DiffFile[], sources: ClaimedSource[] | null): Check {
  if (!sources?.length)
    return na("diff-stat", "no claimed session output (--claimed / saved .out.md not found)");
  const stats = sources.map(claimedStat);
  const claimed = [...new Set(stats.flatMap((s) => s.files))];
  const bad = stats.flatMap((s) => s.bad);
  if (!claimed.length && !bad.length)
    return flag("diff-stat", ["no git diff --stat block found in the claimed output"]);
  const actual = new Set(files.map((f) => f.path));
  const unclaimed = [...actual].filter((p) => !claimed.includes(p));
  const absent = claimed.filter((c) => !actual.has(c));
  // One reason per path so the stdout line can cap at five whole items. A
  // claimed file missing from the PR diff is a mismatch too — FLAG either
  // way.
  const reasons = [
    ...bad,
    ...unclaimed.map((p) => `in diff but not claimed by any session: ${p}`),
    ...absent.map((c) => `claimed but absent from diff: ${c}`),
  ];
  return reasons.length
    ? flag("diff-stat", reasons)
    : pass("diff-stat", `${actual.size} file(s) match the claimed git diff --stat`);
}

// ---------- 11. pr-events ----------

export interface PrEvent {
  event?: string;
  state?: string;
  commit_id?: string;
  user?: { login?: string };
  created_at?: string;
}

export function checkPrEvents(events: PrEvent[] | null, err: string | null): Check {
  if (err !== null) return flag("pr-events", [`could not read PR events: ${err}`]);
  if (events === null) return na("pr-events", "no PR or --events — nothing fetched");
  const reasons: string[] = [];
  for (const e of events) {
    if (e?.event === "head_ref_force_pushed")
      reasons.push(
        `force-push event on the PR head (commit ${e.commit_id ?? "?"}${
          e.created_at ? ", " + e.created_at : ""
        })`,
      );
    if (
      e?.event === "reviewed" &&
      typeof e.state === "string" &&
      e.state.toLowerCase() === "approved" &&
      e.user?.login === "neophylo-conductor[bot]"
    )
      reasons.push(
        `self-approval: review APPROVED by neophylo-conductor[bot]${
          e.created_at ? " at " + e.created_at : ""
        }`,
      );
  }
  return reasons.length ? flag("pr-events", reasons) : pass("pr-events");
}

// ---------- 12. owner-gate ----------

const OWNER_PATHS = [
  /^docs\/superpowers\/specs\//,
  /^fixtures\//,
  /^web\/e2e\/__screenshots__\//,
];
const GATE_FLAG_RE = /OWNER GATE|OWNER REVIEW|owner approves|owner review|Owner step/i;

/** The task's Gate cell in the plan's Task Index table, or null. */
export function gateColumn(planText: string | null, task: string): string | null {
  if (!planText) return null;
  const lines = planText.split("\n");
  const idx = lines.findIndex((l) => /^#{2,3}\s+Task Index/.test(l));
  if (idx < 0) return null;
  const rows: string[][] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^#{1,3} /.test(lines[i])) break;
    if (!lines[i].trim().startsWith("|")) continue;
    rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
  }
  if (rows.length < 2) return null;
  const gate = rows[0].findIndex((c) => /^gate$/i.test(c));
  const num = rows[0].findIndex((c) => c === "#");
  if (gate < 0 || num < 0) return null;
  const row = rows.slice(2).find((r) => r[num] === task);
  return row ? row[gate] : null;
}

export function checkOwnerGate(
  files: DiffFile[],
  title: string,
  planText: string | null,
  task: string,
): Check {
  const reasons: string[] = [];
  if (/\[OWNER[ _-](GATE|REVIEW)\]/i.test(title)) reasons.push(`title tag: "${title}"`);
  const gate = gateColumn(planText, task);
  if (gate && GATE_FLAG_RE.test(gate)) reasons.push(`task ${task} gate column: "${gate}"`);
  const section = planText ? taskSection(planText, task) : null;
  if (section && GATE_FLAG_RE.test(section))
    reasons.push(`task ${task} text mentions an owner gate`);
  for (const f of files)
    if (OWNER_PATHS.some((r) => r.test(f.path)))
      reasons.push(`owner-gated path touched: ${f.path}`);
  return reasons.length ? flag("owner-gate", [...new Set(reasons)]) : pass("owner-gate");
}
