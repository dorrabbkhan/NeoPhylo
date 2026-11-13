#!/usr/bin/env bash
# Release checkpoint: run every automated check in one go
# (docs/release-checkpoint.md, "Run the automated checkpoint").
#
#   scripts/checkpoint/run.sh --pr 143 --tag v1.4.1 [--milestone v1.4b] \
#       [--checklist docs/checkpoints/v1.4b-release.md] [--url <deploy>] \
#       [--boot] [--skip-browser] [--skip-mega] [--out <dir>]
#
#   1. preflight.sh   repo, GitHub and CI state          → preflight.md
#   2. browser.sh     the deploy on Chromium/Firefox/WebKit → shots/, print/, meg/
#   3. mega_verify.py MEGA-CC on the exported .meg files  → mega.md
#   4. report.py      report.md + gallery.html
#
# --url defaults to the PR's Netlify deploy preview. --boot adds the
# 1,000-replicate MEGA bootstraps (several extra minutes). Output goes to
# ~/neophylo-checkpoint/<tag>-<timestamp>/ unless --out is given. Read-only
# for the repo and GitHub: nothing is pushed, tagged or dispatched.
set -uo pipefail

pr="" tag="" milestone="" checklist="" url="" out="" boot=0 skip_browser=0 skip_mega=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) pr=$2; shift 2 ;;
    --tag) tag=$2; shift 2 ;;
    --milestone) milestone=$2; shift 2 ;;
    --checklist) checklist=$2; shift 2 ;;
    --url) url=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --boot) boot=1; shift ;;
    --skip-browser) skip_browser=1; shift ;;
    --skip-mega) skip_mega=1; shift ;;
    -h|--help) sed -n 2,19p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$pr" ] && [ -n "$tag" ] || { echo "usage: run.sh --pr N --tag vX.Y.Z [options]" >&2; exit 2; }

root=$(git rev-parse --show-toplevel)
here="$root/scripts/checkpoint"
out=${out:-$HOME/neophylo-checkpoint/$tag-$(date +%Y%m%d-%H%M)}
mkdir -p "$out"
status=0

echo "== 1/4 preflight"
pf=(--pr "$pr" --tag "$tag" --report "$out/preflight.md")
[ -n "$milestone" ] && pf+=(--milestone "$milestone")
[ -n "$checklist" ] && pf+=(--checklist "$checklist")
"$here/preflight.sh" "${pf[@]}" || status=1

if [ -z "$url" ]; then
  url=$(gh pr view "$pr" --json comments \
    -q '[.comments[].body | select(contains("neophylo-netlify-preview"))] | last // ""' \
    | grep -oE 'https://[^ ]+' | head -1)
fi

if [ "$skip_browser" = 0 ]; then
  if [ -z "$url" ]; then
    echo "no deploy URL (pass --url)"; status=1
  else
    echo; echo "== 2/4 browser pass on $url"
    "$here/browser.sh" "$url" "$out" || status=1
  fi
fi

if [ "$skip_mega" = 0 ]; then
  echo; echo "== 3/4 MEGA-CC on the exported .meg files"
  mv=(--meg-dir "$out/meg" --report "$out/mega.md")
  [ "$boot" = 1 ] && mv+=(--boot)
  python3 -I "$here/mega_verify.py" "${mv[@]}" || status=1
fi

echo; echo "== 4/4 report"
python3 -I "$here/report.py" "$out" --title "$tag release checkpoint (PR #$pr)" || status=1

echo
if [ "$status" = 0 ]; then
  echo "AUTOMATED CHECKPOINT: PASS — now do the owner pass in docs/release-checkpoint.md"
else
  echo "AUTOMATED CHECKPOINT: FAILURES — read $out/report.md"
fi
echo "open: $out/gallery.html"
exit "$status"
