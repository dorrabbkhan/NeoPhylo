# v1.4b Task 8 notes (conductor)

- Labels without whitespace (follows PR #119, the `.meg` writer): `write_meg` writes
  each whitespace character in a label as `_`, and `parse_meg` keeps names literally, so
  a label with a space does not survive `.meg` export and import. Every display label in
  `scripts/data/accessions/*.txt` and in the generated `web/public/library/*.fasta` must
  therefore have no whitespace and no `"` (write `Homo_sapiens`, not `Homo sapiens`), and
  labels must be unique within a dataset. The build script refuses an accession line whose
  label breaks this, with the file and line number. Add a test in `library.test.ts`: every
  library label matches `^[^\s"]+$` and is unique within its dataset.
- Sandbox: keep all scratch in the repo's gitignored `target/scratch/` (also XDG_CONFIG_HOME
  and TMPDIR), use simple commands, commit work in progress often, `git add` files by name
  (never `-A`), and delete sandbox dotfiles. Don't build wasm in the sandbox unless
  `WASM_PACK_CACHE` is set to an absolute writable path; if a check dies on a read-only
  `~/.cargo` or `~/.cache`, stop there and report it; the conductor runs the full check.
