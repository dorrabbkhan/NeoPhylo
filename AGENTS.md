# AGENTS.md — NeoPhylo

NeoPhylo is a browser-based teaching tool for distance-based phylogenetics. It has a Rust core compiled to wasm and a React UI.

**The source of truth is `docs/superpowers/specs/2026-10-15-neophylo-design.md`.** Read the spec sections relevant to your task before writing code. If the spec and this file disagree, the spec wins. If the spec is ambiguous or seems wrong, stop and ask. Do not guess.

## Commands

- **Everything: `./scripts/check.sh` — must pass before every commit.** Add `E2E=1` once Playwright exists and `RPARITY=1` once R export exists.
- Rust tests: `cargo test --workspace`
- Lint: `cargo fmt --check && cargo clippy --workspace -- -D warnings`
- Wasm tests: `wasm-pack test --node crates/neophylo-wasm`
- Generate TS types: `cargo test -p neophylo-wasm export_bindings` (writes to `web/src/engine/generated/`)
- Web: `cd web && npm ci && npm run lint && npm test && npm run build`
- Regenerate fixtures (only when the task says so): `Rscript fixtures/generate.R && bash fixtures/generate_phylip.sh`

## Hard rules

1. **Fixtures are the oracle.** Never edit anything in `fixtures/` by hand, and never change fixtures in the same PR as engine code. If a reference test fails, assume the implementation is wrong. Never set ALLOW_FIXTURE_CHANGE; only the human does.
2. Tests ship in the same PR as the code they test. For engine code, write the test first.
3. In `neophylo-core`, use `libm` for exp/ln/pow, never the `f64` methods (clippy enforces this). Never use `Math.random` or unseeded RNGs anywhere.
4. `neophylo-wasm` contains no logic, only type conversion. Never duplicate engine math in TypeScript.
5. Never hand-edit files in `web/src/engine/generated/`.
6. The engine must not panic on any input. Return `NeoError`.
7. Keep files single-purpose and under ~400 lines. One algorithm per file.
8. Do not add dependencies beyond those named in the spec without saying why in the PR description.

## Workflow

- One task per branch. Name the branch `m<milestone>/<short-task>`, e.g. `m1/nj-trace`.
- Final summary: the spec sections implemented, the tests added, and anything ambiguous you resolved, so the reviewer can check it.
- There is **no GitHub CI** in this project. Wherever the plan says to add a job or step to `.github/workflows/ci.yml`, add the equivalent command to `scripts/check.sh` instead. Skip `CODEOWNERS` and the deploy workflow until told otherwise.
- `./scripts/check.sh` must pass before committing. Do not disable, skip or loosen tests to make it pass.
- Commit on the task branch, but do not push or merge. The human reviews and merges.
- Stay inside the task's scope. Note follow-ups in the PR description instead of doing them.

## Layout

- `crates/neophylo-core/`: all science (seq, sim, dist, tree, newick, algos, compare, error)
- `crates/neophylo-wasm/`: bindings only
- `web/`: React 19 + TS strict + Vite; `src/layout` is pure functions; rendering is SVG
- `exercises/`: lesson JSON files, validated against `exercises/schema.json`
- `fixtures/`: reference outputs plus the scripts that generate them
