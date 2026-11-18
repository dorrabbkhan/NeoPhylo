---
description: Run one plan task end to end (task → review ∥ CI → judge → fixes → status), never merging.
argument-hint: <version> <task-number>   e.g. v1.3 2
---
Run the conductor loop from CLAUDE.md for plan version $1, task $2.
1. Read the plan file for $1 (mapping in .devin/skills/neophylo-task/SKILL.md; a plan outside the mapping is
   named by path in build-prompt.sh's output), its Global Constraints, its Review Focus, its Task Index
   and Task $2; the spec sections it names; docs/conductor/standing-notes.md; and
   docs/conductor/notes/$1/task$2.md if it exists.
2. Check that the dependencies in the Task Index are merged; if not, say so and stop. If the Task Index
   marks the task OWNER GATE or OWNER REVIEW, run it but stop for the owner before declaring it done.
3. Build every Devin prompt with scripts/conductor/build-prompt.sh (it names the skill by path, puts the
   per-task owner decisions first, then extra instructions, standing notes and the footer; never start a
   prompt with a "/neophylo-…" line) and pipe it into scripts/conductor/devin.sh:
   - task:   `scripts/conductor/build-prompt.sh task $1 $2 | scripts/conductor/devin.sh task $1 $2`
   - review: `scripts/conductor/build-prompt.sh review $1 $2 <PR> [focus.md] | scripts/conductor/devin.sh review $1 $2`
   - fix:    `scripts/conductor/build-prompt.sh fix $1 $2 <PR> required.md | scripts/conductor/devin.sh fix $1 $2`
     (required.md lists the REQUIRED items precisely, with file:line and the exact test values to assert).
   When a session or a CI wait would outlast one tool call, detach it:
   `DEVIN_DETACH=1 scripts/conductor/devin.sh …` then `scripts/conductor/wait-for.sh <out.md>`, and
   `WAIT_CI_DEADLINE_S=540 scripts/conductor/wait-ci.sh <PR>`; a `PENDING`/exit 4 is a re-call, not a
   failure.
4. Follow the loop and judgment rules exactly: `scripts/conductor/judge.sh` first, the `log-reader`
   subagent for long logs. Keep a short running log in
   ~/neophylo-conductor/$1-task$2/conductor-log.md.
5. Finish with scripts/conductor/status-comment.sh and scripts/conductor/notify.sh, then print a summary:
   PR, verdict, CI, fix rounds used, anything the owner must look at (gates, screenshots, diffs).
6. End by calling `scripts/conductor/result.sh $1 $2 <value>` — it appends exactly one last line to
   conductor-log.md and run-plan.sh reads it: `READY <PR>` when the PR is up and only merge remains,
   `ESCALATED` on a STOP or owner-decision escalation, `GATE` at an owner gate, `FAILED` when the task
   could not complete. No other `RESULT:` values; it must be the file's last line.
