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
