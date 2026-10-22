#!/usr/bin/env bash
# Rewrites one digest-pinned container image reference inside
# .github/workflows/ci.yml and opens/updates a bump PR, so image changes go
# through CI + review like any other change.
#
# Usage: bump-image-pin.sh <label> <grep-pattern> <new-ref>
#   label        human name for logs/PR text ("r-and-fixtures", "playwright")
#   grep-pattern ERE matching the whole current ref in ci.yml
#   new-ref      full replacement ref, e.g. ghcr.io/.../neophylo-ci-r:1@sha256:...
#
# Env:
#   PR_HEAD  if set, commit is pushed to this existing branch instead of
#            opening a new PR (used to patch a Dependabot PR in place).
#
# Note: commits pushed and PRs opened with GITHUB_TOKEN do not trigger new
# workflow runs — the bump PR will need a close/reopen (or a manual push)
# before its checks run. The pin check still blocks merge until they do.
set -euo pipefail

label="$1"
pattern="$2"
new_ref="$3"
ci=.github/workflows/ci.yml

current="$(grep -oE "$pattern" "$ci" | head -n1 || true)"
if [ -z "$current" ]; then
  echo "bump-image-pin: no $label ref matching '$pattern' in $ci" >&2
  exit 1
fi
if [ "$current" = "$new_ref" ]; then
  echo "bump-image-pin: $label already at $new_ref — nothing to do"
  exit 0
fi

sed -i "s|$current|$new_ref|" "$ci"
echo "bump-image-pin: $label: $current -> $new_ref"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [ -n "${PR_HEAD:-}" ]; then
  git commit -am "ci: bump $label image to $new_ref"
  git push origin "HEAD:$PR_HEAD"
  echo "pushed image bump onto existing branch $PR_HEAD"
  exit 0
fi

branch="ci-images/$label-$(date -u +%Y%m%d)"
git checkout -B "$branch"
git commit -am "ci: bump $label image to $new_ref"
git push -f origin "$branch"

if gh pr list --head "$branch" --json number --jq 'length' | grep -q '^0$'; then
  gh pr create \
    --title "ci: bump $label container image" \
    --body "$(cat <<EOF
Automated image-pin bump from $GITHUB_WORKFLOW.

\`\`\`
$current
-> $new_ref
\`\`\`

Checks do not auto-trigger on bot-opened PRs — close/reopen this PR (or push an empty commit) to run CI before merging.
EOF
)"
else
  echo "bump-image-pin: PR for $branch already exists — updated it instead"
fi
