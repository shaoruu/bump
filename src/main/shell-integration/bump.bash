# bump shell integration for bash.
#
# bump launches bash as `bash --rcfile <this file> -i`. Because that is an
# interactive, NON-login shell, bash would normally read only this file, so we
# first reproduce a login shell's startup to preserve the user's environment,
# then install a PROMPT_COMMAND + DEBUG trap that emit OSC 133 semantic-prompt
# markers. bump strips these markers before anything reaches the screen or log,
# and never edits the user's own dotfiles.
#
# If anything here fails the shell is unaffected; bump just reports "unknown".

# Only meaningful for an interactive shell, and only once per shell.
case "$-" in
  *i*) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac
if [ -n "$BUMP_BASH_INTEGRATION_LOADED" ]; then
  return 0
fi
BUMP_BASH_INTEGRATION_LOADED=1

# Reproduce `bash -l` startup so PATH and the user's login environment match a
# normal terminal: /etc/profile, then the first of the standard profile files.
if [ -r /etc/profile ]; then
  . /etc/profile
fi
for __bump_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -r "$__bump_profile" ]; then
    . "$__bump_profile"
    break
  fi
done
unset __bump_profile

# Shell integration itself is best-effort; never let it abort the rc.
__bump_status=0
__bump_preexec_ready=""

__bump_emit_d() {
  printf '\e]133;D;%s\a' "$1"
}

# base64 keeps arbitrary command lines safe to embed; bump decodes it.
__bump_emit_l() {
  local cmd="${1:0:8192}" encoded
  encoded=$(printf '%s' "$cmd" | base64 2>/dev/null | tr -d '\n')
  printf '\e]133;L;%s\a' "$encoded"
}

# Runs first in PROMPT_COMMAND, so $? is still the finished command's status.
__bump_save_status() {
  __bump_status=$?
}

# Runs last in PROMPT_COMMAND: report completion and arm the DEBUG trap for the
# next command. bump ignores a D not preceded by a C, so emitting on the first
# prompt (or after an empty line) is harmless.
__bump_precmd() {
  __bump_emit_d "$__bump_status"
  __bump_preexec_ready=1
}

# Fires before each command. Only acts on the first command after a prompt.
__bump_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ -z "$__bump_preexec_ready" ] && return
  __bump_preexec_ready=""

  local cmd
  cmd=$(HISTTIMEFORMAT='' builtin history 1 2>/dev/null)
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  cmd="${cmd#*[[:space:]]}"
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"

  __bump_emit_l "$cmd"
  printf '\e]133;C\a'
}

# Wrap the prompt so it emits A at the start and B at the end ( \[ \] mark the
# escapes as zero-width ). Job state relies on C/D, not on this, so a theme that
# regenerates PS1 only loses A/B, never command tracking.
case "$PS1" in
  *'133;A'*) ;;
  *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
esac

# Prepend the status capture and append the completion hook so we see the real
# exit code first and arm the trap last. Support both string and array forms.
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__bump_save_status "${PROMPT_COMMAND[@]}" __bump_precmd)
else
  PROMPT_COMMAND="__bump_save_status;${PROMPT_COMMAND:+${PROMPT_COMMAND%;};}__bump_precmd"
fi

trap '__bump_preexec' DEBUG
