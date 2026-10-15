# fixtures/ — reference oracle

The files in this directory are the source of truth that engine code is tested against.

- Do NOT edit any file here by hand.
- Files in `ref/` and `sim_golden.json` change only by re-running `generate.R`, `generate_phylip.sh` or the `regen_golden` test, and only when the current task is Task 2 or Task 9.
- `worked/` files are hand-entered textbook values that a human has verified. Never change them to make a test pass.
- If a test against these files fails, the engine is wrong.
