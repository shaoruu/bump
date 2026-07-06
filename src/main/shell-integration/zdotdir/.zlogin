# bump zsh shim: .zlogin (login shells, after .zshrc).
#
# Only reached for a login shell that is not interactive (an interactive login
# shell repoints ZDOTDIR at the end of .zshrc, so its .zlogin comes straight
# from the user's directory). See .zshenv for the full rationale.

BUMP_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${BUMP_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zlogin" ]] && builtin source "$ZDOTDIR/.zlogin"

BUMP_USER_ZDOTDIR="$ZDOTDIR"
export BUMP_USER_ZDOTDIR
ZDOTDIR="${BUMP_USER_ZDOTDIR:-$HOME}"
