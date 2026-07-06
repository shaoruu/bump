# bump zsh shim: .zprofile (login shells). See .zshenv for the full rationale.

BUMP_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${BUMP_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zprofile" ]] && builtin source "$ZDOTDIR/.zprofile"

BUMP_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$BUMP_ZDOTDIR"
export BUMP_USER_ZDOTDIR
