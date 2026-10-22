---
name: neophylo-task
description: Implement one numbered task from a NeoPhylo plan, test-first, on its own branch. Usage - /neophylo-task [plan] <task number>
---

You are implementing exactly ONE task from a plan file. The arguments are `[<plan>] <task number>`. If no task number was given, ask for one and stop.

## Plan selection

Map `<plan>` to a file:

- `v1` → `docs/superpowers/plans/2026-10-15-neophylo-v1-plan.md`
- `v1.1` → `docs/superpowers/plans/2026-10-16-neophylo-v1.1-plan.md`
- `v1.2` → `docs/superpowers/plans/2026-10-19-neophylo-v1.2-plan.md`
- A missing `<plan>` (only a task number was given) means the newest file in `docs/superpowers/plans/` (by date in the filename).

The matching spec is read from the plan's `**Spec:**` line, not hard-coded.

## Procedure

1. Run `git status`. If the working tree is not clean, stop and tell the user.
2. Run `git checkout main && git pull`, then create a branch named `m<milestone>/task-<N>-<short-name>`.
3. Read, in this order:
   - `AGENTS.md`
   - the plan's "Global Constraints" and "Review Focus" sections
   - the full "### Task <N>:" section
   - every spec section (§) that the task references, in the spec file named on the plan's `**Spec:**` line
4. Check the task's **Interfaces → Consumes** list against the code on main. If anything is missing or has a different name or signature, stop and report. Do not create stand-ins.
5. Write the failing tests exactly as the task lists them, using the plan's values.
6. Run them and confirm they fail for the expected reason. Show the output.
7. Implement the minimum code needed, using the exact names and signatures from **Interfaces → Produces**.
8. Iterate with `./scripts/check.sh quick` (fmt + clippy always; tests only for changed areas; the wasm pkg rebuilds only when `crates/**` or `Cargo.lock` changed). Once implementation is complete, run the full `./scripts/check.sh` once before pushing. Fix until everything is green.
   8a. If the change touches `web/src/views`, `web/src/layout` or `web/src/export`, produce the screenshot evidence listed below and attach the images as a PR comment (never commit them).
   8b. Compare `git diff --name-only main` with the task's Files block. For every file outside it, add a "Files outside the Files block" line to this task's entry in docs/decisions.md, saying why each was needed. Include it in the same commit.
9. Commit with the message the task specifies, push the branch, and open a PR with `gh pr create` — the PR body is the final summary headings below.
10. Start `scripts/neophylo-loop.sh watch` so the check watch runs in the background, then run the `/neophylo-review` pass immediately — review overlaps CI, it does not wait for it. Block on `scripts/neophylo-loop.sh await` only before writing the final summary. Fix failures by pushing to the same branch.
11. Finish by reporting the PR URL and the check results, plus the summary under these headings: Task; Spec sections implemented; Tests added; Ambiguities I resolved (or "None"); Follow-ups noticed.

## Rules

- Plan and spec values are authoritative. If a reference or fixture test fails, the implementation is wrong. Re-read the spec formula; never change the expected values.
- Never edit anything under `fixtures/` unless the task is Task 2, or Task 9's golden file.
- Never skip, delete or loosen a test, and never relax a lint rule.
- Do not start work that belongs to any other task. List it under "Follow-ups noticed" instead.
- If the same failure survives 3 different fix attempts, stop and report what you tried.
- Do not add dependencies beyond the plan's Tech Stack without asking first.

## Screenshot evidence (changes to web/src/views, web/src/layout, web/src/export)

Attach screenshots as a PR comment (never committed) covering:

- cytochrome-c tree, rooted and computed after a seeded bootstrap
- the weak-support fixture
- a 4-taxon tree
- the replicate panel
- the bootstrap-basics lesson's final step

Before reporting done, confirm in the comment: no clipped or overlapping labels; all text ≥ 12 px; every leaf visible; displayed counts match the outlines; exports match the screen.
