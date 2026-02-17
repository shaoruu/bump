import { ipcMain, dialog, type BrowserWindow } from "electron";
import { execFileSync, spawnSync } from "node:child_process";
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  getTerminalBuffer,
  getTerminalCwd,
  getAllTerminalLogPaths,
  getAllTerminalInfo,
} from "./pty-manager.js";
import { AgentSession } from "./agent-session.js";
import { loadGhosttyThemes } from "./theme-loader.js";
import { getSetting, setSetting } from "./settings.js";

let cachedAgentCliPath: string | null = null;

function getAgentCliPath(): string {
  if (cachedAgentCliPath) return cachedAgentCliPath;
  if (process.env.AGENT_CLI_PATH) {
    cachedAgentCliPath = process.env.AGENT_CLI_PATH;
    return cachedAgentCliPath;
  }
  const shell = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  try {
    const result = execFileSync(shell, ["-l", "-c", "which cursor-agent"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    if (result && !result.includes("not found")) {
      cachedAgentCliPath = result;
      return cachedAgentCliPath;
    }
  } catch {
    // fall through
  }
  cachedAgentCliPath = "cursor-agent";
  return cachedAgentCliPath;
}

let agentSession: AgentSession | null = null;

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle("terminal:create", async (_event, cwd?: string) => {
    const resolvedCwd = cwd || process.env.HOME || process.cwd();
    return createTerminal(mainWindow, resolvedCwd);
  });

  ipcMain.handle("terminal:cwd", async (_event, id: string) => {
    return getTerminalCwd(id);
  });

  ipcMain.handle(
    "terminal:write",
    async (_event, id: string, data: string) => {
      writeTerminal(id, data);
    }
  );

  ipcMain.handle(
    "terminal:resize",
    async (_event, id: string, cols: number, rows: number) => {
      resizeTerminal(id, cols, rows);
    }
  );

  ipcMain.handle("terminal:close", async (_event, id: string) => {
    closeTerminal(id);
  });

  ipcMain.handle("terminal:buffer", async (_event, id: string) => {
    return getTerminalBuffer(id);
  });

  ipcMain.handle("terminal:info", async () => {
    return getAllTerminalInfo();
  });

  ipcMain.handle("agent:start", async (_event, workspacePath: string) => {
    if (agentSession) {
      await agentSession.stop();
    }
    agentSession = new AgentSession(mainWindow, workspacePath);
    await agentSession.start();
  });

  ipcMain.handle("agent:stop", async () => {
    if (agentSession) {
      await agentSession.stop();
      agentSession = null;
    }
  });

  ipcMain.handle(
    "agent:prompt",
    async (_event, text: string) => {
      if (!agentSession) {
        throw new Error("Agent not started");
      }
      const logPaths = getAllTerminalLogPaths().map((t) => t.logPath);
      return agentSession.prompt(text, logPaths);
    }
  );

  ipcMain.handle("agent:cancel", async () => {
    if (agentSession) {
      await agentSession.cancel();
    }
  });

  ipcMain.handle("agent:status", async () => {
    return agentSession ? "active" : "idle";
  });

  ipcMain.on("agent:permission-response", (_event, response) => {
    // forwarded by the once handler in agent-session
  });

  ipcMain.handle("auth:check", async () => {
    const agentCliPath = getAgentCliPath();
    const result = spawnSync(agentCliPath, ["whoami"], {
      stdio: "pipe",
      timeout: 5000,
      encoding: "utf-8",
    });
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/Logged in as\s+([^\s]+@[^\s]+)/i);
      if (match) return { authenticated: true, email: match[1] };
    }
    return { authenticated: false };
  });

  ipcMain.handle("dialog:select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("app:cwd", async () => {
    return process.env.HOME || process.cwd();
  });

  ipcMain.handle("themes:list", async () => {
    return loadGhosttyThemes();
  });

  ipcMain.handle("settings:get", async (_event, key: string) => {
    return getSetting(key);
  });

  ipcMain.handle(
    "settings:set",
    async (_event, key: string, value: string) => {
      setSetting(key, value);
    }
  );
}

export async function cleanupAgent(): Promise<void> {
  if (agentSession) {
    await agentSession.stop();
    agentSession = null;
  }
}
