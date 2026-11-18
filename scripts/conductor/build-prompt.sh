#!/usr/bin/env bash
# Usage: build-prompt.sh <task|review|fix> <version> <task> [PR|-] [extra instructions file]
# Prints a Devin prompt to stdout; pipe it into devin.sh:
#   scripts/conductor/build-prompt.sh task v1.4d 3 | scripts/conductor/devin.sh task v1.4d 3
#   scripts/conductor/build-prompt.sh fix v1.4d 3 63 required.md | scripts/conductor/devin.sh fix v1.4d 3
#
# Order matters (conductor efficiency plan Task 0a). The skill is named by its file path, never as a
# leading "/neophylo-…" line: with a slash command first, Devin expands the skill and may ignore what
# follows it. So: what to do (skill by path) → owner decisions (per-task + pending notes) → extra
# instructions → standing notes → prohibitions → output contract.
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: $0 <task|review|fix> <version> <task> [PR|-] [extra file]" >&2
  exit 2
fi
KIND="$1"; VER="$2"; N="$3"; PR="${4:-}"; EXTRA="${5:-}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
NOTES="$ROOT/docs/conductor/notes/$VER/task$N.md"

# The task skill maps a version to one plan file; a plan outside the
# mapping must be named by path in the prompt so Devin finds it.
case "$VER" in
  v1)    MAPPED="2026-10-15-neophylo-v1-plan.md" ;;
  v1.1)  MAPPED="2026-10-16-neophylo-v1.1-plan.md" ;;
  v1.2)  MAPPED="2026-10-19-neophylo-v1.2-plan.md" ;;
  v1.3)  MAPPED="2026-10-21-neophylo-v1.3-plan.md" ;;
  v1.4)  MAPPED="2026-10-26-neophylo-v1.4-plan.md" ;;
  v1.4b) MAPPED="2026-10-28-neophylo-v1.4b-plan.md" ;;
  v1.4c) MAPPED="2026-11-14-neophylo-v1.4c-plan.md" ;;
  *)     MAPPED="" ;;
esac

PLAN=""
shopt -s nullglob
for f in "$ROOT"/docs/superpowers/plans/*neophylo-"$VER"-*.md; do
  if grep -qE "^### Task $N:" "$f"; then PLAN="$f"; fi
done
shopt -u nullglob
if [ -z "$PLAN" ]; then
  echo "build-prompt.sh: no plan under docs/superpowers/plans/*neophylo-$VER-*.md contains \"### Task $N:\"." >&2
  echo "Available: $(ls "$ROOT"/docs/superpowers/plans/ 2>/dev/null | tr '\n' ' ')" >&2
  exit 2
fi
[ "$PR" = "-" ] && PR=""
need_pr() { [ -n "$PR" ] || { echo "build-prompt.sh: $KIND needs a PR number" >&2; exit 2; }; }

# First line: name the skill by path and the plan by its version alias when
# it is the skill's mapped file, else by path (unmapped plans can't be found
# by the version argument alone).
case "$KIND" in
  task)
    if [ "${PLAN##*/}" = "$MAPPED" ]; then
      echo "Implement plan \`$VER\`, Task $N by following \`.devin/skills/neophylo-task/SKILL.md\` exactly (arguments: \`$VER $N\`)."
    else
      echo "Implement Task $N of the plan \`docs/superpowers/plans/${PLAN##*/}\` (version label \`$VER\`) by following \`.devin/skills/neophylo-task/SKILL.md\`."
      echo "This plan is not in the skill's plan mapping; the plan file is the path given above."
    fi
    ;;
  review)
    need_pr
    if [ "${PLAN##*/}" = "$MAPPED" ]; then
      echo "Review PR #$PR (plan \`$VER\`, Task $N) by following \`.devin/skills/neophylo-review/SKILL.md\` exactly (arguments: \`$VER $PR\`)."
    else
      echo "Review PR #$PR for Task $N of the plan \`docs/superpowers/plans/${PLAN##*/}\` by following \`.devin/skills/neophylo-review/SKILL.md\`."
      echo "This plan is not in the skill's plan mapping; the plan file is the path given above."
    fi
    echo "This is a review session: do not modify files or push. Check the PR out in a separate \`git worktree\`, not in the main checkout."
    ;;
  fix)
    need_pr
    echo "Fix round for PR #$PR (plan \`$VER\`, Task $N). Check out the PR's branch, work only on it and push to it (no new PR, no force-push)."
    echo "Do not re-implement the task; change only what the REQUIRED items below need. Show \`git diff --stat HEAD~1\` matching your claims."
    ;;
  *) echo "usage: $0 <task|review|fix> <version> <task> [PR|-] [extra file]" >&2; exit 2 ;;
esac

if [ -f "$NOTES" ]; then
  echo
  echo "## Owner decisions for this task — authoritative; read before anything else"
  echo
  echo "From \`docs/conductor/notes/$VER/task$N.md\`. Where they approve something a rule or skill would otherwise stop on,"
  echo "they are the \"task says so\" exception, exactly as scoped there and no wider. Do not stop on a question they already answer."
  echo
  cat "$NOTES"
fi

# Owner decisions handed over out of band (memory "v1.4c pending notes"):
# same authority as the per-task notes file above.
shopt -s nullglob
for f in "$HOME"/neophylo-conductor/"$VER"-pending/task"$N"*.md; do
  echo
  echo "## Owner decisions for this task (pending) — authoritative"
  echo
  echo "From \`$f\`."
  echo
  cat "$f"
done
shopt -u nullglob

if [ -n "$EXTRA" ]; then
  echo
  echo "## Instructions"
  echo
  cat "$EXTRA"
fi

echo
echo "## Standing notes"
echo
cat "$ROOT/docs/conductor/standing-notes.md"
echo
echo "## Rules (NeoPhylo prohibitions, always)"
echo
echo "- Never force-push; add new commits instead (squash only before the first push)."
echo "- Never modify, restore, checkout or stage anything under \`.claude/\`. If it is dirty, ignore it (STOP if it blocks the pull)."
echo "- Never post a PR review, approval or self-review comment; never run the review skill on your own PR."
echo "- Never install Playwright browsers or run the full e2e suite."
echo "- Never regenerate a fixture or baseline past an explicit STOP; never change fixtures, tolerances, budgets or snapshot baselines on your own."
echo "- No third-party uploads."
echo

if [ "$KIND" = "review" ]; then
  echo "End with a line \`VERDICT: <APPROVE|CHANGES REQUIRED>\` listing REQUIRED items explicitly."
else
  echo "## Output contract"
  echo
  cat "$ROOT/scripts/conductor/footer.md"
fi
