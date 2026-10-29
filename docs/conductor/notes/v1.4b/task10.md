# v1.4b Task 10 notes (conductor)

- Deferred from Task 6 (PR #121 review): `web/src/state/lesson.ts` `correctionValidFor` does not know `"Poisson"`,
  so `reconcileModels` silently rewrites a v4 protein exercise's `Poisson` correction to `Jtt` on load, entering the
  sandbox or switching alphabet. Adding `Poisson` to `CORRECTIONS.protein` (the model menu) fixes the menu path;
  pin a named test that a loaded Poisson protein exercise keeps `Poisson` (and that switching it to a DNA alphabet
  switches it with a notice, Review Focus 4). Same F84 precedent as v1.4 Task 10 fix round 1.
- Likewise make sure a loaded exercise's `analysis.site_filter` drives the analysis (`None` and `{kind:"pairwise"}`
  are identical) and is not dropped by any state round trip (URL `o=`/restore included).
