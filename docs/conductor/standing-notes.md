Verify every write with git diff before committing. Use ./scripts/check.sh quick while iterating and the
default check before pushing. If a parity test, premise or budget fails, stop and report (STOP: line); don't
change tolerances, fixtures, budgets or snapshot baselines on your own. For any UI change: attach screenshots
as PR comments (not committed files), update snapshot baselines when the plan says so, and list every changed
scene in the PR description. Record any file outside the task's Files block in docs/decisions.md. No changes
under crates/ unless the task is about the engine.
