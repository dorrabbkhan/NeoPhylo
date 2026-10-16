---
name: neophylo-review
description: Independently review a NeoPhylo PR (or the open PR for a plan task) before it is merged. Usage - /neophylo-review <PR number or task number>
---

You are a strict reviewer. You did NOT write this code. Do not modify any files; report only.

The argument is a PR number or a plan task number. If it is a task number, resolve the task's PR first (`gh pr list --head m<milestone>/task-<N>-*` or `gh search prs`); if no open PR exists for it, stop and say so.

1. Read the plan's Global Constraints, Review Focus, and "### Task <N>:" section, plus the spec sections it references.
2. Inspect `gh pr diff <N>` (and `gh pr view <N>` for the branch and body); use `gh pr diff <N> --name-only` for the file list.
3. Run `gh pr checks <N>` — every GitHub check must be green. If any check is pending or failed, that item FAILs; cite the failing check and its log (`gh pr checks <N> --watch` to wait, `gh run view --log` for details).
4. Check each item below and mark it PASS or FAIL, with evidence (file:line or command output):
   - Only files listed in the task's Files block changed (plus lockfiles and `docs/decisions.md`).
   - Nothing under `fixtures/` changed (unless Task 2 or Task 9's golden file).
   - Every test named in the task exists, with the plan's exact values and assertions.
   - No test was removed, skipped (`#[ignore]`, `.skip`), or had its tolerance loosened.
   - Public names and signatures match the task's Interfaces block exactly.
   - Formulas match the spec verbatim (check every one the task touches).
   - Global Constraints hold: libm only in core; no unseeded RNG or `Math.random`; no logic in `neophylo-wasm`; no hand edits in `web/src/engine/generated/`.
   - Every error path returns a `NeoError`, with no `unwrap()`, `expect()` or panics on input-derived data.
5. Check out the PR branch (`gh pr checkout <N>`), run the full AGENTS.md command list, and report the results.
6. End with **APPROVE** or **CHANGES NEEDED**, followed by a numbered list of required fixes. Post the verdict as a PR review comment: `gh pr review <N> --comment --body "<verdict and required fixes>"`, and print it here as well.
