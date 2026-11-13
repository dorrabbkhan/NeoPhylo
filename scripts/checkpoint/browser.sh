#!/usr/bin/env bash
# Release-checkpoint browser pass (docs/release-checkpoint.md, step 3).
#
#   scripts/checkpoint/browser.sh <deploy-url> <out-dir> [playwright args…]
#
# Drives the deployed release candidate on Chromium, Firefox and WebKit
# with scripts/checkpoint/browser/release.spec.ts. Runs inside the same
# pinned Playwright image CI uses (read from .github/workflows/ci.yml), so
# no local browser install is needed — only Docker and `npm ci` in web/.
# Set CHECKPOINT_LOCAL=1 to use locally installed Playwright browsers
# instead.
#
# The specs are staged into <out-dir>/stage next to a symlink to
# web/node_modules, so nothing is written inside the repository.
set -euo pipefail

url=${1:?usage: browser.sh <deploy-url> <out-dir> [playwright args…]}
out=${2:?usage: browser.sh <deploy-url> <out-dir> [playwright args…]}
shift 2

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
mkdir -p "$out"
out=$(cd "$out" && pwd)

if [ ! -x "$repo/web/node_modules/.bin/playwright" ]; then
  echo "web/node_modules is missing: run (cd web && npm ci) first" >&2
  exit 2
fi

stage="$out/stage"
rm -rf -- "$stage"
mkdir -p "$stage"
cp "$repo"/scripts/checkpoint/browser/*.ts "$stage/"
ln -s "$repo/web/node_modules" "$stage/node_modules"

run=(node_modules/.bin/playwright test -c playwright.config.ts "$@")
envs=(-e "CHECKPOINT_URL=$url" -e "CHECKPOINT_OUT=$out" -e "CHECKPOINT_REPO=$repo")

if [ "${CHECKPOINT_LOCAL:-0}" = "1" ]; then
  cd "$stage"
  CHECKPOINT_URL=$url CHECKPOINT_OUT=$out CHECKPOINT_REPO=$repo "${run[@]}"
  exit $?
fi

image=$(grep -oE 'mcr\.microsoft\.com/playwright:[^ ]+' "$repo/.github/workflows/ci.yml" | head -1)
if [ -z "$image" ]; then
  echo "could not read the Playwright image from ci.yml" >&2
  exit 2
fi
command -v docker >/dev/null || { echo "docker is required (or CHECKPOINT_LOCAL=1)" >&2; exit 2; }

echo "browser pass: $url → $out (image ${image%@*})"
# Same absolute paths inside the container, so the node_modules symlink and
# the repo paths the specs read resolve unchanged. The repo is read-only.
# --network host: Docker's default bridge has no IPv6 route, and Netlify
# resolves to IPv6 first on IPv6-preferring networks — on the bridge every
# navigation then times out (NS_ERROR_NET_TIMEOUT, ENETUNREACH), which
# looks like a broken app. The host network reaches the deploy exactly as
# a browser on this machine does.
docker run --rm --init --ipc=host --network host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$repo:$repo:ro" -v "$out:$out" \
  -w "$stage" "${envs[@]}" \
  "$image" "${run[@]}"
