import { ipcMain, clipboard, dialog, type BrowserWindow } from "electron";
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  closeAllTerminals,
  getTerminalBuffer,
  getTerminalCwd,
  getTerminalGitBranch,
  getAllTerminalLogPaths,
  getAllTerminalInfo,
} from "./pty-manager.js";
import { AgentSession } from "./agent-session.js";
import { loadGhosttyThemes } from "./theme-loader.js";
import { getSetting, setSetting } from "./settings.js";

let agentSession: AgentSession | null = null;

export function setupIpcHandlers(
  getWindow: () => BrowserWindow | null
): void {
  ipcMain.handle("terminal:create", async (_event, cwd?: string) => {
    const win = getWindow();
    if (!win) throw new Error("No active window");
    const resolvedCwd = cwd || process.env.HOME || process.cwd();
    return createTerminal(win, resolvedCwd);
  });

  ipcMain.handle("terminal:cwd", async (_event, id: string) => {
    return getTerminalCwd(id);
  });

  ipcMain.handle("terminal:git-branch", async (_event, id: string) => {
    return getTerminalGitBranch(id);
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

  ipcMain.handle("terminal:close-all", async () => {
    closeAllTerminals();
  });

  ipcMain.handle("terminal:buffer", async (_event, id: string) => {
    return getTerminalBuffer(id);
  });

  ipcMain.handle("terminal:info", async () => {
    return getAllTerminalInfo();
  });

  ipcMain.handle("agent:start", async (_event, workspacePath: string) => {
    const win = getWindow();
    if (!win) throw new Error("No active window");
    if (agentSession) {
      await agentSession.stop();
    }
    agentSession = new AgentSession(win, workspacePath);
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

  ipcMain.handle("dialog:select-directory", async () => {
    const win = getWindow();
    if (!win) throw new Error("No active window");
    const result = await dialog.showOpenDialog(win, {
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

  ipcMain.handle("clipboard:write", async (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle("clipboard:read", async () => {
    return clipboard.readText();
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
