import type { BrowserWindow } from "electron";
import type * as PtyType from "node-pty";
import type { WriteStream } from "node:fs";
import { mkdirSync, createWriteStream, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
import { BUMP_DIR } from "./paths.js";
import type {
  CommandEndEvent,
  CommandStartEvent,
  TerminalExitEvent,
  TerminalJobState,
  TerminalJobSummary,
} from "../shared/types.js";

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

const TERMINALS_DIR = join(BUMP_DIR, "terminals");

mkdirSync(TERMINALS_DIR, { recursive: true });

// Strip terminal escape sequences and control noise so the captured log (and
// the control server's `read`) is plain, parseable text. Preserves tab,
// newline and carriage return.
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b[\]P^_X][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g, "")
    .replace(
      /[\u0090\u0098\u009d\u009e\u009f][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g,
      ""
    )
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\u001b[ -\/]*[0-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

const MAX_LOG_CARRY = 64 * 1024;

// Longest incomplete OSC sequence we hold across PTY chunks while waiting for a
// terminator. Our command markers are bounded (the shell truncates the command
// line before base64-encoding it), so anything larger is not one of ours; we
// stop holding and let it flow through rather than stalling output.
const MAX_OSC_CARRY = 128 * 1024;

// If the text ends inside an escape sequence that was split across PTY chunks,
// return the index where that partial sequence begins so it can be held and
// completed on the next chunk. Returns -1 when the text does not end
// mid-sequence.
function trailingPartialEscapeIndex(text: string): number {
  const esc = text.lastIndexOf("\u001b");
  if (esc === -1) return -1;
  const seq = text.slice(esc);
  if (/^\u001b[\]P^_X]/.test(seq)) {
    // OSC/DCS/PM/APC/SOS: complete only once BEL or ST is seen.
    return /\u0007|\u001b\\|\u009c/.test(seq.slice(2)) ? -1 : esc;
  }
  if (seq.startsWith("\u001b[")) {
    // CSI: complete only once a final byte (@-~) is seen.
    return /[@-~]/.test(seq.slice(2)) ? -1 : esc;
  }
  // A lone trailing ESC, or ESC followed only by intermediate bytes.
  if (/^\u001b[ -\/]*$/.test(seq)) return esc;
  return -1;
}

// --- Shell integration (OSC 133) ------------------------------------------
//
// bump ships rc assets under src/main/shell-integration and the vite build
// copies them next to the bundled main process. We read them from there and
// materialize them into BUMP_DIR (always a real, writable path even when the
// app is packaged inside an asar archive), then point spawned shells at that
// copy. If anything fails, integration is simply disabled and terminals behave
// exactly as before.

interface IntegrationPaths {
  zdotdir: string;
  zshHook: string;
  bashRc: string;
}

const INTEGRATION_FILES = [
  "bump.zsh",
  "bump.bash",
  "zdotdir/.zshenv",
  "zdotdir/.zprofile",
  "zdotdir/.zlogin",
  "zdotdir/.zshrc",
];

let integrationResolved = false;
let integrationPaths: IntegrationPaths | null = null;

function findAssetDir(): string | null {
  const candidates = [join(__dirname, "shell-integration")];
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, "shell-integration"));
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, "bump.zsh"))) return dir;
  }
  return null;
}

function getIntegration(): IntegrationPaths | null {
  if (integrationResolved) return integrationPaths;
  integrationResolved = true;
  try {
    const src = findAssetDir();
    if (!src) return (integrationPaths = null);
    const outDir = join(BUMP_DIR, "shell-integration");
    mkdirSync(join(outDir, "zdotdir"), { recursive: true });
    for (const rel of INTEGRATION_FILES) {
      writeFileSync(join(outDir, rel), readFileSync(join(src, rel)));
    }
    integrationPaths = {
      zdotdir: join(outDir, "zdotdir"),
      zshHook: join(outDir, "bump.zsh"),
      bashRc: join(outDir, "bump.bash"),
    };
  } catch {
    integrationPaths = null;
  }
  return integrationPaths;
}

function integrationEnv(shell: string): Record<string, string> {
  const integration = getIntegration();
  if (!integration) return {};
  if (shell.endsWith("zsh")) {
    return {
      ZDOTDIR: integration.zdotdir,
      BUMP_USER_ZDOTDIR: homedir(),
      BUMP_ZSH_HOOK: integration.zshHook,
      BUMP_SHELL_INTEGRATION: "1",
    };
  }
  if (shell.endsWith("bash")) {
    return { BUMP_SHELL_INTEGRATION: "1" };
  }
  return {};
}

function integrationArgs(shell: string): string[] {
  const integration = getIntegration();
  if (integration && shell.endsWith("bash")) {
    // A bash login shell ignores --rcfile, so run interactive-non-login and
    // reproduce the login profile chain inside bump.bash instead.
    return ["--rcfile", integration.bashRc, "-i"];
  }
  return ["-l"];
}

// --- Job event bus ---------------------------------------------------------
//
// A single EventEmitter the control server subscribes to for SSE streaming and
// run-wait. Typed wrappers keep call sites honest without leaking the emitter.

const jobEvents = new EventEmitter();

export function onCommandStart(listener: (event: CommandStartEvent) => void): () => void {
  jobEvents.on("command_start", listener);
  return () => void jobEvents.off("command_start", listener);
}

export function onCommandEnd(listener: (event: CommandEndEvent) => void): () => void {
  jobEvents.on("command_end", listener);
  return () => void jobEvents.off("command_end", listener);
}

export function onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void {
  jobEvents.on("terminal_exit", listener);
  return () => void jobEvents.off("terminal_exit", listener);
}

function newJobState(): TerminalJobState {
  return {
    status: "unknown",
    currentCommand: null,
    lastCommand: null,
    lastExitCode: null,
    startedAt: null,
    endedAt: null,
    commandCount: 0,
  };
}

// --- OSC 133 stream parsing ------------------------------------------------
//
// Walk the raw PTY output, act on OSC 133 markers (and bump's `L` command
// marker), and return the stream with only those markers removed. Other escape
// sequences (colors, title, cwd) pass through untouched so the renderer and log
// are unaffected. A trailing incomplete OSC is held on the terminal so a marker
// split across chunks is still parsed and never leaks.

interface OscTerminator {
  contentEnd: number;
  end: number;
}

function findOscTerminator(buf: string, from: number): OscTerminator | null {
  for (let i = from; i < buf.length; i++) {
    const c = buf[i];
    if (c === "\u0007" || c === "\u009c") return { contentEnd: i, end: i + 1 };
    if (c === "\u001b") {
      if (i + 1 < buf.length) {
        if (buf[i + 1] === "\\") return { contentEnd: i, end: i + 2 };
        // An embedded ESC that is not ST: none of our markers contain one, so
        // treat the sequence as still incomplete rather than misparsing it.
      }
      return null;
    }
  }
  return null;
}

function decodeCommand(encoded: string): string {
  try {
    return Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function startCommand(id: string, managed: ManagedTerminal): void {
  const job = managed.job;
  job.commandCount += 1;
  job.status = "running";
  job.currentCommand = managed.pendingCommand ?? "";
  job.startedAt = Date.now();
  job.endedAt = null;
  job.lastExitCode = null;
  managed.currentCommandId = job.commandCount;
  managed.pendingCommand = null;
  const event: CommandStartEvent = {
    type: "command_start",
    terminalId: id,
    commandId: managed.currentCommandId,
    command: job.currentCommand,
    startedAt: job.startedAt,
  };
  jobEvents.emit("command_start", event);
}

function endCommand(id: string, managed: ManagedTerminal, exitCode: number | null): void {
  const job = managed.job;
  // A D with no preceding C (the first prompt, or the user hitting enter on an
  // empty line) is not a completed command: mark idle without an event.
  if (job.status !== "running") {
    job.status = "idle";
    return;
  }
  const endedAt = Date.now();
  job.status = "idle";
  job.lastCommand = job.currentCommand;
  job.lastExitCode = exitCode;
  job.endedAt = endedAt;
  const durationMs = job.startedAt !== null ? endedAt - job.startedAt : null;
  const event: CommandEndEvent = {
    type: "command_end",
    terminalId: id,
    commandId: managed.currentCommandId,
    command: job.lastCommand ?? "",
    exitCode,
    startedAt: job.startedAt,
    endedAt,
    durationMs,
  };
  job.currentCommand = null;
  jobEvents.emit("command_end", event);
}

function handleMarker(id: string, managed: ManagedTerminal, body: string): void {
  const parts = body.split(";");
  const marker = parts[1] ?? "";
  switch (marker) {
    case "A":
    case "B":
      if (managed.job.status !== "running") managed.job.status = "idle";
      break;
    case "L":
      managed.pendingCommand = decodeCommand(parts.slice(2).join(";"));
      break;
    case "C":
      startCommand(id, managed);
      break;
    case "D": {
      const raw = parts.length > 2 ? Number.parseInt(parts[2], 10) : Number.NaN;
      endCommand(id, managed, Number.isNaN(raw) ? null : raw);
      break;
    }
  }
}

function isJobMarker(body: string): boolean {
  return body === "133" || body.startsWith("133;");
}

function extractOsc133(id: string, managed: ManagedTerminal, chunk: string): string {
  const buf = managed.oscCarry + chunk;
  managed.oscCarry = "";
  let out = "";
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const esc = buf.indexOf("\u001b", i);
    if (esc === -1) {
      out += buf.slice(i);
      break;
    }
    out += buf.slice(i, esc);
    if (esc === n - 1) {
      managed.oscCarry = buf.slice(esc);
      break;
    }
    if (buf[esc + 1] !== "]") {
      out += buf[esc];
      i = esc + 1;
      continue;
    }
    const term = findOscTerminator(buf, esc + 2);
    if (!term) {
      const held = buf.slice(esc);
      if (held.length > MAX_OSC_CARRY) {
        out += held;
      } else {
        managed.oscCarry = held;
      }
      break;
    }
    const bodyContent = buf.slice(esc + 2, term.contentEnd);
    if (isJobMarker(bodyContent)) {
      handleMarker(id, managed, bodyContent);
    } else {
      out += buf.slice(esc, term.end);
    }
    i = term.end;
  }
  return out;
}

interface ManagedTerminal {
  pty: PtyType.IPty;
  logPath: string;
  logStream: WriteStream;
  metaPath: string;
  title: string;
  ipcBuffer: string;
  ipcFlushScheduled: boolean;
  logCarry: string;
  oscCarry: string;
  pendingCommand: string | null;
  currentCommandId: number;
  job: TerminalJobState;
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

  const ptyProcess = nodePty.spawn(shell, integrationArgs(shell), {
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
      ...integrationEnv(shell),
    },
  });

  const managed: ManagedTerminal = {
    pty: ptyProcess, logPath, logStream, metaPath, title: resolvedCwd,
    ipcBuffer: "", ipcFlushScheduled: false, logCarry: "",
    oscCarry: "", pendingCommand: null, currentCommandId: 0, job: newJobState(),
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
    // Consume OSC 133 job markers first; everything else flows on unchanged.
    const visible = extractOsc133(id, managed, data);
    if (visible.length === 0) return;

    managed.ipcBuffer += visible;
    if (!managed.ipcFlushScheduled) {
      managed.ipcFlushScheduled = true;
      setImmediate(flushIpc);
    }

    const titleMatch = visible.match(/\x1b]0;(.+?)\x07/);
    if (titleMatch) {
      managed.title = titleMatch[1];
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal:title:" + id, managed.title);
      }
    }

    const combined = managed.logCarry + visible;
    const partialIndex = trailingPartialEscapeIndex(combined);
    const boundary =
      partialIndex === -1 || combined.length - partialIndex > MAX_LOG_CARRY
        ? combined.length
        : partialIndex;
    managed.logCarry = combined.slice(boundary);
    const cleaned = stripAnsi(combined.slice(0, boundary));
    if (cleaned.length > 0) {
      logStream.write(cleaned);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    const t = terminals.get(id);
    if (t) {
      releaseFiles(t);
      terminals.delete(id);
    }
    const exitEvent: TerminalExitEvent = { terminalId: id, exitCode };
    jobEvents.emit("terminal_exit", exitEvent);
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
    return execFileSync("tail", ["-n", "15000", terminal.logPath], {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

export function getTerminalCwd(id: string): Promise<string | null> {
  const terminal = terminals.get(id);
  if (!terminal) return Promise.resolve(null);
  return resolveCwdAsync(terminal.pty.pid);
}

export function hasTerminal(id: string): boolean {
  return terminals.has(id);
}

export function getTerminalJob(id: string): TerminalJobState | null {
  const terminal = terminals.get(id);
  return terminal ? { ...terminal.job } : null;
}

function jobSummary(job: TerminalJobState): TerminalJobSummary {
  return {
    status: job.status,
    currentCommand: job.currentCommand,
    lastExitCode: job.lastExitCode,
  };
}

export interface RunningJob {
  id: string;
  command: string | null;
  startedAt: number | null;
  commandId: number;
}

export function getRunningJobs(): RunningJob[] {
  const running: RunningJob[] = [];
  for (const [id, t] of terminals.entries()) {
    if (t.job.status === "running") {
      running.push({
        id,
        command: t.job.currentCommand,
        startedAt: t.job.startedAt,
        commandId: t.currentCommandId,
      });
    }
  }
  return running;
}

export async function getTerminalDetails(
  id: string
): Promise<{ pid: number; cwd: string | null; gitBranch: string | null } | null> {
  const terminal = terminals.get(id);
  if (!terminal) return null;
  const cwd = await resolveCwdAsync(terminal.pty.pid);
  return {
    pid: terminal.pty.pid,
    cwd,
    gitBranch: cwd ? findGitBranch(cwd) : null,
  };
}

export function getTerminalTitle(id: string): string {
  const terminal = terminals.get(id);
  return terminal?.title ?? "terminal";
}

export function getAllTerminalInfo(): {
  id: string;
  logPath: string;
  title: string;
  job: TerminalJobSummary;
}[] {
  return Array.from(terminals.entries()).map(([id, t]) => ({
    id,
    logPath: t.logPath,
    title: t.title,
    job: jobSummary(t.job),
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

function resolveCwdAsync(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-a", "-d", "cwd", "-p", String(pid), "-Fn"],
      { timeout: 2000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        for (const line of stdout.split("\n")) {
          if (line.startsWith("n/")) { resolve(line.slice(1)); return; }
        }
        resolve(null);
      }
    );
  });
}

function findGitBranch(dir: string): string | null {
  let current = dir;
  while (true) {
    const headPath = join(current, ".git", "HEAD");
    if (existsSync(headPath)) {
      const content = readFileSync(headPath, "utf-8").trim();
      if (content.startsWith("ref: refs/heads/")) {
        return content.slice("ref: refs/heads/".length);
      }
      return content.slice(0, 7);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function getTerminalGitBranch(id: string): Promise<string | null> {
  const terminal = terminals.get(id);
  if (!terminal) return null;
  const cwd = await resolveCwdAsync(terminal.pty.pid);
  if (!cwd) return null;
  return findGitBranch(cwd);
}
