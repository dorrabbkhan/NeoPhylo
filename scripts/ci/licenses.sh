#!/usr/bin/env bash
# License gate + Rust notices for the shipped app (v1.1 release docs §C).
#
# `cargo about generate` scans the workspace's full dependency graph
# against the `accepted` list in about.toml — any crate license outside
# it fails this script — and renders about.hbs into
# web/.licenses/rust-licenses.html, which the web build folds into the
# generated licenses.html (web/scripts/licenses.ts). The npm side of the
# gate lives in that module: `vite build` throws when a production
# dependency carries a license outside the same accepted list.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p web/.licenses
cargo about generate about.hbs > web/.licenses/rust-licenses.html

printf '\nlicenses: all dependency licenses accepted; wrote %s\n' \
  "web/.licenses/rust-licenses.html"
