#!/usr/bin/env bash
# Release checkpoint, step 1 (docs/release-checkpoint.md): everything about
# the repository, GitHub and CI that a script can check before the owner
# spends time on the release candidate. Read-only — it never pushes,
# merges, tags or dispatches anything.
#
#   scripts/checkpoint/preflight.sh --pr 143 --tag v1.4.1 [--milestone v1.4b] \
#       [--checklist docs/checkpoints/v1.4b-release.md] [--report out.md]
#
# Exit status: 0 no failures (warnings allowed), 1 any failure.
set -uo pipefail

pr="" tag="" checklist="" report="" milestone=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) pr=$2; shift 2 ;;
    --tag) tag=$2; shift 2 ;;
    --milestone) milestone=$2; shift 2 ;;
    --checklist) checklist=$2; shift 2 ;;
    --report) report=$2; shift 2 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$pr" ] && [ -n "$tag" ] || { echo "usage: preflight.sh --pr N --tag vX.Y.Z" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"
version=${tag#v}
today=$(date +%F)
fails=0 warns=0
lines=()

ok()   { lines+=("| ✅ | $1 | ${2:-} |"); printf '[ok  ] %s %s\n' "$1" "${2:+— $2}"; }
bad()  { lines+=("| ❌ | $1 | ${2:-} |"); printf '[FAIL] %s %s\n' "$1" "${2:+— $2}"; fails=$((fails+1)); }
warn() { lines+=("| ⚠️ | $1 | ${2:-} |"); printf '[warn] %s %s\n' "$1" "${2:+— $2}"; warns=$((warns+1)); }

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || { echo "gh is not authenticated" >&2; exit 2; }

# ---------------------------------------------------------------- tag
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  && ok "tag name $tag matches v*.*.* (production deploys only on these)" \
  || bad "tag name $tag" "must match v*.*.* or the deploy job never runs"
git fetch -q --tags origin 2>/dev/null
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  bad "tag $tag does not exist yet" "it already exists locally"
elif [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
  bad "tag $tag does not exist yet" "it already exists on origin"
else
  ok "tag $tag does not exist yet"
fi

# ---------------------------------------------------------------- PR
pj=$(gh pr view "$pr" --json state,title,headRefName,headRefOid,mergeCommit,mergeable,isDraft,url,comments 2>/dev/null) \
  || { bad "PR #$pr" "not found"; pj=""; }
if [ -n "$pj" ]; then
  state=$(jq -r .state <<<"$pj")
  head=$(jq -r .headRefOid <<<"$pj")
  branch=$(jq -r .headRefName <<<"$pj")
  title=$(jq -r .title <<<"$pj")
  preview=$(jq -r '[.comments[].body | select(contains("neophylo-netlify-preview"))] | last // "" | capture("Preview: (?<u>\\S+)").u // ""' <<<"$pj")
  ok "PR #$pr" "$state · ${title:0:70}"
  [ -n "$preview" ] && ok "deploy preview" "$preview" || warn "deploy preview" "no Netlify preview comment on the PR"

  # CI on the PR head.
  checks=$(gh pr view "$pr" --json statusCheckRollup -q .statusCheckRollup 2>/dev/null || echo '[]')
  pending=$(jq '[.[] | select((.status // "COMPLETED") != "COMPLETED")] | length' <<<"$checks")
  failing=$(jq -r '[.[] | select((.status // "COMPLETED") == "COMPLETED")
                        | select((.conclusion // .state) as $c
                                 | ["SUCCESS","SKIPPED","NEUTRAL"] | index($c) | not)
                        | .name // .context] | join(", ")' <<<"$checks")
  total=$(jq length <<<"$checks")
  [ "$total" -gt 0 ] || warn "PR CI" "no checks reported for ${head:0:7}"
  if [ -n "$failing" ]; then bad "PR CI on ${head:0:7}" "failing: $failing"
  elif [ "$pending" -gt 0 ]; then warn "PR CI on ${head:0:7}" "$pending check(s) still running"
  else ok "PR CI on ${head:0:7}" "$total checks green or skipped"; fi

  if [ "$state" = "OPEN" ]; then
    [ "$(jq -r .mergeable <<<"$pj")" = "MERGEABLE" ] \
      && ok "PR is mergeable" || warn "PR mergeable state" "$(jq -r .mergeable <<<"$pj")"
    [ "$(jq -r .isDraft <<<"$pj")" = "false" ] || warn "PR is a draft"
    candidate=$head
    candidate_ref=$branch
  else
    candidate=$(jq -r '.mergeCommit.oid // ""' <<<"$pj")
    candidate_ref=main
    main_head=$(git rev-parse origin/main)
    [ "$candidate" = "$main_head" ] \
      && ok "merge commit is origin/main" "${candidate:0:7}" \
      || warn "origin/main moved past the merge commit" "main ${main_head:0:7}, merge ${candidate:0:7} — tag the commit you checked"
  fi

  # Full matrix (all three browsers, @perf, R parity, fuzz build) on the
  # release candidate: a push to main or a workflow_dispatch run.
  runs=$(gh run list --workflow ci.yml --commit "$candidate" --json databaseId,event,status,conclusion,headBranch 2>/dev/null || echo '[]')
  full=$(jq -r '[.[] | select(.event=="push" or .event=="workflow_dispatch")] | first // empty | "\(.databaseId) \(.status) \(.conclusion)"' <<<"$runs")
  if [ -z "$full" ]; then
    warn "full CI matrix on ${candidate:0:7}" "none yet — run: gh workflow run ci.yml --ref $candidate_ref"
  else
    read -r rid rstatus rconc <<<"$full"
    if [ "$rstatus" != "completed" ]; then
      warn "full CI matrix on ${candidate:0:7}" "run $rid is $rstatus"
    elif [ "$rconc" = "success" ]; then
      webkit=$(gh run view "$rid" --json jobs -q '[.jobs[] | select(.name|test("webkit")) | .conclusion] | unique | join(",")')
      [ "$webkit" = "success" ] \
        && ok "full CI matrix on ${candidate:0:7}" "run $rid green, WebKit included" \
        || bad "full CI matrix on ${candidate:0:7}" "run $rid: WebKit jobs '$webkit'"
    else
      bad "full CI matrix on ${candidate:0:7}" "run $rid concluded $rconc"
    fi
  fi
fi

# ---------------------------------------------------------------- tree
[ -z "$(git status --porcelain)" ] && ok "working tree clean" || warn "working tree has local changes"

# ---------------------------------------------------------------- files
cv=$(sed -n 's/^version: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' CITATION.cff)
cd_=$(sed -n 's/^date-released: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' CITATION.cff)
[ "$cv" = "$version" ] && ok "CITATION.cff version" "$cv" || bad "CITATION.cff version" "'$cv', expected '$version'"
if [ "$cd_" = "$today" ]; then ok "CITATION.cff date-released" "$cd_ (today)"
else warn "CITATION.cff date-released" "$cd_ — set it to the tag date (today is $today)"; fi

if [ -n "$milestone" ]; then
  grep -q -- "$milestone" docs/roadmap.md \
    && ok "docs/roadmap.md mentions $milestone" \
    || warn "docs/roadmap.md" "does not mention $milestone"
fi

for id in $(jq -r '.[].id' web/public/library/index.json); do
  grep -q -- "$id" THIRD_PARTY_NOTICES.md || bad "THIRD_PARTY_NOTICES.md lists $id"
done
ok "THIRD_PARTY_NOTICES.md checked against web/public/library/index.json"

if [ -n "$checklist" ] && [ -f "$checklist" ]; then
  open=$(grep -c '^\s*- \[ \]' "$checklist" || true)
  done_=$(grep -c '^\s*- \[[xX]\]' "$checklist" || true)
  if [ "$open" -eq 0 ]; then ok "$checklist" "all $done_ boxes ticked"
  else
    sections=$(awk '/^## /{h=$0} /^[[:space:]]*- \[ \]/{print h}' "$checklist" | sort -u | sed 's/^## //' | cut -c1-40 | paste -sd ';' -)
    warn "$checklist" "$open open, $done_ ticked — open in: $sections"
  fi
fi

# ---------------------------------------------------------------- GitHub
gates=$(gh pr list --state open --json number,title -q '[.[] | select(.title|test("OWNER (GATE|REVIEW)")) | "#\(.number)"] | join(" ")')
others=$(sed "s/#$pr//" <<<"$gates" | xargs)
[ -z "$others" ] && ok "no other open [OWNER GATE]/[OWNER REVIEW] PRs" \
  || warn "other open owner-gate PRs" "$others"

drafts=$(gh api "repos/$repo/releases?per_page=20" -q '[.[] | select(.draft) | .tag_name] | join(" ")' 2>/dev/null || echo "?")
[ -z "$drafts" ] && ok "no stray draft releases" \
  || warn "draft releases exist" "$drafts — delete stale drafts so the right release is Latest"

# ---------------------------------------------------------------- tools
if command -v megacc >/dev/null; then
  mv_=$(megacc -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [ "$mv_" = "12.1.4" ] && ok "megacc" "$mv_ (fixture version)" \
    || warn "megacc version" "$mv_ — fixtures were made with 12.1.4"
else warn "megacc not on PATH" "the MEGA-CC step will fail"; fi
command -v docker >/dev/null && ok "docker" || warn "docker missing" "browser pass needs it (or CHECKPOINT_LOCAL=1)"
[ -x web/node_modules/.bin/playwright ] && ok "web/node_modules" \
  || warn "web/node_modules missing" "run: (cd web && npm ci)"

echo
echo "preflight: $fails failure(s), $warns warning(s)"
if [ -n "$report" ]; then
  {
    echo "## Preflight ($repo, PR #$pr, tag $tag, $today)"
    echo
    echo "$fails failure(s) · $warns warning(s)"
    echo
    echo "| | Check | Detail |"
    echo "|---|---|---|"
    printf '%s\n' "${lines[@]}"
  } > "$report"
fi
[ "$fails" -eq 0 ]
