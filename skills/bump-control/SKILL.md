---
name: bump-control
description: Control the bump terminal app from the command line via the `bump` CLI - list and read terminals, run commands inside them, and manage panes, workspaces, and layouts. Use when the user wants to inspect or drive bump's terminals, run a command inside bump, read a terminal's recent output, or split/arrange panes and create/switch/rename/close workspaces while bump is open.
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
3. **Act:** `bump run` to run commands, `bump read` to inspect output, and the
   pane/workspace commands to arrange the UI.

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

`bump ls` lists terminals with the workspace and pane that host them:

```
TERMINAL  TITLE      CWD            BRANCH  PID    WORKSPACE  PANE
term-1    api        ~/code/api     main    48310  ws-uuid-1  a1b2c3
term-2    web        ~/code/web     feat-x  48344  ws-uuid-1  d4e5f6
```

`bump ls --json` (parse this in agents):

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
      "paneId": "a1b2c3"
    }
  ]
}
```

`bump ws --json` returns each workspace with its pane tree (layout) and the
terminal in every pane:

```json
{
  "workspaces": [
    {
      "id": "ws-uuid-1",
      "name": "api",
      "isActive": true,
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
- `bump run --new htop` - open a fresh terminal in a new workspace and run it.

`bump run --json --new "pnpm dev"` returns the created ids:

```json
{ "workspaceId": "ws-uuid-9", "paneId": "b7c8d9", "terminalId": "term-4" }
```

To send raw keystrokes without a trailing Enter (for example answering a
prompt), use `bump write <terminalId> <text>`.

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

- `bump ws-new [dir]` - create a workspace, optionally in a directory.
- `bump ws-switch <workspaceId>` - switch to a workspace.
- `bump ws-rename <workspaceId> <name>` - rename a workspace.
- `bump ws-close <workspaceId>` - close a workspace (and its terminals).

## Tips

- Resolve a pane to its terminal (or the active terminal) from `bump ws --json`
  before reading output, since `run`/`read` on a terminal need the `term-*` id.
- Prefer `--json` when you need to parse; the default output is for humans.
- Non-zero exit codes always come with a message on stderr (bump not running,
  unknown id, invalid flag), so check the exit code when scripting.
- Newly created terminals take a moment to boot their shell; if a command seems
  to have no effect, wait briefly and `bump read` again.
