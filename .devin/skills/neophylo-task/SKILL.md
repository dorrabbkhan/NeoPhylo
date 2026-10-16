---
name: neophylo-task
description: Implement one numbered task from the NeoPhylo v1 plan, test-first, on its own branch. Usage - /neophylo-task <task number>
---

You are implementing exactly ONE task from `docs/superpowers/plans/2026-10-15-neophylo-v1-plan.md`. The task number is the argument after the command. If no number was given, ask for one and stop.

## Procedure

1. Run `git status`. If the working tree is not clean, stop and tell the user.
2. Run `git checkout main && git pull`, then create a branch named `m<milestone>/task-<N>-<short-name>`.
3. Read, in this order:
   - `AGENTS.md`
   - the plan's "Global Constraints" and "Review Focus" sections
   - the full "### Task <N>:" section
   - every spec section (§) that the task references, in `docs/superpowers/specs/2026-10-15-neophylo-design.md`
4. Check the task's **Interfaces → Consumes** list against the code on main. If anything is missing or has a different name or signature, stop and report. Do not create stand-ins.
5. Write the failing tests exactly as the task lists them, using the plan's values.
6. Run them and confirm they fail for the expected reason. Show the output.
7. Implement the minimum code needed, using the exact names and signatures from **Interfaces → Produces**.
8. Run the full command list from `AGENTS.md` for every area you touched (Rust, wasm, web). Fix until everything is green.
   8b. Compare `git diff --name-only main` with the task's Files block. For every file outside it, add a "Files outside the Files block" line to this task's entry in docs/decisions.md, saying why each was needed. Include it in the same commit.
9. Commit with the message the task specifies, push the branch, and open a PR with `gh pr create` — the PR body is the final summary headings below.
10. Run `gh pr checks --watch` and fix until every GitHub check is green, pushing fixes to the same branch.
11. Finish by reporting the PR URL and the check results, plus the summary under these headings: Task; Spec sections implemented; Tests added; Ambiguities I resolved (or "None"); Follow-ups noticed.

## Rules

- Plan and spec values are authoritative. If a reference or fixture test fails, the implementation is wrong. Re-read the spec formula; never change the expected values.
- Never edit anything under `fixtures/` unless the task is Task 2, or Task 9's golden file.
- Never skip, delete or loosen a test, and never relax a lint rule.
- Do not start work that belongs to any other task. List it under "Follow-ups noticed" instead.
- If the same failure survives 3 different fix attempts, stop and report what you tried.
- Do not add dependencies beyond the plan's Tech Stack without asking first.
