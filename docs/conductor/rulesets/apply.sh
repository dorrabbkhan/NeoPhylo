#!/usr/bin/env bash
# OWNER ONLY. Run from your own shell (your gh login, not the app's):
#   bash docs/conductor/rulesets/apply.sh
# 1. main: PR + 1 Code Owner approval (not by the last pusher), stale
#    approvals dismissed, no force-push or deletion; repo admins (you)
#    may bypass. The neophylo-conductor app is not a bypass actor.
# 2. v* tags: only repo admins (you) may create, move or delete them,
#    so only you can trigger a tag deploy.
# 3. production environment: you must approve every production deploy
#    (a tag push or a dispatch on main), so the app's Actions permission
#    cannot deploy on its own. Existing branch/tag policies are kept.
set -euo pipefail
cd "$(dirname "$0")"
R=repos/dorrabbkhan/NeoPhylo
case "$(gh api user -q .login)" in
  dorrabbkhan) ;;
  *) echo "run this as dorrabbkhan, not through scripts/conductor" >&2; exit 1 ;;
esac
gh api -X PUT "$R/rulesets/25397200" --input main.json -q '"main ruleset: \(.rules | map(.type) | join(", "))"'
existing=$(gh api "$R/rulesets" -q '.[] | select(.name == "release tags") | .id')
if [ -n "$existing" ]; then
  gh api -X PUT "$R/rulesets/$existing" --input tags.json -q '"tag ruleset updated: \(.conditions.ref_name.include | join(", "))"'
else
  gh api -X POST "$R/rulesets" --input tags.json -q '"tag ruleset created: \(.conditions.ref_name.include | join(", "))"'
fi
gh api -X PUT "$R/environments/production" --input production-env.json -q '"production: \(.protection_rules | map(.type) | join(", "))"'
