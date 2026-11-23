#!/usr/bin/env bash
# Shared Task Index parsing for the conductor scripts (v1.5 plan Task 1).
#
# Sourced by run-plan.sh for parse_index() and resolve_plan(); executed
# directly for the query subcommand:
#
#   plan-index.sh devin <version> <task>
#       Prints the task row's Devin column — the model devin.sh passes as
#       --model. Prints an empty line when the plan has no Devin column or
#       the cell is empty. Exit 2 when no plan matches the version or the
#       task id is not in the Task Index.
#
# Rows are emitted as id<TAB>conductor<TAB>has-conductor<TAB>devin.
# Columns are located by header name, so extra columns (Depends on, Gate,
# …) can sit anywhere. The id column is "#" when the table has one, else
# "Task".

# --- the Task Index table as "id<TAB>model<TAB>has-conductor<TAB>devin"
#     per row ---
parse_index() {
  awk '
    /^##[[:space:]]+Task Index/ { inix=1; next }
    inix && /^[[:space:]]*\|/ {
      n = split($0, f, "|")
      if (!hdr) {
        for (i = 1; i <= n; i++) {
          h = f[i]; gsub(/^[ \t]+|[ \t]+$/, "", h)
          if (h == "#") cid = i
          if (h == "Task") ctask = i
          if (h == "Conductor") cmod = i
          if (h == "Devin") cdev = i
        }
        if (!cid) cid = ctask
        hdr = 1; next
      }
      id = f[cid]; gsub(/^[ \t]+|[ \t]+$/, "", id)
      if (id ~ /^-+$/) next
      mod = cmod ? f[cmod] : ""
      gsub(/^[ \t]+|[ \t]+$/, "", mod)
      dev = cdev ? f[cdev] : ""
      gsub(/^[ \t]+|[ \t]+$/, "", dev)
      printf "%s\t%s\t%s\t%s\n", id, mod, (cmod ? 1 : 0), dev
      next
    }
    inix && hdr { exit }
  ' "$1"
}

# --- resolve_plan <version> <id> [id …]: the plan file under
#     docs/superpowers/plans/*neophylo-<version>-*.md whose Task Index
#     contains every given id; PLAN_FILE=<path> overrides discovery.
#     Prints the path; fails (2) when zero or several plans match.
resolve_plan() {
  local prog ver f ids want plan=""
  prog="$(basename "$0")"; ver="$1"; shift
  # "5 and 6" — keeps run-plan.sh's two-id messages verbatim.
  local ids_str have
  ids_str="$(printf '%s and ' "$@")"; ids_str="${ids_str% and }"
  if [ "$#" -gt 1 ]; then have="both $ids_str"; else have="$ids_str"; fi
  if [ -n "${PLAN_FILE:-}" ]; then
    [ -f "$PLAN_FILE" ] || { echo "$prog: PLAN_FILE $PLAN_FILE does not exist" >&2; return 2; }
    printf '%s\n' "$PLAN_FILE"
    return 0
  fi
  local root
  root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
  shopt -s nullglob
  for f in "$root"/docs/superpowers/plans/*neophylo-"$ver"-*.md; do
    ids="$(parse_index "$f" | cut -f1)"
    for want in "$@"; do
      grep -qx "$want" <<<"$ids" || continue 2
    done
    if [ -n "$plan" ]; then
      echo "$prog: tasks $ids_str appear in the Task Index of more than one plan ($plan, $f)" >&2
      shopt -u nullglob
      return 2
    fi
    plan="$f"
  done
  shopt -u nullglob
  if [ -z "$plan" ]; then
    echo "$prog: no plan under docs/superpowers/plans/*neophylo-$ver-*.md has $have in its Task Index" >&2
    return 2
  fi
  printf '%s\n' "$plan"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  case "${1:-}" in
    devin)
      if [ "$#" -ne 3 ]; then
        echo "usage: plan-index.sh devin <version> <task>" >&2
        exit 2
      fi
      PLAN="$(resolve_plan "$2" "$3")" || exit 2
      if ! parse_index "$PLAN" | cut -f1 | grep -qx "$3"; then
        echo "plan-index.sh: no task $3 in the Task Index of $PLAN" >&2
        exit 2
      fi
      parse_index "$PLAN" | awk -F'\t' -v id="$3" '$1 == id { print $4; exit }'
      ;;
    *)
      echo "usage: plan-index.sh devin <version> <task>" >&2
      exit 2
      ;;
  esac
fi
