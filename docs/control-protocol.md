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

## Endpoints

### `GET /status`

Unauthenticated liveness ping.

`data`: `{ version, pid, terminalCount, workspaceCount, uptimeMs }`.

### `GET /terminals`

List every live terminal, joined with the workspace/pane that hosts it.

`data.terminals[]`: `{ id, title, pid, cwd, gitBranch, logPath, workspaceId, paneId }`.
`pid`, `cwd`, `gitBranch`, `workspaceId`, and `paneId` may be `null`.

### `POST /terminals`

Open a fresh terminal and optionally run a command.

Body: `{ workspaceId?, cwd?, command? }`. With `workspaceId`, the terminal opens
as a split of that workspace's active pane; without it, a new workspace is
created. `data`: `{ workspaceId, paneId, terminalId }`.

### `GET /terminals/:id/buffer?lines=N`

Recent output for a terminal. `lines` (optional) keeps only the last `N` lines.

`data`: `{ id, lines, buffer }`.

### `POST /terminals/:id/write`

Write raw input to a terminal (no implicit newline).

Body: `{ data: string }`. `data`: `{ id, bytes }`.

### `POST /terminals/:id/run`

Convenience wrapper that writes a command and presses Enter.

Body: `{ command: string, enter?: boolean }` (`enter` defaults to `true`).
`data`: `{ id, command, enter }`.

### `DELETE /terminals/:id`

Close a terminal. Its pane closes with it (or restarts if it was the only pane).

`data`: `{ id, closed: true }`.

### `GET /workspaces`

List workspaces with their layout and the terminal in each pane.

`data`: `{ workspaces: WorkspaceInfo[], activeWorkspaceId }` where
`WorkspaceInfo = { id, name, isActive, activePaneId, paneTree, panes: [{ paneId, terminalId }] }`.

### `POST /workspaces`

Create a workspace. Body: `{ cwd? }`. `data`: `{ workspaceId, paneId, terminalId }`.

### `POST /workspaces/:id/activate`

Switch to a workspace. `data`: `{ workspaceId }`.

### `PATCH /workspaces/:id`

Rename a workspace. Body: `{ name: string }`. `data`: `{ workspaceId }`.

### `DELETE /workspaces/:id`

Close a workspace and its terminals (refused if it is the last workspace).
`data`: `{ workspaceId, closed: true }`.

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

## Architecture notes

Terminals (PTYs) live in the main process, so terminal listing, reading, and
writing are served directly. Workspaces, panes, and layout live in the renderer
(a zustand store), so those endpoints are proxied over an IPC request/response
bridge (`control:request` / `control:response`) with a timeout. If the renderer
is unavailable, `GET /terminals` still returns the main-known terminals (without
workspace/pane association) and workspace/pane endpoints return `500`.
