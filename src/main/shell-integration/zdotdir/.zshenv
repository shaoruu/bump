# bump zsh shim: .zshenv
#
# bump points $ZDOTDIR at this directory so it can install its OSC 133 hooks.
# Each shim restores $ZDOTDIR to the user's real directory, sources the matching
# user file (so their environment is untouched), then hands $ZDOTDIR back to
# bump so the next startup stage is read from here too. bump never edits the
# user's own dotfiles.

BUMP_ZDOTDIR="$ZDOTDIR"
: "${BUMP_USER_ZDOTDIR:=${HOME}}"

ZDOTDIR="$BUMP_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshenv" ]] && builtin source "$ZDOTDIR/.zshenv"

# The user's .zshenv may itself relocate ZDOTDIR; track wherever it landed so
# later stages source the right files, then return control to bump's dir.
BUMP_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$BUMP_ZDOTDIR"
export BUMP_USER_ZDOTDIR
