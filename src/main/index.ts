import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { setupIpcHandlers, cleanupAgent } from "./ipc-handlers.js";
import { closeAllTerminals } from "./pty-manager.js";

app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

let mainWindow: BrowserWindow | null = null;
let quitConfirmed = false;

const HANDLED_SHORTCUTS = new Set([
  "Cmd+P",
  "Cmd+D",
  "Cmd+Shift+D",
  "Cmd+W",
  "Cmd+T",
  "Cmd+K",
  "Cmd+N",
  "Cmd+=",
  "Cmd+-",
  "Cmd+0",
  "Cmd+Ctrl+F",
  "Cmd+Alt+ArrowUp",
  "Cmd+Alt+ArrowDown",
  "Cmd+Alt+ArrowLeft",
  "Cmd+Alt+ArrowRight",
  "Cmd+1", "Cmd+2", "Cmd+3", "Cmd+4", "Cmd+5", "Cmd+6", "Cmd+7", "Cmd+8", "Cmd+9",
]);

function buildShortcutString(input: Electron.Input): string | null {
  if (!input.meta) return null;

  const parts: string[] = ["Cmd"];
  if (input.shift) parts.push("Shift");
  if (input.alt) parts.push("Alt");
  if (input.control) parts.push("Ctrl");

  let key = input.key;
  if (key === " ") key = "Space";
  else if (key.startsWith("Arrow")) key = key;
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  const shortcut = parts.join("+");

  if (!HANDLED_SHORTCUTS.has(shortcut)) return null;

  return shortcut;
}

function createApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { label: "Copy", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu-copy") },
        { label: "Paste", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu-paste") },
        { role: "delete" },
        { label: "Select All", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu-select-all") },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: "Actual Size",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("ui-scale", "reset"),
        },
        {
          label: "Zoom In",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("ui-scale", "in"),
        },
        {
          label: "Zoom Out",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("ui-scale", "out"),
        },
        { type: "separator" },
        {
          label: "Toggle Full Screen",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.setFullScreen(!win.isFullScreen());
          },
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { label: "Close Pane" },
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  const preloadPath = join(__dirname, "../preload/index.cjs");

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 480,
    minHeight: 320,
    fullscreenable: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 10, y: 9 },
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;

    const shortcut = buildShortcutString(input);
    if (shortcut) {
      mainWindow?.webContents.send("shortcut", shortcut);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  createApplicationMenu();

  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("fullscreen-change", true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("fullscreen-change", false);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupIpcHandlers(() => mainWindow);

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.handle("shell:open-external", (_event, url: string) => {
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
      return shell.openExternal(url);
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  closeAllTerminals();
  await cleanupAgent();
  if (process.platform !== "darwin" || quitConfirmed) {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (quitConfirmed || process.env.VITE_DEV_SERVER_URL) {
    closeAllTerminals();
    await cleanupAgent();
    return;
  }

  event.preventDefault();

  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Cancel", "Quit"],
    defaultId: 1,
    cancelId: 0,
    message: "Are you sure you want to quit?",
  });

  if (response === 1) {
    quitConfirmed = true;
    app.quit();
  }
});
