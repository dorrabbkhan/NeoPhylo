#!/usr/bin/env bash
# Build the bundled font subsets (v1.3 spec §4.1, plan Task 4).
#
# Downloads the pinned upstream releases — Inter 4.1 and JetBrains Mono
# 2.304 — verifies their SHA-256, and runs fonttools `pyftsubset`
# (pinned, inside a venv this script creates) once per weight × subset
# with `--layout-features=kern,tnum --flavor=woff2` over the standard
# Google Fonts unicode ranges for latin, latin-ext, greek and cyrillic.
# `--no-hinting` is added: the bundles must total ≤ 200 KB and hinted
# subsets exceed it; web rendering doesn't rely on hinting.
#
# Outputs land in web/public/fonts/ and are committed; the versions,
# hashes and sizes are recorded in web/public/fonts/README.md.
#
# Usage: scripts/fonts/subset.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FONTTOOLS_VERSION=4.60.1
BROTLI_VERSION=1.1.0

INTER_VERSION=4.1
INTER_URL="https://github.com/rsms/inter/releases/download/v${INTER_VERSION}/Inter-${INTER_VERSION}.zip"
INTER_SHA256=9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e

JBM_VERSION=2.304
JBM_URL="https://github.com/JetBrains/JetBrainsMono/releases/download/v${JBM_VERSION}/JetBrainsMono-${JBM_VERSION}.zip"
JBM_SHA256=6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf

OUT_DIR="web/public/fonts"
BUDGET_BYTES=$((200 * 1024))

# Standard Google Fonts unicode ranges (the css2 API's per-subset
# unicode-range values; the same ranges appear in fonts.css).
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT="U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF"
GREEK="U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF"
CYRILLIC="U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Pinned pyftsubset in an isolated venv — nothing is installed into the
# system/user site-packages.
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q \
  "fonttools==${FONTTOOLS_VERSION}" "brotli==${BROTLI_VERSION}"
SUBSET="$WORK/venv/bin/pyftsubset"

fetch() {
  local url="$1" sha="$2" out="$3"
  curl -fsSL "$url" -o "$out"
  echo "$sha  $out" | sha256sum -c --quiet
}

fetch "$INTER_URL" "$INTER_SHA256" "$WORK/inter.zip"
fetch "$JBM_URL" "$JBM_SHA256" "$WORK/jbm.zip"

# Inter 4.1 ships hinted TrueType statics under extras/ttf/; JetBrains
# Mono under fonts/ttf/. (The Inter extras/otf CFF statics subset ~20%
# larger — the TTFs are the small source once hinting is dropped.)
unzip -q -o "$WORK/inter.zip" -d "$WORK/inter" \
  "extras/ttf/Inter-Regular.ttf" \
  "extras/ttf/Inter-Medium.ttf" \
  "extras/ttf/Inter-SemiBold.ttf"
unzip -q -o "$WORK/jbm.zip" -d "$WORK/jbm" \
  "fonts/ttf/JetBrainsMono-Regular.ttf"

mkdir -p "$OUT_DIR"

subset() { # <source> <name> <unicodes>
  "$SUBSET" "$1" \
    --unicodes="$3" \
    --layout-features=kern,tnum \
    --no-hinting \
    --flavor=woff2 \
    --output-file="$OUT_DIR/$2"
}

for pair in "latin:$LATIN" "latin-ext:$LATIN_EXT" "greek:$GREEK" "cyrillic:$CYRILLIC"; do
  name="${pair%%:*}"
  range="${pair#*:}"
  subset "$WORK/inter/extras/ttf/Inter-Regular.ttf"  "inter-400-$name.woff2"  "$range"
  subset "$WORK/inter/extras/ttf/Inter-Medium.ttf"   "inter-500-$name.woff2"  "$range"
  subset "$WORK/inter/extras/ttf/Inter-SemiBold.ttf" "inter-600-$name.woff2"  "$range"
  subset "$WORK/jbm/fonts/ttf/JetBrainsMono-Regular.ttf" \
    "jetbrains-mono-400-$name.woff2" "$range"
done

total=$(du -cb "$OUT_DIR"/*.woff2 | tail -1 | cut -f1)
if [ "$total" -gt "$BUDGET_BYTES" ]; then
  echo "fonts: $total bytes exceeds the §4.1 200 KB budget" >&2
  exit 1
fi
printf 'fonts: wrote %d woff2 files, %d bytes total (budget %d)\n' \
  "$(ls "$OUT_DIR"/*.woff2 | wc -l)" "$total" "$BUDGET_BYTES"
