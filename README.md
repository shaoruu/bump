# bump

Terminal that bumps into AI when you need it.

A terminal where you can seamlessly switch between running shell commands and talking to cursor-agent. When a command fails, press `Ctrl+Space` and say "fix it" -- the agent already sees your terminal output.

## How it works

```
Shell mode (default)     Ctrl+Space      Agent mode
  pty (node-pty)  -----> terminal buffer -----> cursor-agent (ACP)
  xterm.js                                      response panel
```

- **Shell mode**: Full terminal via node-pty + xterm.js
- **Agent mode**: Input bar appears, agent panel slides in. Your prompt is sent to cursor-agent with recent terminal output as context
- **Ctrl+Space**: Toggle between modes
- **Cmd+D**: Split current pane horizontally (side by side)
- **Cmd+Shift+D**: Split current pane vertically (stacked)
- **Cmd+W**: Close active pane

## Development

```bash
pnpm install
pnpm dev
```

## Architecture

```
src/
  main/
    index.ts           Electron main process
    pty-manager.ts     Terminal PTY + buffer capture
    agent-session.ts   ACP connection to cursor-agent
    ipc-handlers.ts    IPC handler setup
  preload/
    index.ts           Secure bridge (window.bump)
  renderer/
    App.tsx            Root layout + keyboard shortcuts
    components/
      PaneContainer.tsx Recursive pane tree renderer
      SplitView.tsx    Resizable split panels
      Terminal.tsx      xterm.js terminal (one per pane)
      AgentPanel.tsx    Agent response stream
      InputBar.tsx      Agent prompt input
      ModeIndicator.tsx Shell/agent mode indicator
      PermissionModal.tsx Tool permission dialog
    store/
      appStore.ts      Zustand state (pane tree + agent)
  shared/
    types.ts           Shared types
```
