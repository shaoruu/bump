import type { BrowserWindow } from "electron";
import type * as PtyType from "node-pty";
import type { WriteStream } from "node:fs";
import { mkdirSync, createWriteStream, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

function getDescendants(pid: number): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf-8",
      timeout: 2000,
    });
    const children = out
      .split("\n")
      .map((l) => parseInt(l, 10))
      .filter((n) => !isNaN(n));
    return children.flatMap((c) => [...getDescendants(c), c]);
  } catch {
    return [];
  }
}

function killProcessTree(pid: number): void {
  const pids = [...getDescendants(pid), pid];
  for (const p of pids) {
    try { process.kill(p, "SIGTERM"); } catch {}
  }
  for (const p of pids) {
    try { process.kill(p, "SIGKILL"); } catch {}
  }
}

let pty: typeof PtyType | null = null;

async function getPty(): Promise<typeof PtyType> {
  if (!pty) {
    pty = await import("node-pty");
  }
  return pty;
}

const BUMP_DIR = join(homedir(), ".bump");
const TERMINALS_DIR = join(BUMP_DIR, "terminals");

mkdirSync(TERMINALS_DIR, { recursive: true });

function stripAnsi(text: string): string {
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

interface ManagedTerminal {
  pty: PtyType.IPty;
  logPath: string;
  logStream: WriteStream;
  metaPath: string;
  title: string;
  ipcBuffer: string;
  ipcFlushScheduled: boolean;
}

const terminals = new Map<string, ManagedTerminal>();
let terminalCounter = 0;

function releaseFiles(terminal: ManagedTerminal): void {
  terminal.logStream.end();
  try { unlinkSync(terminal.logPath); } catch {}
  try { unlinkSync(terminal.metaPath); } catch {}
}

function getShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  if (process.platform === "darwin") return "/bin/zsh";
  return "/bin/bash";
}

export async function createTerminal(
  mainWindow: BrowserWindow,
  cwd: string
): Promise<{ id: string; pid: number }> {
  const nodePty = await getPty();
  const id = `term-${++terminalCounter}`;
  const shell = getShell();
  const resolvedCwd = cwd || homedir();

  const logPath = join(TERMINALS_DIR, `${id}.log`);
  const metaPath = join(TERMINALS_DIR, `${id}.json`);

  writeFileSync(logPath, "");
  writeFileSync(metaPath, JSON.stringify({
    id,
    cwd: resolvedCwd,
    shell,
    startedAt: new Date().toISOString(),
  }));

  const logStream = createWriteStream(logPath, { flags: "a" });

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

  const managed: ManagedTerminal = {
    pty: ptyProcess, logPath, logStream, metaPath, title: resolvedCwd,
    ipcBuffer: "", ipcFlushScheduled: false,
  };
  terminals.set(id, managed);

  const flushIpc = () => {
    managed.ipcFlushScheduled = false;
    if (managed.ipcBuffer.length > 0 && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal:data:${id}`, managed.ipcBuffer);
      managed.ipcBuffer = "";
    }
  };

  ptyProcess.onData((data) => {
    managed.ipcBuffer += data;
    if (!managed.ipcFlushScheduled) {
      managed.ipcFlushScheduled = true;
      setImmediate(flushIpc);
    }

    const titleMatch = data.match(/\x1b]0;(.+?)\x07/);
    if (titleMatch) {
      managed.title = titleMatch[1];
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal:title:" + id, managed.title);
      }
    }

    const cleaned = stripAnsi(data);
    if (cleaned.trim().length > 0) {
      logStream.write(cleaned);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    const t = terminals.get(id);
    if (t) {
      releaseFiles(t);
      terminals.delete(id);
    }
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`terminal:exit:${id}`, exitCode);
    }
  });

  return { id, pid: ptyProcess.pid };
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  terminals.get(id)?.pty.resize(cols, rows);
}

export function closeTerminal(id: string): void {
  const terminal = terminals.get(id);
  if (!terminal) return;
  killProcessTree(terminal.pty.pid);
  terminal.pty.kill();
  releaseFiles(terminal);
  terminals.delete(id);
}

export function getTerminalLogPath(id: string): string | null {
  const terminal = terminals.get(id);
  return terminal?.logPath ?? null;
}

export function getTerminalBuffer(id: string): string {
  const terminal = terminals.get(id);
  if (!terminal) return "";
  try {
    const content = readFileSync(terminal.logPath, "utf-8");
    const lines = content.split("\n");
    return lines.slice(-500).join("\n");
  } catch {
    return "";
  }
}

export function getTerminalCwd(id: string): string | null {
  const terminal = terminals.get(id);
  if (!terminal) return null;
  try {
    const pid = terminal.pty.pid;
    const output = execFileSync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], {
      encoding: "utf-8",
      timeout: 2000,
    });
    for (const line of output.split("\n")) {
      if (line.startsWith("n/")) return line.slice(1);
    }
  } catch {}
  return null;
}

export function getTerminalTitle(id: string): string {
  const terminal = terminals.get(id);
  return terminal?.title ?? "terminal";
}

export function getAllTerminalInfo(): { id: string; logPath: string; title: string }[] {
  return Array.from(terminals.entries()).map(([id, t]) => ({
    id,
    logPath: t.logPath,
    title: t.title,
  }));
}

export function getAllTerminalLogPaths(): { id: string; logPath: string; metaPath: string }[] {
  return Array.from(terminals.entries()).map(([id, t]) => ({
    id,
    logPath: t.logPath,
    metaPath: t.metaPath,
  }));
}

export function closeAllTerminals(): void {
  for (const id of Array.from(terminals.keys())) {
    closeTerminal(id);
  }
}
