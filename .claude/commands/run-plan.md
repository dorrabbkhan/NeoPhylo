---
description: Work through a range of plan tasks sequentially, one headless session each, pausing at gates.
argument-hint: <version> <from-task> <to-task>
---
Run `scripts/conductor/run-plan.sh $1 $2 $3`. It starts one fresh headless `/conduct $1 <id>` session per
task in Task Index order, on the model named by the index's Conductor column (Opus by default, with a
warning, when the column is absent), with the explicit `--allowedTools` list in
scripts/conductor/headless-tools.txt — a tool call outside the list fails and the session escalates
instead of improvising. After each session it reads the `RESULT:` line that /conduct appended to the
task's conductor-log.md: `READY <PR>` waits in bash for the owner to merge; `ESCALATED`, `GATE`, `FAILED`
or a missing line stops the run and notifies you. Before each next task it runs `/inbox` the same headless
way on Sonnet. It never merges. Watch the first runs and adjust headless-tools.txt by PR if a legitimate
call fails closed.
