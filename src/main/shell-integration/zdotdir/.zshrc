# bump zsh shim: .zshrc (interactive shells).
#
# Sources the user's real .zshrc first (preserving their prompt, aliases, and
# oh-my-zsh setup), then installs bump's OSC 133 hooks so they are registered
# last. Finally hands $ZDOTDIR back to the user's directory so any nested shell
# started from here behaves like a normal login of theirs (no bump hooks).

BUMP_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${BUMP_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshrc" ]] && builtin source "$ZDOTDIR/.zshrc"

BUMP_USER_ZDOTDIR="$ZDOTDIR"
export BUMP_USER_ZDOTDIR

# Install bump's hooks. BUMP_ZSH_HOOK is set by the bump main process; fall back
# to the file shipped next to this shim directory.
if [[ -n "$BUMP_ZSH_HOOK" && -f "$BUMP_ZSH_HOOK" ]]; then
  builtin source "$BUMP_ZSH_HOOK"
elif [[ -f "$BUMP_ZDOTDIR/../bump.zsh" ]]; then
  builtin source "$BUMP_ZDOTDIR/../bump.zsh"
fi

ZDOTDIR="${BUMP_USER_ZDOTDIR:-$HOME}"
