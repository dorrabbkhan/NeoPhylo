#!/usr/bin/env bash
# Guards the playwright container pin in ci.yml:
#   1. both job-container images are digest-pinned (a re-tagged image must
#      go through the bump workflows, not a silent tag move)
#   2. the playwright image tag version equals the locked @playwright/test
#      version — the image bakes browser builds keyed to one playwright
#      release, so a mismatch means testing against the wrong browsers.
# Kept file-based (not env-based) so the check also works on a checked-out
# PR that rewrote the image line.
set -euo pipefail

ci=.github/workflows/ci.yml

img_ref="$(grep -oE 'mcr\.microsoft\.com/playwright:v[0-9]+\.[0-9]+\.[0-9]+-noble(@sha256:[0-9a-f]+)?' "$ci" | head -n1)"
[ -n "$img_ref" ] || { echo "check-playwright-image: no playwright image ref in $ci" >&2; exit 1; }
case "$img_ref" in
  *@sha256:*) ;;
  *) echo "check-playwright-image: $img_ref is not digest-pinned" >&2; exit 1 ;;
esac

r_ref="$(grep -oE 'ghcr\.io/[^/@[:space:]]*/neophylo-ci-r:[0-9]+(@sha256:[0-9a-f]+)?' "$ci" | head -n1)"
[ -n "$r_ref" ] || { echo "check-playwright-image: no neophylo-ci-r image ref in $ci" >&2; exit 1; }
case "$r_ref" in
  *@sha256:*) ;;
  *) echo "check-playwright-image: $r_ref is not digest-pinned" >&2; exit 1 ;;
esac

img_ver="$(sed -E 's|.*playwright:v([0-9]+\.[0-9]+\.[0-9]+)-noble.*|\1|' <<<"$img_ref")"
lock_ver="$(node -p "require('./web/package-lock.json').packages['node_modules/@playwright/test'].version")"
if [ "$img_ver" != "$lock_ver" ]; then
  echo "check-playwright-image: image v$img_ver != @playwright/test $lock_ver" >&2
  echo "  bump the image via .github/workflows/bump-ci-image.yml" >&2
  exit 1
fi
echo "playwright image $img_ref matches @playwright/test $lock_ver"

# The job runs on the image's Node; .nvmrc must not drift to a newer major.
want_node="$(head -n1 .nvmrc | tr -d '[:space:]v' | cut -d. -f1)"
have_node="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$want_node" != "$have_node" ]; then
  echo "check-playwright-image: .nvmrc wants Node $want_node but the image has Node $have_node" >&2
  echo "  re-add actions/setup-node inside the e2e container" >&2
  exit 1
fi
