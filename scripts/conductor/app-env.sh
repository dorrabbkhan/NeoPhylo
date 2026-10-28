# Source this to act as the neophylo-conductor GitHub App (bash).
# - gh: the wrapper in bin/ goes first on PATH (fresh token per call).
# - git: github.com SSH remotes are rewritten to HTTPS and authenticated
#   by bin/git-credential-neophylo; commits are authored by the bot.
# Used by devin.sh, as-app.sh and start.sh. Your own shell is unaffected.
_neophylo_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/bin" && pwd)"
export PATH="$_neophylo_bin:$PATH"
export GIT_CONFIG_COUNT=3
export GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf" GIT_CONFIG_VALUE_0="git@github.com:"
export GIT_CONFIG_KEY_1="credential.https://github.com.helper" GIT_CONFIG_VALUE_1=""
export GIT_CONFIG_KEY_2="credential.https://github.com.helper" GIT_CONFIG_VALUE_2="$_neophylo_bin/git-credential-neophylo"
export GIT_AUTHOR_NAME="neophylo-conductor[bot]" GIT_COMMITTER_NAME="neophylo-conductor[bot]"
export GIT_AUTHOR_EMAIL="349067912+neophylo-conductor[bot]@users.noreply.github.com"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export NEOPHYLO_ACTOR="neophylo-conductor[bot]"
unset _neophylo_bin
