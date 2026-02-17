import type { BrowserWindow } from "electron";
import type * as PtyType from "node-pty";

let pty: typeof PtyType | null = null;

async function getPty(): Promise<typeof PtyType> {
  if (!pty) {
    pty = await import("node-pty");
  }
  return pty;
}

const BUFFER_MAX_LINES = 500;

interface ManagedTerminal {
  pty: PtyType.IPty;
  buffer: string[];
}

const terminals = new Map<string, ManagedTerminal>();
let terminalCounter = 0;

function getShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  if (process.platform === "darwin") return "/bin/zsh";
  return "/bin/bash";
}

function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

function appendToBuffer(terminal: ManagedTerminal, data: string): void {
  const cleaned = stripAnsi(data);
  const newLines = cleaned.split(/\r?\n/);
  for (const line of newLines) {
    if (line.length > 0) {
      terminal.buffer.push(line);
    }
  }
  if (terminal.buffer.length > BUFFER_MAX_LINES) {
    terminal.buffer.splice(0, terminal.buffer.length - BUFFER_MAX_LINES);
  }
}

export async function createTerminal(
  mainWindow: BrowserWindow,
  cwd: string
): Promise<{ id: string; pid: number }> {
  const nodePty = await getPty();
  const id = `term-${++terminalCounter}`;
  const shell = getShell();

  const { homedir } = await import("node:os");
  const resolvedCwd = cwd || homedir();

  const ptyProcess = nodePty.spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: resolvedCwd,
    env: {
      HOME: homedir(),
      SHELL: shell,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: process.env.LANG || "en_US.UTF-8",
      ...(process.env.USER ? { USER: process.env.USER } : {}),
      ...(process.env.LOGNAME ? { LOGNAME: process.env.LOGNAME } : {}),
    },
  });

  const managed: ManagedTerminal = { pty: ptyProcess, buffer: [] };
  terminals.set(id, managed);

  ptyProcess.onData((data) => {
    appendToBuffer(managed, data);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal:data:${id}`, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal:exit:${id}`, exitCode);
    }
  });

  return { id, pid: ptyProcess.pid };
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.pty.write(data);
}

export function resizeTerminal(
  id: string,
  cols: number,
  rows: number
): void {
  terminals.get(id)?.pty.resize(cols, rows);
}

export function closeTerminal(id: string): void {
  const terminal = terminals.get(id);
  if (terminal) {
    terminal.pty.kill();
    terminals.delete(id);
  }
}

export function getTerminalBuffer(id: string): string {
  const terminal = terminals.get(id);
  if (!terminal) return "";
  return terminal.buffer.join("\n");
}

export function closeAllTerminals(): void {
  for (const [id, terminal] of terminals) {
    terminal.pty.kill();
    terminals.delete(id);
  }
}
