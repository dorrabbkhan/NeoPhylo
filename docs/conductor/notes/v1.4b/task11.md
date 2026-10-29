# v1.4b Task 11 notes (conductor)

- `.meg` export renames labels with whitespace (follows PR #119): `write_meg` writes each
  whitespace character as `_` and refuses labels that would collide after that (`a b` and
  `a_b`), empty labels and labels containing `"`. The export must not change names silently:
  when any label contains whitespace, show a notice with the existing notice component, e.g.
  "2 taxon names contain spaces; they are written with underscores (Homo_sapiens)". A refused
  export shows the engine's error message. Pin both with named tests (ExportMenu unit test
  plus a case in `meg.spec.ts`). The "export then import is the same alignment" test uses
  labels without whitespace; add a separate case where `Homo sapiens` comes back as
  `Homo_sapiens`.

- Deferred from Task 6 (PR #121 review): the editor drops `analysis.site_filter`. `PreservedFields` /
  `exerciseToDraft` in `web/src/editor/draft.ts` carry only `reference`/`locked`/`bootstrap`, and
  `exerciseFile.ts` saves `schema_version: 3` with a fresh `{correction, method}` analysis. Task 11's editor
  model/filter options must carry `site_filter` (and a `Poisson` correction) through import → save, write
  `schema_version: 4` exactly when a v4-only field is used, and pin both with named tests (import a v4 file with
  `{kind:"partial", cutoff_pct:95}`, save, reload: identical).
