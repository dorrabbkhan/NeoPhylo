# v1.4 Task 10 notes (conductor)

- K2P_PHYLIP ratio (owner decision, 2026-10-26, PR #88): the engine accepts
  any ratio > 0 and, like dnadist, treats a ratio in (0, 0.5] as 0.5 with
  equal frequencies. The settings form must refuse or warn on a ratio ≤ 0.5
  with a readable message ("dnadist treats ratios ≤ 0.5 as 0.5"), and must
  refuse ≤ 0 or non-numeric input. Pin this with a named test (Review
  Focus 1).
