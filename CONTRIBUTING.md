# Contributing to NeoPhylo

Thanks for helping make phylogenetics teachable. This file covers the
workflow; [`AGENTS.md`](AGENTS.md) holds the hard rules (fixtures are the
oracle, `libm` only, no unseeded RNG, the engine never panics, …) and
[`docs/architecture.md`](docs/architecture.md) explains the codebase.

## Workflow

- **Start with an issue.** Bug reports use the bug template; errors in
  lessons or explanatory text use the _Science or teaching content error_
  template (see below).
- **Larger changes go through spec/plan first.** New algorithms, models,
  file-format or UI changes start as a design spec and task plan under
  `docs/superpowers/` before code is written — that's how the project was
  built. Propose the change in an issue and the maintainers will help turn
  it into a spec entry.
- **Small, focused PRs.** One task per branch, named
  `m<milestone>/<short-task>` (or `fix/<what>`, `docs/<what>`). Tests ship
  in the same PR as the code they test — for engine code, write the test
  first.
- **Record deviations.** If your change deviates from the plan, interfaces
  or spec, add a one-entry note to [`docs/decisions.md`](docs/decisions.md)
  in the same commit.
- **Deploys:** `main` deploys to staging (`main--<site>.netlify.app`);
  production updates only on version tags `v*.*.*` or the manual
  "Deploy production" run — Netlify charges credits per production deploy.
  Same-repo PRs get a free `pr-<n>` preview, commented on the PR.
- **Fixtures are sacred.** Never edit anything in `fixtures/` by hand, and
  never change fixtures in the same PR as engine code. If a reference test
  fails, assume the implementation is wrong. Only a human maintainer may
  regenerate fixtures (`FIXTURES=1`) or set `ALLOW_FIXTURE_CHANGE=1`.

## Running checks

`./scripts/check.sh` runs the full suite and must pass before every commit:

```bash
./scripts/check.sh          # fixture guard, rust fmt+clippy+tests,
                            # wasm tests + generated-types diff,
                            # web lint + vitest + build
E2E=1 ./scripts/check.sh    # + Playwright (all three browsers)
RPARITY=1 ./scripts/check.sh# + run the exported R scripts and compare
FUZZ=1 ./scripts/check.sh   # + cargo-fuzz smoke run
```

On Ubuntu 22.04/24.04, `bash setup-ubuntu.sh` installs all prerequisites.

## Dependency licenses

The `licenses` CI job runs `cargo about generate` against
[`about.toml`](about.toml) — any Rust dependency license outside the
`accepted` list fails CI — and `npm run build` applies the same list to
npm production dependencies while generating `licenses.html` (the page
the app footer links to). `cargo-about` is only needed to render the
Rust section locally (`cargo install cargo-about`); without it the build
writes a placeholder section instead of failing.

## Content contributions

Lesson JSON files, prompt text and the Concept/Math explanation layers are
teaching content and get the same review rigor as code:

- **Report errors** with the
  [_Science or teaching content error_](https://github.com/dorrabbkhan/NeoPhylo/issues/new?template=content_error.yml)
  issue template — it asks for the lesson and step, the wrong text, the
  correct text and a reference.
- **New lessons** are JSON files in `exercises/` validated against
  [`exercises/schema.json`](exercises/schema.json); `nj-basics.json` is a
  good template. Lessons are checked by content tests (prompts must anchor
  to real steps, no placeholder text) — run `npm test` in `web/` after
  adding one.

## Contributor License Agreement

All contributors must sign the CLA in [`CLA.md`](CLA.md). On your first pull
request, **CLA Assistant** will prompt you to sign it in the PR — signing is
a one-click step tied to your GitHub account. The CLA grants the project
owner a perpetual, sublicensable copyright and patent license, which keeps
relicensing (e.g. dual-licensing) possible in future.
