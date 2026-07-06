# bump shell integration for zsh.
#
# Sourced by the bump-managed $ZDOTDIR/.zshrc AFTER the user's real ~/.zshrc has
# run, so bump's hooks are appended last. Emits OSC 133 semantic-prompt markers
# that the bump main process parses to track each terminal's command lifecycle.
# bump strips these markers before anything reaches the screen or the log.
#
# This never runs any user-visible output at source time (keeps Powerlevel10k
# instant prompt happy). If anything here fails, the shell is unaffected.

# Only makes sense in an interactive shell, and only once per shell.
[[ -o interactive ]] || return 0
if [[ -n "$BUMP_SHELL_INTEGRATION_LOADED" ]]; then
  return 0
fi

if ! builtin autoload -Uz add-zsh-hook 2>/dev/null; then
  return 0
fi

BUMP_SHELL_INTEGRATION_LOADED=1

# Precomputed zero-width prompt escapes ( %{ %} tells zsh they take no columns ).
__bump_ps1_a="%{"$'\e'"]133;A"$'\a'"%}"
__bump_ps1_b="%{"$'\e'"]133;B"$'\a'"%}"
__bump_prior_ps1=""

__bump_emit_d() {
  builtin printf '\e]133;D;%s\a' "$1"
}

# base64 keeps arbitrary command lines (newlines, ;, quotes, escapes) safe to
# embed in the marker; bump decodes it on the other side.
__bump_emit_l() {
  builtin emulate -L zsh
  builtin local cmd="${1[1,8192]}" encoded
  encoded=$(builtin printf '%s' "$cmd" | base64 2>/dev/null | tr -d '\n')
  builtin printf '\e]133;L;%s\a' "$encoded"
}

__bump_precmd() {
  builtin local status_code=$?
  builtin emulate -L zsh

  # Report completion of whatever just ran. The bump side ignores a D that was
  # not preceded by a C (e.g. the very first prompt or an empty line), so this
  # is safe to emit unconditionally.
  __bump_emit_d "$status_code"

  # Wrap the prompt so it emits A at the start and B at the end. Re-wrap from
  # the un-wrapped prompt each time so themes that regenerate PS1 keep working
  # and markers never stack.
  __bump_prior_ps1="$PS1"
  PS1="${__bump_ps1_a}${PS1}${__bump_ps1_b}"
}

__bump_preexec() {
  # Restore the un-wrapped prompt before the command runs.
  if [[ -n "$__bump_prior_ps1" ]]; then
    PS1="$__bump_prior_ps1"
  fi
  __bump_emit_l "$1"
  builtin printf '\e]133;C\a'
}

add-zsh-hook precmd __bump_precmd
add-zsh-hook preexec __bump_preexec
