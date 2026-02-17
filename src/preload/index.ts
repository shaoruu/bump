import { contextBridge, ipcRenderer } from "electron";
import type {
  BumpAPI,
  PermissionRequest,
  PermissionResponse,
  SessionUpdatePayload,
} from "../shared/types.js";

const bump: BumpAPI = {
  createTerminal: (cwd?: string) => ipcRenderer.invoke("terminal:create", cwd),

  getTerminalCwd: (id: string) => ipcRenderer.invoke("terminal:cwd", id),

  writeTerminal: (id: string, data: string) =>
    ipcRenderer.invoke("terminal:write", id, data),

  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke("terminal:resize", id, cols, rows),

  closeTerminal: (id: string) => ipcRenderer.invoke("terminal:close", id),
  closeAllTerminals: () => ipcRenderer.invoke("terminal:close-all"),

  onTerminalData: (id: string, cb: (data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) =>
      cb(data);
    ipcRenderer.on(`terminal:data:${id}`, handler);
    return () => ipcRenderer.removeListener(`terminal:data:${id}`, handler);
  },

  onTerminalExit: (id: string, cb: (exitCode: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, exitCode: number) =>
      cb(exitCode);
    ipcRenderer.on(`terminal:exit:${id}`, handler);
    return () => ipcRenderer.removeListener(`terminal:exit:${id}`, handler);
  },

  getTerminalInfo: () => ipcRenderer.invoke("terminal:info"),

  onTerminalTitle: (id: string, cb: (title: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, title: string) => cb(title);
    ipcRenderer.on("terminal:title:" + id, handler);
    return () => ipcRenderer.removeListener("terminal:title:" + id, handler);
  },

  getTerminalBuffer: (id: string) =>
    ipcRenderer.invoke("terminal:buffer", id),

  startAgent: (workspacePath: string) =>
    ipcRenderer.invoke("agent:start", workspacePath),

  stopAgent: () => ipcRenderer.invoke("agent:stop"),

  promptAgent: (text: string) =>
    ipcRenderer.invoke("agent:prompt", text),

  cancelAgent: () => ipcRenderer.invoke("agent:cancel"),

  getAgentStatus: () => ipcRenderer.invoke("agent:status"),

  onAgentUpdate: (cb: (update: SessionUpdatePayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      update: SessionUpdatePayload
    ) => cb(update);
    ipcRenderer.on("agent:update", handler);
    return () => ipcRenderer.removeListener("agent:update", handler);
  },

  onPermissionRequest: (cb: (request: PermissionRequest) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: PermissionRequest
    ) => cb(request);
    ipcRenderer.on("agent:permission-request", handler);
    return () =>
      ipcRenderer.removeListener("agent:permission-request", handler);
  },

  respondToPermission: (response: PermissionResponse) => {
    ipcRenderer.send("agent:permission-response", response);
  },

  checkAuth: () => ipcRenderer.invoke("auth:check"),

  listThemes: () => ipcRenderer.invoke("themes:list"),

  getSetting: (key: string) => ipcRenderer.invoke("settings:get", key),
  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke("settings:set", key, value),

  onFullscreenChange: (cb: (isFullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, val: boolean) => cb(val);
    ipcRenderer.on("fullscreen-change", handler);
    return () => ipcRenderer.removeListener("fullscreen-change", handler);
  },

  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),

  getCwd: () => ipcRenderer.invoke("app:cwd"),

  closeWindow: () => ipcRenderer.invoke("window:close"),

  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),

  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),

  onClosePane: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("close-pane", handler);
    return () => ipcRenderer.removeListener("close-pane", handler);
  },

  onMenuPaste: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu-paste", handler);
    return () => ipcRenderer.removeListener("menu-paste", handler);
  },
};

contextBridge.exposeInMainWorld("bump", bump);
