import { ipcMain, dialog, type BrowserWindow } from "electron";
import { execFileSync, spawnSync } from "node:child_process";
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  getTerminalBuffer,
} from "./pty-manager.js";
import { AgentSession } from "./agent-session.js";

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
  ipcMain.handle("terminal:create", async () => {
    const cwd = process.env.HOME || process.cwd();
    return createTerminal(mainWindow, cwd);
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
    async (_event, text: string, terminalContext?: string) => {
      if (!agentSession) {
        throw new Error("Agent not started");
      }
      return agentSession.prompt(text, terminalContext);
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
}

export async function cleanupAgent(): Promise<void> {
  if (agentSession) {
    await agentSession.stop();
    agentSession = null;
  }
}
