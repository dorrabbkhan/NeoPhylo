# Setting up the conductor (Claude Code + local Devin)

## 1. Install and sign in (once)
- Install Claude Code following the official docs (https://code.claude.com/docs). It needs a Claude
  subscription or an Anthropic API key.
- Confirm the local Devin CLI works non-interactively: `devin --help`. Adjust DEVIN_CMD in
  scripts/conductor/devin.sh if its flags differ.
- `gh auth status` must show your account (the conductor uses gh for PRs and comments).
- Run it all as the dedicated, repo-scoped user/container you set up for unattended Devin runs (not your
  everyday account).

## 2. Add these files to the repo
Copy CLAUDE.md, .claude/, scripts/conductor/ and docs/conductor/ into ~/NeoPhylo, then commit them on a
branch and open a PR (you merge it). Add `.claude/settings.local.json` to .gitignore.

## 3. Start it
```bash
cd ~/NeoPhylo
tmux new -s conductor          # keeps it running if you close the terminal
claude                         # interactive; then type:  /conduct v1.3 2
```
or fully headless for one task: `claude -p "/conduct v1.3 2"`.
For a range: `/run-plan v1.3 2 6` (pauses at gates; waits for your merges).

## 4. Talking to it
Comment on the PR:
- `conductor: fix the label overlaps at 768px; keep the baselines unchanged`
- `conductor: rerun review`
- `conductor: continue` (after you answered an "Owner decision needed" comment)
- `conductor: hold` / `conductor: next`
In the tmux window, run `/inbox` (or let /run-plan poll it). Watch the sticky "Conductor status" comment on
each PR for the verdict, CI state and what needs your eyes.

## 5. What stays yours
Merging (or enabling auto-merge), Code Owner approvals, owner gates (fixtures, baselines, icon), sign-off
lines in decisions.md, hands-on checkpoints, and release tags. The permission file denies these to the
conductor.
