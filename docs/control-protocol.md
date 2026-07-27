# bump control protocol

While bump is open, its main process runs a small HTTP control server on
`127.0.0.1`. The `bump` CLI (see `cli/`) talks to it, and through the CLI a
Cursor agent can inspect and drive bump. This document is the single
source of truth for the wire protocol, since the Go CLI does not share the
TypeScript types.

## Discovery

On startup the server writes a discovery file to `$BUMP_DIR/control.json`, where
`BUMP_DIR` is `~/.bump` for a packaged build and `~/.bump-dev` in development:

```json
{
  "port": 7317,
  "token": "b3f1…",
  "pid": 48213,
  "startedAt": "2026-07-06T00:00:00.000Z"
}
```

- `port` - TCP port on `127.0.0.1`. The server prefers `7317` and falls back to
  an ephemeral port if it is taken, so always read the port from this file.
- `token` - per-session bearer token (regenerated on every launch).
- The file is written with `0600` permissions and removed on quit.

## Base URL and authentication

- Base URL: `http://127.0.0.1:<port>`.
- Every request except `GET /status` must send `Authorization: Bearer <token>`.
- The server rejects any request whose `Host` header is not localhost, and any
  request that carries an `Origin` header (browsers always send one on
  cross-origin fetches; the CLI never does). Together with the token this blocks
  DNS-rebinding and drive-by requests from web pages.

## Response envelope

Every response is JSON with a consistent envelope and an accurate HTTP status.

Success (`200`):

```json
{ "ok": true, "data": { /* endpoint-specific */ } }
```

Failure (`4xx`/`5xx`):

```json
{ "ok": false, "error": "human-readable message" }
```

Status codes: `200` ok, `400` bad request body, `401` missing/invalid token,
`403` failed host/origin check, `404` unknown route or terminal, `405` method
not allowed, `500` internal or renderer error (for example the bump window is
not available).

## Data shapes

`paneTree` is a binary tree describing a workspace layout:

```ts
type PaneNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      children: [PaneNode, PaneNode];
      sizes: [number, number];
    };
```

## Job model (OSC 133 shell integration)

bump makes every terminal an observable job. It injects hooks into the shells it
spawns (never the user's global dotfiles) that emit
[OSC 133 semantic-prompt markers](https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md):

- `OSC 133 ; A ST` — prompt start
- `OSC 133 ; B ST` — prompt end / command start
- `OSC 133 ; C ST` — command output begins (the command is now running)
- `OSC 133 ; D ; <exitcode> ST` — command finished, with its exit status
- `OSC 133 ; L ; <base64 command line> ST` — a bump extension carrying the
  command line captured at `preexec`

(`OSC` = `ESC ]`, `ST` = `ESC \` or BEL.) zsh integration is injected via a
`ZDOTDIR` shim that sources the user's real startup files first; bash via
`--rcfile`. The main process parses these markers out of the raw PTY stream to
drive job state and strips them so they never reach the renderer or the log. A
`D` not preceded by a `C` (the first prompt, or an empty line) is ignored rather
than counted as a command.

If integration does not load, a terminal's `status` stays `"unknown"` and it
behaves exactly as before.

A terminal's job is `{ status, currentCommand, lastCommand, lastExitCode, startedAt, endedAt, commandCount }`:

- `status` — `"idle" | "running" | "unknown"`.
- `currentCommand` — the command line while `running`, else `null`.
- `lastCommand` / `lastExitCode` — the most recently finished command and its
  exit code.
- `startedAt` / `endedAt` — epoch milliseconds for the current or last command.
- `commandCount` — monotonically increasing per-terminal command counter, also
  used as the per-command id.

## Endpoints

### `GET /status`

Unauthenticated liveness ping.

`data`: `{ version, pid, terminalCount, workspaceCount, uptimeMs }`.

### `GET /terminals`

List every live terminal, joined with the workspace/pane that hosts it.

`data.terminals[]`: `{ id, title, pid, cwd, gitBranch, logPath, workspaceId, paneId, job }`.
`pid`, `cwd`, `gitBranch`, `workspaceId`, and `paneId` may be `null`. `job` is a
compact `{ status, currentCommand, lastExitCode }` summary (see
[Job model](#job-model-osc-133-shell-integration)).

### `POST /terminals`

Open a fresh terminal and optionally run a command.

Body: `{ workspaceId?, cwd?, command?, name?, isEphemeral? }`. With
`workspaceId`, the terminal opens as a split of that workspace's active pane
(`name`/`isEphemeral` are ignored); without it, a new workspace is created (see
[`POST /workspaces`](#post-workspaces) for how `name` and `isEphemeral` are
resolved). `data`: `{ workspaceId, paneId, terminalId }`.

### `GET /terminals/:id/buffer?lines=N`

Recent output for a terminal. `lines` (optional) keeps only the last `N` lines.

`data`: `{ id, lines, buffer }`.

### `GET /terminals/:id/job`

Current job state for one terminal (see
[Job model](#job-model-osc-133-shell-integration)).

`data`: `{ id, status, currentCommand, lastCommand, lastExitCode, startedAt, endedAt, commandCount }`.
`startedAt`/`endedAt` are epoch milliseconds (or `null`); `currentCommand`,
`lastCommand`, and `lastExitCode` may be `null`.

### `GET /jobs` (alias `GET /ps`)

Every terminal currently `running` a command.

`data`: `{ jobs: [{ id, command, commandId, startedAt, elapsedMs }] }`, where
`startedAt` is epoch milliseconds and `elapsedMs` is the time since the command
began.

### `POST /terminals/:id/write`

Write raw input to a terminal (no implicit newline).

Body: `{ data: string }`. `data`: `{ id, bytes }`.

### `POST /terminals/:id/run`

Convenience wrapper that writes a command and presses Enter.

Body: `{ command: string, enter?: boolean }` (`enter` defaults to `true`).
`data`: `{ id, command, enter }`.

To block until the command finishes, add `wait: true` (and optionally
`timeoutMs`):

Body: `{ command: string, wait: true, timeoutMs?: number }`. The request does not
respond until the matching OSC 133 `D` fires. `data`:
`{ id, command, exitCode, durationMs, commandId }` where `exitCode` may be
`null` if the shell reported no status.

Correlation and races: the completion is matched by the per-terminal
`commandId` assigned when the command starts, so a completion from an unrelated
command is never mistaken for this one. Waiting requires the terminal to be
idle with shell integration active:

- `409` if the terminal is already `running` a command, or if its status is
  `unknown` (integration not loaded, so completion can't be detected).
- `504` if `timeoutMs` elapses first (omit `timeoutMs` to wait indefinitely).
- `410` if the terminal exits before the command finishes.

### `DELETE /terminals/:id`

Close a terminal. Its pane closes with it (or restarts if it was the only pane).

`data`: `{ id, closed: true }`.

### `GET /workspaces`

List workspaces with their layout and the terminal in each pane.

`data`: `{ workspaces: WorkspaceInfo[], activeWorkspaceId }` where
`WorkspaceInfo = { id, name, isActive, isEphemeral, activePaneId, paneTree, panes: [{ paneId, terminalId }] }`.

### `POST /workspaces`

Create a workspace. Body: `{ cwd?, name?, isEphemeral? }`. `data`:
`{ workspaceId, paneId, terminalId }`.

- `name` falls back to the command the workspace was created to run
  (`POST /terminals` with `command`), then the basename of `cwd`, then
  `"workspace"`.
- `isEphemeral` defaults to `true`: control-created workspaces are
  session-scoped (see [Ephemeral workspaces](#ephemeral-workspaces)). Pass
  `false` to create a permanent workspace.

### `POST /workspaces/:id/activate`

Switch to a workspace. `data`: `{ workspaceId }`.

### `PATCH /workspaces/:id`

Rename a workspace. Body: `{ name: string }`. `data`: `{ workspaceId }`.
Renaming over the control API does not change ephemerality (renaming in the UI
does).

### `POST /workspaces/:id/keep`

Clear a workspace's ephemeral flag so it persists like a user-created one.
`data`: `{ workspaceId }`.

### `POST /workspaces/clean`

Close every ephemeral workspace whose terminals are all idle (skipping the
active workspace). `data`: `{ closedWorkspaceIds: string[] }`.

### `DELETE /workspaces/:id`

Close a workspace and its terminals (refused if it is the last workspace).
`data`: `{ workspaceId, closed: true }`.

## Ephemeral workspaces

Workspaces created through the control server default to `isEphemeral: true`.
They exist to keep agent-driven scratch work from accumulating in the user's
tab bar:

- They render italic/dimmed in the tab bar.
- They are excluded from layout persistence, so they do not survive an app
  restart.
- A reaper in the renderer closes an ephemeral workspace once every terminal
  in it has been idle (per shell integration) for ~15 minutes, using the last
  command end as the idle anchor. The active workspace is only reaped while
  the window is unfocused, so a tab never disappears in front of the user.
  Terminals whose job status is `running` or `unknown` block reaping.

A workspace stops being ephemeral when a client calls
`POST /workspaces/:id/keep` (CLI `bump ws-keep`), when it was created with
`isEphemeral: false` (CLI `--keep`), or when the user renames it in the UI.

### `POST /panes/:id/split`

Split a pane, spawn a terminal, optionally run a command.

Body: `{ direction: "horizontal" | "vertical", cwd?, command? }` (defaults to
`horizontal`). `data`: `{ paneId, terminalId }`.

### `POST /panes/:id/focus`

Focus a pane (switching workspace if needed). `data`: `{ paneId }`.

### `DELETE /panes/:id`

Close a pane. `data`: `{ paneId, closed: true }`.

### `POST /panes/:id/close-others`

Close every pane in the workspace except this one. `data`: `{ paneId }`.

### `GET /events`

A [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream of command lifecycle events across all terminals. The connection stays
open until the client disconnects; a `: ping` comment is sent every 15s to keep
it alive. Pass `?terminal=<id>` to receive events for a single terminal only.
The bearer token is sent in the `Authorization` header like every other
authenticated request.

Each event is a standard SSE frame with an `event:` type and a JSON `data:`
payload:

```
event: command_start
data: {"type":"command_start","terminalId":"term-1","commandId":7,"command":"pnpm build","startedAt":1751762400000}

event: command_end
data: {"type":"command_end","terminalId":"term-1","commandId":7,"command":"pnpm build","exitCode":0,"startedAt":1751762400000,"endedAt":1751762403120,"durationMs":3120}
```

- `command_start`: `{ type, terminalId, commandId, command, startedAt }`.
- `command_end`: `{ type, terminalId, commandId, command, exitCode, startedAt, endedAt, durationMs }`
  (`exitCode` and `durationMs` may be `null`).

## Architecture notes

Terminals (PTYs) live in the main process, so terminal listing, reading, and
writing are served directly. Workspaces, panes, and layout live in the renderer
(a zustand store), so those endpoints are proxied over an IPC request/response
bridge (`control:request` / `control:response`) with a timeout. If the renderer
is unavailable, `GET /terminals` still returns the main-known terminals (without
workspace/pane association) and workspace/pane endpoints return `500`.

Job state also lives in the main process (the PTY layer parses OSC 133 from the
stream), so `GET /terminals/:id/job`, `GET /jobs`, run-wait, and the `/events`
stream are served directly and keep working even when the renderer is busy.
