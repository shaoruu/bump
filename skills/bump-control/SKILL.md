---
name: bump-control
description: Control the bump terminal app from the command line via the `bump` CLI - list and read terminals, run commands inside them, track whether commands are running or have succeeded/failed, and manage panes, workspaces, and layouts. Workspaces you create are ephemeral by default and must be named. Use when the user wants to inspect or drive bump's terminals, run a command inside bump (optionally blocking on its exit code with `bump run --wait`), see what is running (`bump ps`) or stream command start/finish events (`bump watch`), read a terminal's recent output, or split/arrange panes and create/switch/rename/close workspaces while bump is open.
---

# bump-control

bump is a terminal app that exposes a localhost control surface while it is
open. The `bump` CLI drives it: list terminals and workspaces, run commands and
read their output, and manage panes, workspaces, and layouts.

Use this skill whenever the user wants to look at or act on what is happening
inside bump - for example "what's running in bump", "run the build in bump",
"show me the output of that terminal", "split this pane and start the dev
server", or "make a new workspace for the api".

## Requirements

- bump must be **open**. The control server only runs while the app is running.
- The `bump` CLI must be installed (on PATH as `bump`). It reads a per-session
  discovery file at `~/.bump/control.json` and talks to `127.0.0.1` with a
  bearer token, so it only works locally on this machine.
- If commands fail with "bump is not running", ask the user to open bump. If
  they use a dev build, pass `--dev` (or set `BUMP_DEV=1`).

## Workflow

1. **Check it is up:** run `bump status` first. Non-zero exit means bump is not
   running.
2. **See the state:** `bump ls` for terminals, `bump ws` for workspaces/panes.
   Do this before creating anything - prefer reusing a workspace you already
   made over spawning another one.
3. **Act:** `bump run` to run commands (`bump run --wait` to block on the exit
   code), `bump read` to inspect output, `bump ps` / `bump watch` to see what is
   running or stream results, and the pane/workspace commands to arrange the UI.
4. **Stay tidy:** follow [Workspace etiquette](#workspace-etiquette) - name
   what you create, group related terminals as panes of one workspace, and
   close what you no longer need.

Add `--json` to any command for machine-readable output that is easy to parse.
IDs are stable strings: terminals look like `term-3`, panes like `a1b2c3`,
workspaces are UUIDs.

## Reading state

`bump status`

```
bump 0.1.0 (pid 48213)
workspaces: 2
terminals:  3
uptime:     12m4s
```

`bump ls` lists terminals with a status column (idle / running / `exit N` for a
failed last command) and the workspace and pane that host them:

```
TERMINAL  STATUS   TITLE  CWD            BRANCH  PID    WORKSPACE  PANE
term-1    running  api    ~/code/api     main    48310  ws-uuid-1  a1b2c3
term-2    exit 1   web    ~/code/web     feat-x  48344  ws-uuid-1  d4e5f6
```

`bump ls --json` (parse this in agents); each terminal carries a compact `job`:

```json
{
  "terminals": [
    {
      "id": "term-1",
      "title": "api",
      "pid": 48310,
      "cwd": "/Users/ian/code/api",
      "gitBranch": "main",
      "logPath": "/Users/ian/.bump/terminals/term-1.log",
      "workspaceId": "ws-uuid-1",
      "paneId": "a1b2c3",
      "job": { "status": "running", "currentCommand": "pnpm dev", "lastExitCode": null }
    }
  ]
}
```

`status` is `idle`, `running`, or `unknown` (shell integration not active).

`bump ws --json` returns each workspace with its pane tree (layout) and the
terminal in every pane:

```json
{
  "workspaces": [
    {
      "id": "ws-uuid-1",
      "name": "api",
      "isActive": true,
      "isEphemeral": false,
      "activePaneId": "a1b2c3",
      "paneTree": {
        "type": "split",
        "id": "split-xyz",
        "direction": "horizontal",
        "children": [
          { "type": "leaf", "paneId": "a1b2c3" },
          { "type": "leaf", "paneId": "d4e5f6" }
        ],
        "sizes": [50, 50]
      },
      "panes": [
        { "paneId": "a1b2c3", "terminalId": "term-1" },
        { "paneId": "d4e5f6", "terminalId": "term-2" }
      ]
    }
  ],
  "activeWorkspaceId": "ws-uuid-1"
}
```

## Running commands

`bump run` sends a command followed by Enter. Put flags **before** the command;
everything after them is the command line.

- `bump run npm test` - run in the active pane's terminal (the focused one).
- `bump run --pane a1b2c3 git status` - run in the terminal hosted by a pane.
- `bump run --workspace ws-uuid-1 pnpm dev` - open a fresh terminal in that
  workspace and run it there.
- `bump run --new --name "api tests" npm test` - open a fresh terminal in a
  new named workspace and run it. Always pass `--name` (without it the
  workspace is named after the command). New workspaces are ephemeral unless
  you add `--keep` - see [Workspace etiquette](#workspace-etiquette).

`bump run --json --new "pnpm dev"` returns the created ids:

```json
{ "workspaceId": "ws-uuid-9", "paneId": "b7c8d9", "terminalId": "term-4" }
```

To send raw keystrokes without a trailing Enter (for example answering a
prompt), use `bump write <terminalId> <text>`.

## Jobs: what is running and whether it failed

bump tracks a job per terminal via shell integration, so it knows whether each
terminal is idle or running a command, what that command is, and the last
command's exit code - for commands you issue **and** commands the user types by
hand. This is the reliable way to react to success/failure instead of scraping
output.

**See what is running** with `bump ps`:

```
TERMINAL  ELAPSED  COMMAND
term-1    12.3s    pnpm build
term-4    1m4s     pnpm test
```

`bump ps --json` -> `{ "jobs": [{ "id": "term-1", "command": "pnpm build", "commandId": 7, "startedAt": 1751762400000, "elapsedMs": 12300 }] }`.

**Run and react to the result** with `bump run --wait`. It blocks until the
command finishes and exits with the command's own exit code, so it composes with
normal shell logic:

```bash
bump run --wait 'pnpm build' && echo "build ok" || echo "build failed"
```

- Add `--timeout 5m` (or `30s`, or a number of seconds) to give up waiting; a
  timeout exits `124`.
- `--wait` runs in the active pane's terminal, or `--pane <id>` for a specific
  one (not `--new`/`--workspace`). It needs the terminal idle; if it is busy you
  get a non-zero "terminal is busy" error.
- `bump run --wait --json 'pnpm build'` prints `{ "command": "pnpm build", "exitCode": 0, "durationMs": 3120 }`.

A single command-exit inspection without blocking: `bump run 'pnpm build'`, wait,
then read the job via `bump ls --json` and check `job.lastExitCode`.

**Watch everything live** with `bump watch` (Ctrl-C to stop):

```
14:02:11  term-1  RUN   pnpm build
14:02:14  term-1  DONE  pnpm build (3.12s)
14:02:20  term-4  FAIL  pnpm test [exit 1] (44.0s)
```

`bump watch --json` emits one JSON object per line (jsonl) - ideal for reacting
to any command finishing or failing across bump:

```bash
bump watch --json | while read -r line; do echo "$line" | jq 'select(.type=="command_end" and .exitCode!=0)'; done
```

Filter to one terminal with `bump watch --terminal term-1`.

## Reading output

`bump read <terminalId>` prints recent output; `--lines N` limits it.

- `bump read term-1 --lines 100`
- `bump read term-1 --json` wraps it: `{ "id": "term-1", "lines": null, "buffer": "..." }`

A good loop for driving a task: `bump run --pane <id> <cmd>`, wait briefly, then
`bump read <terminalId> --lines 200` to see the result.

## Managing panes and workspaces

Panes:

- `bump split <paneId> --dir v --cmd "pnpm dev"` - split a pane (`h` = right,
  `v` = down), optionally starting a command. Returns the new `paneId` and
  `terminalId`.
- `bump focus <paneId>` - focus a pane (switches workspace if needed).
- `bump close-pane <paneId>` - close a pane.
- `bump close-others <paneId>` - close every other pane in the workspace.
- `bump close <terminalId>` - close a terminal (its pane closes with it).

Workspaces:

- `bump ws-new [dir] --name <name>` - create a workspace, optionally in a
  directory. Always pass `--name`; without it the workspace is named after the
  directory. Add `--keep` to make it permanent.
- `bump ws-switch <workspaceId>` - switch to a workspace.
- `bump ws-rename <workspaceId> <name>` - rename a workspace.
- `bump ws-keep <workspaceId>` - make an ephemeral workspace permanent.
- `bump ws-close <workspaceId>` - close a workspace (and its terminals).
- `bump clean` - close every ephemeral workspace whose terminals are all idle.

## Workspace etiquette

Workspaces are the user's tab bar; every one you create takes space on their
screen. Keep it organized:

- **Reuse before creating.** Check `bump ws --json` first. If you already made
  a workspace for this task, run further commands in it
  (`bump run --workspace <id> ...`) instead of creating another one. One task,
  one workspace.
- **Group related terminals as panes, not workspaces.** A dev server plus its
  test runner belong in one workspace as splits: create the workspace once,
  then `bump split <paneId> --cmd "..."` inside it.
- **Name everything you create.** `--name` on `ws-new` and `run --new` should
  describe the task ("api tests", "release build"), so the user never sees a
  tab they cannot place.
- **Ephemeral by default is correct for agent work.** Workspaces created via
  the CLI are marked ephemeral: they show italic in the tab bar, are not
  restored after a restart, and are closed automatically once all their
  terminals have been idle for ~15 minutes. For scratch work (builds, tests,
  one-off checks) just let that happen.
- **Keep only what the user will come back to.** If the user asks for
  something durable (a dev server they will watch, a workspace they asked for
  by name), pass `--keep` or run `bump ws-keep <id>`. Renaming a tab in the UI
  also keeps it.
- **Clean up after yourself.** When a task is done, `bump ws-close` the
  workspaces you created (or `bump close-pane` for extra panes). `bump clean`
  sweeps all idle ephemeral workspaces at once.

## Tips

- Resolve a pane to its terminal (or the active terminal) from `bump ws --json`
  before reading output, since `run`/`read` on a terminal need the `term-*` id.
- Prefer `--json` when you need to parse; the default output is for humans.
- Non-zero exit codes always come with a message on stderr (bump not running,
  unknown id, invalid flag, `bump run --wait` timeout), so check the exit code
  when scripting.
- Prefer the job model (`bump run --wait`, `job.lastExitCode` from
  `bump ls --json`, `bump watch`) over scraping output to decide whether a
  command succeeded. If a terminal's `status` is `unknown`, shell integration is
  not active there, so `--wait` will refuse rather than hang.
- Newly created terminals take a moment to boot their shell; if a command seems
  to have no effect, wait briefly and `bump read` again.
