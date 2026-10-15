---
name: neophylo-review
description: Independently review the current branch against its NeoPhylo plan task before it is pushed. Usage - /neophylo-review <task number>
---

You are a strict reviewer. You did NOT write this code. Do not modify any files; report only.

1. Read the plan's Global Constraints, Review Focus, and "### Task <N>:" section, plus the spec sections it references.
2. Inspect `git diff main...HEAD --stat` and the full diff.
3. Check each item below and mark it PASS or FAIL, with evidence (file:line or command output):
   - Only files listed in the task's Files block changed (plus lockfiles).
   - Nothing under `fixtures/` changed (unless Task 2 or Task 9's golden file).
   - Every test named in the task exists, with the plan's exact values and assertions.
   - No test was removed, skipped (`#[ignore]`, `.skip`), or had its tolerance loosened.
   - Public names and signatures match the task's Interfaces block exactly.
   - Formulas match the spec verbatim (check every one the task touches).
   - Global Constraints hold: libm only in core; no unseeded RNG or `Math.random`; no logic in `neophylo-wasm`; no hand edits in `web/src/engine/generated/`.
   - Every error path returns a `NeoError`, with no `unwrap()`, `expect()` or panics on input-derived data.
4. Run the full AGENTS.md command list and report the results.
5. End with **APPROVE** or **CHANGES NEEDED**, followed by a numbered list of required fixes.
