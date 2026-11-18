/**
 * judge-checks.ts — the mechanical checks judge.ts runs, in the order the
 * conductor efficiency plan (Task 0a) lists them: fixtures, numbers,
 * assertions, skips, files-block, engine-rules, content-numbers,
 * protected-paths, secrets, diff-stat, pr-events, owner-gate. A check that
 * cannot run on part of the diff FLAGs naming the file — never a silent
 * PASS.
 *
 * Checks 5–8 and 10–12 live in judge-checks-gates.ts, split out to keep
 * this file under the ~400-line rule; the section numbers below keep the
 * plan's order. Ported from Epiora's judge-checks.ts with NeoPhylo's
 * fixture paths, keyword list, strict files and skip exceptions.
 */
import { addedLines, isTestFile, uninspectable, type DiffFile } from "./diff-parse.ts";

/** The content checks — also the "could not run" ids on a dead diff. */
export const CONTENT_CHECK_IDS = [
  "fixtures",
  "numbers",
  "assertions",
  "skips",
  "files-block",
  "engine-rules",
  "content-numbers",
  "protected-paths",
  "secrets",
  "diff-stat",
  "pr-events",
  "owner-gate",
] as const;

/** A zero-file or unparseable diff is never a silent PASS: judge.ts
 * FLAGs every check via couldNotRun instead of running them. */
export interface Check {
  id: string;
  status: "PASS" | "FLAG" | "N/A";
  reasons: string[];
}
export const pass = (id: string, why = ""): Check => ({
  id,
  status: "PASS",
  reasons: why ? [why] : [],
});
export const flag = (id: string, reasons: string[]): Check => ({
  id,
  status: "FLAG",
  reasons,
});
export const na = (id: string, why: string): Check => ({ id, status: "N/A", reasons: [why] });

/** "could not inspect <path> (<why>)" for every uninspectable file. */
export const blind = (files: DiffFile[]) =>
  files
    .map((f) => [f, uninspectable(f)] as const)
    .filter((x): x is readonly [DiffFile, string] => x[1] !== null)
    .map(([f, why]) => `could not inspect ${f.path} (${why})`);

// ---------- plan task section + **Files:** block ----------

/** The `### Task <N>:` section text, through the next ##/### heading. */
export function taskSection(planText: string, task: string): string | null {
  const lines = planText.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`### Task ${task}:`));
  if (start < 0) return null;
  let i = start + 1;
  const section: string[] = [lines[start]];
  while (i < lines.length && !/^(#{2,3}) /.test(lines[i])) section.push(lines[i++]);
  return section.join("\n");
}

export function filesBlockPatterns(planText: string, task: string): string[] | null {
  const section = taskSection(planText, task);
  if (section === null) return null;
  const lines = section.split("\n");
  const fb = lines.findIndex((l) => l.includes("**Files:**"));
  if (fb < 0) return null;
  const pats: string[] = [];
  for (const l of lines.slice(fb + 1)) {
    if (l.startsWith("**") || l.startsWith("### ") || /^\s*-\s*\[/.test(l)) break;
    if (!/^\s*-/.test(l) && !/^\s+\S/.test(l)) {
      if (l.trim() === "") continue;
      break;
    }
    // Plans write later entries on a line by bare name, after a full path
    // in the same directory. A bare name resolves against the nearest full
    // path before it on the line; with none before it, it matches that
    // file name in any directory.
    let dir: string | null = null;
    for (const m of l.matchAll(/`([^`]+)`/g)) {
      const p = m[1];
      if (p.includes("/")) {
        dir = p.slice(0, p.lastIndexOf("/") + 1);
        for (const e of expandBraces(p)) pats.push(e);
      } else {
        for (const e of expandBraces(p)) pats.push(dir !== null ? dir + e : "**/" + e);
      }
    }
  }
  return pats.length ? pats : null;
}

/** `a/{x,y}/b` → [`a/x/b`, `a/y/b`] — one level is all plan Files blocks use. */
export function expandBraces(p: string): string[] {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}

const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
// `**` must be marked before the single-`*` pass, or its ".*" would be
// re-matched and collapsed into one path segment (fixtures/usage/** spans
// subdirectories, e.g. <session>/subagents/*.jsonl).
const patToRe = (p: string) =>
  new RegExp(
    "^" +
      esc(p)
        .replace(/^\*\*\//, "\u0000")
        .replace(/\*\*/g, "\u0001")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0001/g, ".*")
        .replace("\u0000", "(?:.*/)?") +
      "$",
  );
export const matchesPat = (pats: string[] | null, path: string) =>
  !!pats && pats.some((p) => patToRe(p).test(path));

export const decisionsAdditions = (files: DiffFile[]) => {
  const dec = files.find((f) => f.path === "docs/decisions.md");
  return dec
    ? dec.hunks
        .flatMap((h) => h.lines)
        .filter((l) => l.kind === "add")
        .map((l) => l.text)
        .join("\n")
    : "";
};

// ---------- 1. fixtures ----------

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function checkFixtures(files: DiffFile[]): Check {
  const reasons = files
    .filter(
      (f) =>
        f.path.startsWith("fixtures/") ||
        f.path.startsWith("web/e2e/__screenshots__/") ||
        ((f.status === "modified" || f.status === "deleted") &&
          (f.path.startsWith("web/src/state/__fixtures__/") ||
            /^crates\/neophylo-core\/tests\/.*golden/.test(f.path))) ||
        /baseline|golden/.test(baseName(f.path)),
    )
    .map((f) => `oracle/baseline file ${f.status}: ${f.path}`);
  return reasons.length ? flag("fixtures", reasons) : pass("fixtures");
}

// ---------- 2. numbers ----------

const NUMBER_KEYWORD_RE =
  /tol|toleran|eps|epsilon|ulp|rtol|atol|1e-|precision|budget|threshold|limit|maxDiff|ratio|bytes|kb|_ms\b|timeout|replicates|gate/i;
const NUM_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
const isStrictNumbers = (p: string) =>
  p === "scripts/check-bundle-size.sh" ||
  p === "web/playwright.config.ts" ||
  /^docs\/superpowers\/(plans|specs)\//.test(p);
const nums = (s: string) => s.match(NUM_RE) ?? [];
const sameNums = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function checkNumbers(files: DiffFile[]): Check {
  const reasons = blind(files);
  for (const f of files) {
    if (uninspectable(f)) continue;
    const strict = isStrictNumbers(f.path);
    for (const h of f.hunks) {
      const relevant = (l: { text: string }) => strict || NUMBER_KEYWORD_RE.test(l.text);
      const rem = h.lines.filter((l) => l.kind === "del" && relevant(l));
      const add = h.lines.filter((l) => l.kind === "add" && relevant(l));
      if (rem.length === add.length && rem.length > 0) {
        for (let i = 0; i < rem.length; i++) {
          const o = nums(rem[i].text);
          const n = nums(add[i].text);
          if (!sameNums(o, n))
            reasons.push(
              `${f.path}:${add[i].line} ${rem[i].text.trim()} → ${add[i].text.trim()}`,
            );
        }
      } else if (rem.length > 0) {
        // Unequal counts or pure removals: a keyworded number left the file
        // (or was replaced wholesale) — that is a changed literal. Pure
        // additions (rem empty) are new code, not a changed literal.
        const o = nums(rem.map((l) => l.text).join(" "));
        const n = nums(add.map((l) => l.text).join(" "));
        if (!sameNums(o, n)) {
          // file:line is the new-side line of the first changed numeric
          // line: the first index whose paired numbers differ, else the
          // first added line past the paired prefix. A pure removal is
          // located at the next new-side line after the removed block.
          let i = 0;
          while (
            i < rem.length &&
            i < add.length &&
            sameNums(nums(rem[i].text), nums(add[i].text))
          )
            i++;
          let lineNo = add[i]?.line;
          if (lineNo === undefined) {
            const at = h.lines.indexOf(rem[rem.length - 1]);
            lineNo =
              h.lines.slice(at + 1).find((l) => l.line > 0)?.line ??
              h.lines.find((l) => l.line > 0)?.line ??
              0;
          }
          reasons.push(
            `${f.path}:${lineNo} numbers changed (${o.join(", ") || "none"} → ${n.join(", ") || "none"})`,
          );
        }
      }
    }
  }
  return reasons.length ? flag("numbers", reasons) : pass("numbers");
}

// ---------- 3. assertions ----------

const ASSERT_CALL_RE = /assert\w*!\s*\(|expect\s*\(|assert\.\w+\s*\(/;
const RUST_EXACT_RE = /assert_eq!\s*\(/;
const RUST_BARE_RE = /assert!\s*\(/;
const JS_EXACT_RE = /\.(toEqual|toStrictEqual|toBe)\s*\(/;
const JS_WEAK_RE = /\.(toMatchObject|toContain|toBeTruthy)\s*\(|objectContaining\s*\(/;
const CLOSE_TO_RE = /\.toBeCloseTo\s*\([^,]+,\s*(\d+)/;

export function checkAssertions(files: DiffFile[]): Check {
  const reasons = blind(files);
  for (const f of files) {
    if (uninspectable(f)) continue;
    for (const h of f.hunks) {
      const rem = h.lines.filter((l) => l.kind === "del" && ASSERT_CALL_RE.test(l.text));
      const add = h.lines.filter((l) => l.kind === "add" && ASSERT_CALL_RE.test(l.text));
      if (rem.length > add.length)
        reasons.push(
          `${f.path} ${h.header}: ${rem.length} assertion call(s) removed, ${add.length} added`,
        );
      if (rem.some((l) => RUST_EXACT_RE.test(l.text))) {
        const weak = add.find((l) => RUST_BARE_RE.test(l.text) && !RUST_EXACT_RE.test(l.text));
        if (weak) reasons.push(`${f.path}:${weak.line} assert_eq! weakened to assert!`);
      }
      if (rem.some((l) => JS_EXACT_RE.test(l.text))) {
        const weak = add.find((l) => JS_WEAK_RE.test(l.text));
        if (weak)
          reasons.push(
            `${f.path}:${weak.line} exact matcher weakened to ${JS_WEAK_RE.exec(weak.text)![0]}`,
          );
      }
      const oldPrec = rem.map((l) => CLOSE_TO_RE.exec(l.text)?.[1]).filter(Boolean).map(Number);
      const newPrec = add.map((l) => CLOSE_TO_RE.exec(l.text)?.[1]).filter(Boolean).map(Number);
      if (oldPrec.length && newPrec.some((n) => oldPrec.some((o) => n < o))) {
        const weak = add.find((l) => {
          const n = Number(CLOSE_TO_RE.exec(l.text)?.[1]);
          return oldPrec.some((o) => n < o);
        });
        reasons.push(
          `${f.path}:${weak!.line} toBeCloseTo precision reduced (${oldPrec.join("/")} → ${newPrec.join("/")})`,
        );
      }
    }
  }
  return reasons.length ? flag("assertions", reasons) : pass("assertions");
}

// ---------- 4. skips ----------

const IGNORE_RE = /#\[ignore/;
const SKIP_RES = [
  /\b(?:describe|context|it|test|suite|xit|xdescribe|xtest|fit|fdescribe)\.(?:only|skip|todo|skipIf|onlyIf|runIf|fixme)\s*\(/,
  /\btest\.fixme\b/,
  /\bskipIf\s*\(/,
  /\bskip\s*\(/, // bats `skip "reason"` and plain skip(
];
const FN_RE = /\bfn\s+(\w+)/;

/** The next fn name after an added `#[ignore` line in the same hunk — a
 * `regen_golden*` attribute block is the allowed exception. */
function ignoreCoversRegen(h: { lines: { kind: string; text: string }[] }, idx: number): boolean {
  for (let i = idx + 1; i < h.lines.length; i++) {
    const m = FN_RE.exec(h.lines[i].text);
    if (m) return m[1].startsWith("regen_golden");
  }
  return false;
}

export function checkSkips(files: DiffFile[]): Check {
  const reasons = blind(files);
  for (const f of files) {
    if (uninspectable(f)) continue;
    const testish = isTestFile(f.path) || f.path.endsWith(".rs");
    if (!testish) continue;
    for (const h of f.hunks)
      for (let i = 0; i < h.lines.length; i++) {
        const l = h.lines[i];
        if (l.kind !== "add") continue;
        if (IGNORE_RE.test(l.text)) {
          if (!ignoreCoversRegen(h, i))
            reasons.push(`${f.path}:${l.line} added ${l.text.trim()}`);
        } else if (SKIP_RES.some((r) => r.test(l.text))) {
          reasons.push(`${f.path}:${l.line} added ${l.text.trim()}`);
        }
      }
  }
  return reasons.length ? flag("skips", reasons) : pass("skips");
}

// ---------- 5. files-block → judge-checks-gates.ts ----------
// ---------- 6. engine-rules, 7. content-numbers, 8. protected-paths →
// ---------- judge-checks-gates.ts

// ---------- 9. secrets ----------

const SECRET_RES = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/,
  /api[_-]?key["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i,
];
// console.log/dbg!/println! of request or record bodies — never echo the line.
const BODY_LOG_RE =
  /\b(console\.(log|info|warn|error|debug)|dbg!|println!|eprintln!)\s*\(.*\b(body|request|record|prompt|payload|messages|api_?key|authorization|secret)\b/i;

export function checkSecrets(files: DiffFile[]): Check {
  const reasons = blind(files);
  for (const f of files) {
    if (uninspectable(f)) continue;
    for (const l of addedLines(f)) {
      if (SECRET_RES.some((r) => r.test(l.text)))
        reasons.push(`possible key/token literal: ${f.path}:${l.line}`);
      else if (BODY_LOG_RE.test(l.text))
        reasons.push(`log of request/record body or key material: ${f.path}:${l.line}`);
    }
  }
  return reasons.length ? flag("secrets", reasons) : pass("secrets");
}

// ---------- 10. diff-stat, 11. pr-events, 12. owner-gate → judge-checks-gates.ts ----------
