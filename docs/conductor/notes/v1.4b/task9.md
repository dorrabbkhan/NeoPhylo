# v1.4b Task 9 notes (conductor)

- Exported `.meg` names (follows PR #119): NeoPhylo writes whitespace in labels as `_` and
  reads names literally. Library labels have no whitespace (Task 8 notes), so the round trip
  is exact. Record in `fixtures/worked/mega-notes.md` how MEGA-CC prints underscored names in
  its outputs (as written, or with `_` shown as a space). If it shows them as spaces, the
  follow-up `parity_mega_library.rs` compares names after applying exactly that one rule, in
  one named helper. Don't change `parse_meg` or `write_meg`, and don't add any other name
  normalization.
