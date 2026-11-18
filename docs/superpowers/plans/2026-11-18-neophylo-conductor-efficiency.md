# NeoPhylo conductor efficiency (Tasks 0a, 0b) Implementation Plan

**Goal:** cut the conductor's (Claude Code) token spend per task by roughly half before v1.4d Task 1,
without changing what the conductor judges or escalates, and run each task on the cheapest model that
can judge it. Ports Epiora's v1.0 Tasks 0a/0b (`~/Epiora/docs/superpowers/plans/2026-11-17-epiora-v1.0-conductor-efficiency.md`,
itself a port of babelgate v1.5 Tasks 0a/0b, PRs #113, #114, #117, #119, plus babelgate commit 0f9eed2,
"deny six unused built-in tools") and adapts every check to NeoPhylo's rules.

**Spec:** none (build process only, no product code). The "Analysis" section is the evidence; CLAUDE.md
"Judgment rules", "Owner-only actions" and "Owner gates" are the rules the scripts encode, unchanged.

**Tech Stack:** bash; TypeScript run by Node 24's built-in type stripping (`node scripts/conductor/x.ts`,
imports with explicit `.ts` extensions, no enums or namespaces); tests with `node --test`. **No new
dependencies; no new `package.json`.**

**Prerequisite (owner):** merge this plan before Task 0a merges (0a is stacked on it).

---

## Analysis

Measured by the conductor on 2026-11-18 with Epiora's `usage-report.ts` pointed at
`~/.claude/projects/-home-dorrabb-NeoPhylo` (`--since 2026-10-15`; Opus 4/20/0.20/8 per 1M tokens for
input/output/cache-read/cache-write-1h), and with `claude -p "Reply with OK only." --model opus
--output-format json` (input + cache-write + cache-read of the first turn) under three `--settings` files.

| # | Evidence | Consequence |
|---|---|---|
| E1 | 72 sessions, 5,079 turns, **$313.62** API-equivalent ($305.59 Opus). Per-task median: v1.3 **$3.50**, v1.4 **$2.36**; max $21.73 (v1.3 Task 12, 383 turns). | Same order as Epiora before its port ($7.41) and babelgate ($3.32). |
| E2 | Cost by component: cache-read 687.7M × $0.20 = **$138**, cache-write 15.4M × $8 = **$123**, output 3.06M × $20 = **$61**. | Re-reading long contexts and writing tool output into the cache dominate; output is smallest. |
| E3 | Mean context per turn 104.5k; first turn 48.5k. | Long sessions re-read everything each turn. |
| E4 | Tool mix: 1,305+ bash, 304+ diff reads, 218+ Devin calls, 209 file reads, 159 grep, 135 `t3_background_wait`, frequent `gh pr checks` waits. | Mechanical checks and waits are most turns. |
| E5 | `devin.sh` `tee`s the whole Devin transcript into the conductor's context; the conductor hand-assembles every prompt (skill line + standing notes + notes + footer). | Avoidable cache-write and output. |
| E6 | 43 of 72 sessions ($165.75) are `unattributed`: v1.4b/v1.4c sessions rarely start with `/conduct`, and the paths are `~/neophylo-conductor/<v>-task<N>/`. | The usage report must attribute by `devin.sh <kind> <v> <N>` / `build-prompt.sh` calls and `neophylo-conductor/<v>-task<N>` paths. |
| E7 | First turn in this repo: current settings **46.1k** → `disableClaudeAiConnectors` + superpowers off **39.0k** → also denying `Artifact`, `Workflow`, `ScheduleWakeup`, `ReportFindings`, `ShareOnboardingGuide`, `ListAgents` **20.8k**. | −55 % fixed context on every turn (Epiora 44.2k → 19.0k, babelgate 37.8k → 19.7k). |
| E8 | babelgate after the same change: $1.50–$2.36 per task vs a $3.32 median (≈ −40 %). Sonnet sessions priced at half of Opus per token. | Expect ≈ −40–50 % per task from 0a/0b, more on Sonnet tasks. |

**What changes** (each line → task):
1. `judge.sh` runs every mechanical judgment rule on the PR diff and prints ≤ 60 lines → 0a.
2. `devin.sh` prints only the last 30 lines + `PR_URL:`/`STOP:`; full output stays on disk; empty-prompt
   guard; checkout restore; body inside `main()` → 0a.
3. `build-prompt.sh` assembles Devin prompts mechanically → 0a.
4. `wait-ci.sh` blocks on CI and prints only the final table + failing-job tails → 0a.
5. `usage-report.sh` measures it, with NeoPhylo attribution (E6) → 0a.
6. Lean starting context (`.claude/settings.json`), Haiku `log-reader` subagent, bounded waits, one fresh
   headless session per task (`run-plan.sh`) on the model from the plan's **Conductor** column, an explicit
   tool allow-list, a `RESULT:` line, docs → 0b.

**Target:** v1.4d tasks median ≤ $1.50/task (from $2.36–$3.50); first-turn input ≤ 21k in the plain CLI
(E7); the first T3 Code session after 0b merges confirms the six tools are gone there too. After three
v1.4d tasks the conductor posts the before/after comparison on the third task's status comment.

## Model per task (Conductor column)

`run-plan.sh` reads a **Conductor** column in a plan's Task Index (`Opus` → `--model opus`, `Sonnet` →
`--model sonnet`; absent → Opus with a warning). Rule for choosing: **Opus** when the conductor must judge
science against an oracle, numeric tolerances, fixtures, owner-gated content (lesson wording, spoilers,
misconception accuracy), existing-baseline regeneration (stale-baseline and STOP-override risks recorded in
memory), or a release checkpoint; **Sonnet** when the task follows an established pattern and the judge
script plus CI catch the mechanical risks (bindings, plumbing, UI components with their own new baselines,
docs). Owner gates stay owner gates whatever the model.

Applied to the v1.4d plan in this PR (`docs/superpowers/plans/2026-11-18-neophylo-v1.4d-plan.md`):
**Opus** — 2 (oracle fixtures), 3 (engine queries vs oracle), 4 (format, answers, variants), 9 (regenerates
existing header/library baselines), 11, 12 (owner-reviewed content), 15 (release checkpoint);
**Sonnet** — 1, 5, 6, 7, 8, 10, 13, 14. Tasks 0a and 0b: Opus.

## Global Constraints

- **Judgment is unchanged.** Scripts report `PASS`/`FLAG`/`N/A`; a FLAG is never auto-waived; anything a
  script cannot parse is a FLAG naming the check, never a silent PASS. CLAUDE.md "Judgment rules" text stays
  word for word; only "The loop" section and the commands change.
- **No product changes:** nothing under `crates/`, `web/`, `exercises/`, `fixtures/`, `.github/`.
- **Owner-only stays owner-only:** no merge, approve, ruleset or branch-protection change, workflow edit,
  `--dangerously-skip-permissions`, or `bypassPermissions` in any committed setting or script (Devin's own
  `--permission-mode bypass` inside its sandbox in `devin.sh` is unchanged).
- **Privacy:** `usage-report` prints aggregates only, never prompt text, tool inputs or outputs.
- **No network in tests.** `gh` is never called by `node --test`; tests use seeded diffs, JSON and logs.
- Files ≤ ~400 lines (split as Epiora: `diff-parse.ts`, `judge-checks.ts`, `judge-checks-gates.ts`,
  `judge.ts`, `usage-classify.ts`, `usage-render.ts`, `usage-report.ts`).
- **Reference implementation** (read-only, untracked, never committed): `.conductor-ref/epiora/` in the
  checkout (the conductor copies `~/Epiora/scripts/conductor/` and `~/Epiora/.claude/` there and lists the
  directory in `.git/info/exclude`). Port, don't copy blindly: every check below is NeoPhylo's.
- Devin never edits `.claude/**` in 0a; in 0b only the files listed (owner-reviewed PR).

## Task Index

| # | Task | Depends on | Gate | Conductor |
|---|---|---|---|---|
| 0a | `judge`, `wait-ci.sh`, `devin.sh` trimming, `build-prompt.sh`, `usage-report`, baseline | plan merged (stacked) | OWNER REVIEW (process) | Opus |
| 0b | Lean context, bounded waits, `log-reader`, `run-plan.sh` headless per task, docs | 0a | OWNER REVIEW (process, permissions) | Opus |

---

### Task 0a: Judge script, waits, trimmed output, prompt builder, usage report · OWNER REVIEW

**Files:**
- Create: `scripts/conductor/{diff-parse,judge-checks,judge-checks-gates,judge}.ts`, `scripts/conductor/judge.sh`,
  `scripts/conductor/judge.test.ts`, `scripts/conductor/fixtures/judge/*`, `scripts/conductor/wait-ci.sh`,
  `scripts/conductor/build-prompt.sh`, `scripts/conductor/{usage-report,usage-classify,usage-render}.ts`,
  `scripts/conductor/usage-report.sh`, `scripts/conductor/usage-report.test.ts`,
  `scripts/conductor/fixtures/usage/**`, `docs/conductor/usage-baseline-2026-11-18.md`
- Modify: `scripts/conductor/devin.sh`, `scripts/check.sh` (one step: `node --test scripts/conductor/`),
  `docs/decisions.md`

**Interfaces:**
- `judge.sh <PR> <version> <task> [--claimed <devin out.md>]` → `node scripts/conductor/judge.ts --pr …`.
  `judge.ts` also takes `--diff-file <path> --plan <path> --title <s> --claimed <path> --events <json>
  --report-dir <dir>` (offline tests). Plan lookup: `--plan`, else the newest
  `docs/superpowers/plans/*neophylo-<version>-*.md` containing `### Task <task>:`. Stdout ≤ 60 lines:
  `PASS|FLAG|N/A <check-id> <reason> [file:line…]` per check, then `JUDGE: PASS` or `JUDGE: FLAG (<n>)`.
  Full report → `~/neophylo-conductor/<v>-task<N>/judge-<stamp>.md`. Exit 0 all pass, 1 any FLAG, 2 usage
  error. Reasons printed whole.
- Check ids, in this order:
  1. `fixtures` — any file under `fixtures/`; any file under `web/e2e/__screenshots__/` (snapshot baselines);
     any modified or deleted file under `web/src/state/__fixtures__/` (old-link corpora) or
     `crates/neophylo-core/tests/**/golden*`; any file whose name contains `baseline` or `golden`.
  2. `numbers` — a numeric literal changed (removed ↔ added line in the same hunk) on a line matching
     `/tol|toleran|eps|epsilon|ulp|rtol|atol|1e-|precision|budget|threshold|limit|maxDiff|ratio|bytes|kb|_ms\b|timeout|replicates|gate/i`,
     in any file, plus any changed number in `scripts/check-bundle-size.sh`, `web/playwright.config.ts`, a
     plan or a spec. Prints file:line and old → new.
  3. `assertions` — a hunk removes more `assert*!(`/`expect(`/`assert.` calls than it adds; `assert_eq!` →
     `assert!` swaps; `toEqual|toStrictEqual|toBe(` → `toMatchObject|objectContaining|toContain|toBeTruthy`
     swaps; `toBeCloseTo(x, n)` with a smaller `n`.
  4. `skips` — added `#[ignore` (except on a line or the attribute block of a fn named `regen_golden*`),
     `.skip(`, `.only(`, `test.fixme`, `.todo(`, `skipIf`, `describe.skip`, `it.skip`, `test.skip`.
  5. `files-block` — parses the task's `**Files:**` block (`### Task <N>:` section; globs, `{a,b}` braces
     and bare names allowed, a bare name resolved by unique basename); passes when every extra file is named
     (path or unique basename) in a `docs/decisions.md` hunk of the same diff.
  6. `engine-rules` — added `Math.random` under `web/src/`; added `unwrap()`, `.expect(`, `panic!`,
     `unreachable!`, `todo!`, `unimplemented!` on non-test lines of `crates/neophylo-core/src/**` (lines
     inside `#[cfg(test)]` modules excluded); any change under `web/src/engine/generated/` without a change
     under `crates/` in the same diff (hand edit); a modified line inside an existing `proptest!` block or
     strategy fn in `crates/**/tests/*props*.rs` (new functions are fine; saved seeds must stay valid).
  7. `content-numbers` — in changed `exercises/**/*.json`, an added digit sequence inside a `concept`,
     `math`, `reveal`, `text`, `note_after` or `summary` string (FLAG for the conductor to look: lesson
     content must not hard-code data numbers).
  8. `protected-paths` — any change under `.claude/**`, `.devin/**` (outside a task whose Files block names
     it), `LICENSE*`, `AGENTS.md`, `.github/**`.
  9. `secrets` — key/token patterns (never echo the matched text).
  10. `diff-stat` — the PR's file list vs the files the Devin session claimed (`git diff --stat` block in
      `--claimed`, default the newest `~/neophylo-conductor/<v>-task<N>/*.out.md`); N/A when none.
  11. `pr-events` — from `gh api repos/{o}/{r}/issues/<PR>/timeline` (or `--events`): any
      `head_ref_force_pushed` event, and any review with state `APPROVED` by `neophylo-conductor[bot]`
      (Devin self-approval) → FLAG.
  12. `owner-gate` — PR title `[OWNER GATE]`/`[OWNER REVIEW]`; the task's Gate column or text containing
      `OWNER GATE`, `OWNER REVIEW`, `owner approves`, `owner review` or `Owner step`; touched
      `docs/superpowers/specs/**`, `fixtures/**`, `web/e2e/__screenshots__/**`.
- Binary, rename-only or truncated diff entries FLAG every check that cannot inspect them (Review Focus 1).
- `wait-ci.sh <PR>`: port Epiora's (waits ≤ 300 s for a check to register; `gh pr checks --watch
  --fail-fast=false` to a temp file; prints the final table once; for failing checks the job name and the
  last 40 lines of `gh run view --job <id> --log-failed`). Also prints the PR head SHA it waited on and
  exits 3 with `HEAD MOVED` if the head changed or the PR merged meanwhile (memory: owner may merge
  mid-round).
- `devin.sh`: port Epiora's (body in `main()`; empty prompt → exit 2 without a session; restore the
  checkout to the starting branch when no tracked file is modified, never discarding work; stdout =
  `tail -30` + every `PR_URL:`/`STOP:` line, de-duplicated; exit code = Devin's). Keep `DEVIN_CMD`, the
  `REPO` default and `app-env.sh` sourcing unchanged.
- `build-prompt.sh <task|review|fix> <version> <task> [PR|-] [extra-file]` → prompt on stdout, piped into
  `devin.sh`. Order: what to do, naming the skill **by path** (`.devin/skills/neophylo-task/SKILL.md` or
  `neophylo-review`) and the plan path → per-task notes (`docs/conductor/notes/<v>/task<N>.md`, headed as
  authoritative owner decisions; pending notes under `~/neophylo-conductor/<v>-pending/task<N>*.md` too,
  memory "v1.4c pending notes") → extra instructions → standing notes → the fixed NeoPhylo prohibitions
  block (never force-push; never touch `.claude/`; never post a review approval; never install browsers;
  never regenerate a baseline past an explicit STOP) → `footer.md` (review: a
  `VERDICT: <APPROVE|CHANGES REQUIRED>` line instead). Exit 2 on no matching plan or no `### Task <N>:`.
- `usage-report.sh [--since YYYY-MM-DD] [--version vX.Y[,…]] [--json] [--projects-dir <dir>]`: port
  Epiora's (message-id dedup, `subagents/*.jsonl` priced by their own model, price table
  `{opus: 4/20/0.20/8, sonnet: 2/10/0.10/4, haiku: 0.10/0.50/0.01/0.20}` per 1M, per-session/per-task/summary
  tables, Opus-only columns, tool-mix classifier). Attribution, first match wins: `/conduct <v> <N>` in a
  user message; a Bash call `devin.sh <kind> <v> <N>` or `build-prompt.sh <kind> <v> <N>`; a path
  `neophylo-conductor/<v>-task<N>`; `<v>-task<N>` text; else `unattributed`. Versions like `v1.4b`, task
  ids starting with a digit (`0a`, `14`).

- [ ] **Step 1: Tests.** `judge.test.ts`, one seeded diff each: `"fixture change flags"`,
  `"snapshot baseline change flags"`, `"url corpus edit flags"`, `"tolerance number change flags"`,
  `"maxDiffPixelRatio change flags"`, `"bundle budget change flags"`, `"removed assert flags"`,
  `"assert_eq weakened to assert flags"`, `"exact matcher weakened flags"`, `"added ignore attribute flags"`,
  `"regen_golden ignore passes"`, `"added .only flags"`, `"file outside Files block without decisions entry
  flags"`, `"file outside Files block with decisions entry passes"`, `"brace and bare names in Files block
  resolve"`, `"Math.random flags"`, `"unwrap in engine src flags, in cfg(test) passes"`,
  `"generated types edited without crates change flags"`, `"edited existing proptest flags, new fn passes"`,
  `"digits added to lesson prompt text flag"`, `".claude change flags"`, `"api key literal flags"`,
  `"diff stat mismatch with claimed files flags"`, `"force push event flags"`, `"bot self-approval flags"`,
  `"owner gate title, gate column or spec file flags owner-gate"`, `"clean task diff passes all"` (exit 0),
  `"unparseable diff flags, never passes"` (binary + rename-only + truncated → FLAG naming the check,
  exit 1). `usage-report.test.ts`: `"attributes a session by /conduct"`, `"attributes a session by devin.sh
  call"`, `"attributes a session by neophylo-conductor path"`, `"prices a session"` (synthetic 2-turn
  session, exact $), `"dedups content blocks by message id"`, `"first-turn context is the first assistant
  turn's input+cache"`. Shell: `build-prompt.sh` unknown task → exit 2; the prohibitions block is present
  in task, review and fix prompts; `devin.sh` empty prompt → exit 2 without calling `devin` (stub `devin` on
  `PATH`); `wait-ci.sh` with a stub `gh` whose head SHA changes → exit 3 `HEAD MOVED`.
- [ ] **Step 2: Run** `node --test scripts/conductor/` → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Baseline.** The session logs are outside the Devin sandbox: write
  `docs/conductor/usage-baseline-2026-11-18.md` from the conductor-provided output in
  `.conductor-ref/usage-baseline.{txt,json}` if present; otherwise say "baseline: run by the conductor" in
  the PR and leave the file out. Never invent numbers.
- [ ] **Step 5:** `./scripts/check.sh` → PASS. PR `[OWNER REVIEW] chore(conductor): judge script, waits,
  prompt builder, usage report`. **Commit** `chore(conductor): judge script, waits, prompt builder, usage report`.

### Task 0b: Lean context, bounded waits, log reader, headless per-task runs · OWNER REVIEW

**Files:**
- Create: `scripts/conductor/run-plan.sh`, `scripts/conductor/run-plan.test.ts`, `scripts/conductor/headless-tools.txt`,
  `scripts/conductor/wait-for.sh`, `scripts/conductor/result.sh`, `scripts/conductor/fixtures/run-plan/*`,
  `.claude/agents/log-reader.md`
- Modify: `.claude/settings.json`, `.claude/commands/{conduct,run-plan,inbox}.md`, `scripts/conductor/devin.sh`
  (detach), `scripts/conductor/wait-ci.sh` (deadline), `CLAUDE.md`, `docs/conductor/standing-notes.md`,
  `docs/decisions.md`

**Interfaces:**
- Consumes: `judge.sh`, `wait-ci.sh`, `build-prompt.sh`, `usage-report.sh`, trimmed `devin.sh` (0a).
- **Bounded waits** (a foreground tool call is capped at 10 minutes; headless `claude -p` has no
  `t3_background_wait`): `DEVIN_DETACH=1 devin.sh …` starts the session detached (`setsid nohup`), writes
  `<out>.md` then `<out>.rc` on exit, and prints the `.out.md` path. `wait-for.sh <out.md> [max_s=540]`
  blocks until `<out>.rc` exists → prints the 0a trimmed stdout and exits with that rc; after `max_s` prints
  `PENDING <n> lines` and exits 4. `wait-ci.sh` honours `WAIT_CI_DEADLINE_S` the same way (exit 4; a
  re-call resumes). Interactive T3 Code sessions may still use `run_in_background` + one
  `t3_background_wait`.
- `run-plan.sh <version> <from> <to>`: port Epiora's. Tasks in Task Index order (ids like `0b`, `11`;
  contiguous range by table position; Task Index parsed by header name). Model from the **Conductor**
  column. Runs `claude -p "/conduct <version> <id>" --model <m> --allowedTools "<headless-tools.txt
  joined by ,>"` with output to `~/neophylo-conductor/<v>-task<id>/headless-<stamp>.out`, then reads the
  task's `conductor-log.md`: only a line appended by **this** session counts. `RESULT: READY <PR>` → waits
  in bash (`gh pr view <PR> --json state`, every `RUN_PLAN_POLL_S`=300 s, no Claude calls) until `MERGED`
  (`CLOSED` → stop); `ESCALATED|GATE|FAILED` or no new line → stop + `notify.sh`. Before each next task it
  runs `/inbox` the same headless way on Sonnet. `DRY_RUN=1` prints the command and exits 0. Never merges.
- `headless-tools.txt`: one spec per line (`#` comments stripped), mirroring `.claude/settings.json` `allow`
  plus `Bash(scripts/conductor/judge.sh:*)`, `…/wait-ci.sh:*`, `…/wait-for.sh:*`, `…/build-prompt.sh:*`,
  `…/usage-report.sh:*`, `…/result.sh:*`, `Agent(log-reader)`, `Write(~/neophylo-conductor/**)`. Deny list
  unchanged and in force.
- `result.sh <v> <N> <READY <PR>|ESCALATED|GATE|FAILED>` appends the one `RESULT:` line; `/conduct` ends by
  calling it exactly once.
- `.claude/agents/log-reader.md`: `model: haiku`; tools `Read, Bash(grep:*), Bash(tail:*),
  Bash(gh run view:*)`; ≤ 15 lines, every claim with a file:line or job/line pointer, error lines quoted
  verbatim; never judges, never calls anything a flake.
- `.claude/settings.json` adds exactly: `"disableClaudeAiConnectors": true`,
  `"enabledPlugins": {"superpowers@synced": false}`, and `permissions.deny` entries `"Artifact"`,
  `"Workflow"`, `"ScheduleWakeup"`, `"ReportFindings"`, `"ShareOnboardingGuide"`, `"ListAgents"` (E7).
  **Not** `disableBundledSkills` or `skillOverrides` (babelgate measured +6.2k and ≈ 0). Allow list and hook
  unchanged otherwise. Owner note: brainstorming and planning sessions (which use superpowers, Artifact and
  connectors) run with `claude --settings <file>` re-enabling them, or from a checkout of `main` before this
  PR; the conductor's README line says how.

- [ ] **Step 1: Measure before/after.** The `claude` CLI is the conductor's (not in the Devin sandbox): the
  conductor's before/after `claude -p "/context"` numbers are in this task's notes file; record them in
  decisions with what each key saved and what T3 Code injects that settings cannot remove.
- [ ] **Step 2: Scripts.** Tests (stub `claude`, `gh`, `devin` on `PATH`): `run-plan` dry run on
  `fixtures/run-plan/v1.4d-index-with-conductor.md` prints `--model sonnet` for a Sonnet row and
  `--model opus` for an Opus row; a stale `RESULT: READY` from an earlier run with no new line → stops;
  `wait-for.sh` returns `PENDING`/exit 4 before the `.rc` exists and the trimmed tail + rc after;
  `DEVIN_DETACH=1` returns at once with the `.out.md` path.
- [ ] **Step 3: Docs.** CLAUDE.md "The loop": step 2 builds prompts with `build-prompt.sh`; step 3 starts
  the review and `wait-ci.sh` in the background together (one blocking wait each, never a polling loop;
  bounded re-calls in headless runs); step 4 runs `judge.sh` first and reads its FLAGs instead of hand
  greps (judgment-rules text unchanged; `judge.sh` runs the mechanical ones, the rest stay the
  conductor's); long CI/Devin logs go to `log-reader`; the last step calls `result.sh`; `run-plan.sh` for
  ranges; the Conductor-column rule from this plan. `conduct.md`, `run-plan.md` (now: "run
  `scripts/conductor/run-plan.sh`"), `inbox.md` (fix rounds via `build-prompt.sh fix`), standing notes (one
  line: judge.sh checks diff-stat and Files-block deviations mechanically, keep them exact).
- [ ] **Step 4:** `./scripts/check.sh` → PASS. PR `[OWNER REVIEW] chore(conductor): lean context, bounded
  waits, headless per-task runs`. **Commit** `chore(conductor): lean context, bounded waits, headless per-task runs`.

## Review Focus

1. **`judge.sh` meets a diff it can't parse** (binary file, rename-only, a 5k-line truncated diff).
   Expected: a FLAG naming each check that could not run, exit 1, never a silent PASS. → 0a
   `"unparseable diff flags, never passes"`.
2. **A tolerance or budget quietly widened** (`1e-9` → `1e-8`, `maxDiffPixelRatio` 0.001 → 0.002, an
   initial-JS budget raised). Expected: `numbers` FLAG with old → new and file:line. → 0a.
3. **Devin squashes and force-pushes, or approves its own PR.** Expected: `pr-events` FLAG. → 0a.
4. **The owner merges mid-round.** Expected: `wait-ci.sh` exits 3 `HEAD MOVED` instead of reporting a
   stale green. → 0a.
5. **A headless session crashes or is denied a tool** and writes no `RESULT:` (or an old `READY` sits at the
   end of the log). Expected: `run-plan.sh` stops and notifies; never starts the next task. → 0b.
