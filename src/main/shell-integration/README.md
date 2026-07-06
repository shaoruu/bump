# bump shell integration

These are runtime assets, not application code. The main process (see
`src/main/pty-manager.ts`) materializes them into `~/.bump[-dev]/shell-integration/`
and points the shells it spawns at them so bump can observe each terminal's
command lifecycle via the [OSC 133 semantic prompt protocol][osc133] (the same
protocol iTerm2, VS Code, and Ghostty use).

bump **never** edits the user's global `~/.zshrc`, `~/.bashrc`, or
`~/.bash_profile`. It injects hooks only into the shells it launches:

- **zsh** — `pty-manager` sets `ZDOTDIR` to `zdotdir/`. Those shim files source
  the user's real startup files first (so their env, prompt, aliases, and
  oh-my-zsh setup are preserved), then source `bump.zsh`, which installs
  `precmd`/`preexec` hooks that emit the OSC 133 markers. `ZDOTDIR` is handed
  back to the user's directory afterwards so nested shells behave normally.
- **bash** — `pty-manager` launches bash with `--rcfile bump.bash`. That file
  reproduces a login shell's startup (sources `/etc/profile` and the user's
  profile) then installs a `PROMPT_COMMAND` + `DEBUG` trap that emit the same
  markers.

The markers emitted are:

- `OSC 133 ; A ST` — prompt start
- `OSC 133 ; B ST` — prompt end / command start
- `OSC 133 ; C ST` — command output begins (command is now running)
- `OSC 133 ; D ; <exitcode> ST` — command finished, with its exit status
- `OSC 133 ; L ; <base64 command line> ST` — bump extension carrying the command
  line captured at `preexec`, base64-encoded so it is safe to embed

`pty-manager` parses these out of the raw PTY stream to drive per-terminal job
state, and removes them so they never reach the renderer or the captured log.

If anything here fails to load, the shell still works exactly as before; bump
just reports the job status as `unknown`.

[osc133]: https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md
