import { useAppStore, collectLeafIds, findPaneInDirection } from "../store/appStore.js";
import { terminalRegistry } from "../components/TerminalRegistry.js";
import { pendingInputs } from "../components/PaneContainer.js";

const BASE_FONT_SIZE = 13;
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 24;
const SCALE_STEP = 1;
const FONT_SIZE_SETTING_KEY = "fontSize";

function applyUiScale(fontSize: number, persist = true): void {
  document.documentElement.style.fontSize = `${fontSize}px`;
  terminalRegistry.setFontSize(fontSize);
  if (persist) {
    window.bump.setSetting(FONT_SIZE_SETTING_KEY, String(fontSize));
  }
}

export async function initUiScale(): Promise<void> {
  const stored = await window.bump.getSetting(FONT_SIZE_SETTING_KEY);
  if (stored) {
    const size = parseInt(stored, 10);
    if (!isNaN(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
      applyUiScale(size, false);
      return;
    }
  }
  applyUiScale(BASE_FONT_SIZE, false);
}

function zoomIn(): void {
  const current = terminalRegistry.getFontSize();
  const next = Math.min(current + SCALE_STEP, MAX_FONT_SIZE);
  applyUiScale(next);
}

function zoomOut(): void {
  const current = terminalRegistry.getFontSize();
  const next = Math.max(current - SCALE_STEP, MIN_FONT_SIZE);
  applyUiScale(next);
}

function resetZoom(): void {
  applyUiScale(BASE_FONT_SIZE);
}

export interface Action {
  id: string;
  label: string;
  shortcut?: string;
  keywords?: string[];
  category: "general" | "terminal" | "agent" | "theme";
  icon?: string;
  execute: () => void;
  hidden?: boolean;
}

const actions: Action[] = [];
const RECENT_KEY = "bump:recent-actions";
const MAX_RECENT = 5;

export function registerAction(action: Action) {
  const existing = actions.findIndex((a) => a.id === action.id);
  if (existing !== -1) {
    actions[existing] = action;
  } else {
    actions.push(action);
  }
}

export function getActions(): Action[] {
  return actions.filter((a) => !a.hidden);
}

export function executeAction(id: string): void {
  const action = actions.find((a) => a.id === id);
  action?.execute();
}

export function getRecentActionIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function recordRecentAction(id: string) {
  const recent = getRecentActionIds().filter((r) => r !== id);
  recent.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function registerCoreActions(
  openPalette: () => void,
  openThemePicker: () => void
) {
  registerAction({
    id: "palette.open",
    label: "Command Palette",
    shortcut: "Cmd+P",
    icon: "command",
    category: "general",
    execute: openPalette,
    hidden: true,
  });

  registerAction({
    id: "terminal.split-horizontal",
    label: "Split Terminal Right",
    shortcut: "Cmd+D",
    keywords: ["pane", "divide"],
    icon: "split-horizontal",
    category: "terminal",
    execute: () => {
      const { activePaneId, splitPane, getActiveTerminalId } = useAppStore.getState();
      const terminalId = getActiveTerminalId();
      if (terminalId) {
        window.bump.getTerminalCwd(terminalId).then((cwd) => {
          splitPane(activePaneId, "horizontal", cwd ?? undefined);
        });
      } else {
        splitPane(activePaneId, "horizontal");
      }
    },
  });

  registerAction({
    id: "terminal.split-vertical",
    label: "Split Terminal Down",
    shortcut: "Cmd+Shift+D",
    keywords: ["pane", "divide"],
    icon: "split-vertical",
    category: "terminal",
    execute: () => {
      const { activePaneId, splitPane, getActiveTerminalId } = useAppStore.getState();
      const terminalId = getActiveTerminalId();
      if (terminalId) {
        window.bump.getTerminalCwd(terminalId).then((cwd) => {
          splitPane(activePaneId, "vertical", cwd ?? undefined);
        });
      } else {
        splitPane(activePaneId, "vertical");
      }
    },
  });

  registerAction({
    id: "workspace.new",
    label: "New Workspace",
    shortcut: "Cmd+T",
    icon: "plus",
    category: "general",
    execute: () => {
      const { getActiveTerminalId, createWorkspace } = useAppStore.getState();
      const terminalId = getActiveTerminalId();
      if (terminalId) {
        window.bump.getTerminalCwd(terminalId).then((cwd) => {
          createWorkspace(cwd ?? undefined);
        });
      } else {
        createWorkspace();
      }
    },
  });

  registerAction({
    id: "terminal.close",
    label: "Close Terminal Pane",
    shortcut: "Cmd+W",
    keywords: ["remove", "kill", "destroy"],
    icon: "x",
    category: "terminal",
    execute: () => {
      const { activePaneId, closePane, paneTree, workspaces } = useAppStore.getState();
      if (paneTree.type === "leaf" && workspaces.length <= 1) {
        terminalRegistry.destroy(activePaneId);
        window.bump.closeWindow();
        return;
      }
      closePane(activePaneId);
      terminalRegistry.destroy(activePaneId);
    },
  });

  registerAction({
    id: "window.reload",
    label: "Reload Window",
    keywords: ["refresh", "restart"],
    icon: "refresh",
    category: "general",
    execute: async () => {
      await window.bump.closeAllTerminals();
      window.location.reload();
    },
  });

  registerAction({
    id: "theme.change",
    label: "Change Theme...",
    keywords: ["color", "appearance", "dark", "light", "scheme"],
    icon: "palette",
    category: "theme",
    execute: openThemePicker,
  });

  registerAction({
    id: "workspace.rename",
    label: "Rename Workspace",
    keywords: ["name", "title", "tab"],
    icon: "edit",
    category: "general",
    execute: () => {
      const { activeWorkspaceId, workspaces, openPrompt, renameWorkspace } =
        useAppStore.getState();
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (!ws) return;
      openPrompt({
        title: "Rename workspace",
        defaultValue: ws.name,
        submitLabel: "rename",
        onSubmit: (name) => renameWorkspace(activeWorkspaceId, name),
      });
    },
  });

  registerAction({
    id: "workspace.close",
    label: "Close Workspace",
    keywords: ["remove", "delete", "tab"],
    icon: "x",
    category: "general",
    execute: () => {
      const state = useAppStore.getState();
      if (state.workspaces.length <= 1) return;
      for (const [paneId] of state.panes) {
        terminalRegistry.destroy(paneId);
      }
      state.closeWorkspace(state.activeWorkspaceId);
    },
  });

  registerAction({
    id: "workspace.next",
    label: "Next Workspace",
    keywords: ["tab", "switch", "right", "forward"],
    icon: "chevron-right",
    category: "general",
    execute: () => {
      const { workspaces, activeWorkspaceId, switchWorkspace } = useAppStore.getState();
      if (workspaces.length <= 1) return;
      const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
      switchWorkspace(workspaces[(idx + 1) % workspaces.length].id);
    },
  });

  registerAction({
    id: "workspace.prev",
    label: "Previous Workspace",
    keywords: ["tab", "switch", "left", "back"],
    icon: "chevron-left",
    category: "general",
    execute: () => {
      const { workspaces, activeWorkspaceId, switchWorkspace } = useAppStore.getState();
      if (workspaces.length <= 1) return;
      const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
      switchWorkspace(workspaces[(idx - 1 + workspaces.length) % workspaces.length].id);
    },
  });

  registerAction({
    id: "terminal.clear",
    label: "Clear Terminal",
    shortcut: "Cmd+K",
    keywords: ["clean", "scrollback", "reset"],
    icon: "trash",
    category: "terminal",
    execute: () => {
      terminalRegistry.clearTerminal(useAppStore.getState().activePaneId);
    },
  });

  registerAction({
    id: "terminal.restart",
    label: "Restart Terminal",
    keywords: ["reboot", "refresh", "kill", "respawn"],
    icon: "refresh",
    category: "terminal",
    execute: () => {
      terminalRegistry.restart(useAppStore.getState().activePaneId);
    },
  });

  registerAction({
    id: "terminal.copy-output",
    label: "Copy Terminal Output",
    keywords: ["buffer", "clipboard", "text", "copy"],
    icon: "copy",
    category: "terminal",
    execute: () => {
      terminalRegistry.copyOutput(useAppStore.getState().activePaneId);
    },
  });

  registerAction({
    id: "terminal.focus-next",
    label: "Focus Next Pane",
    keywords: ["switch", "cycle", "navigate"],
    icon: "chevron-right",
    category: "terminal",
    execute: () => {
      const { paneTree, activePaneId, setActivePaneId } = useAppStore.getState();
      const leafIds = collectLeafIds(paneTree);
      if (leafIds.length <= 1) return;
      const idx = leafIds.indexOf(activePaneId);
      const nextId = leafIds[(idx + 1) % leafIds.length];
      setActivePaneId(nextId);
      terminalRegistry.focusTerminal(nextId);
    },
  });

  registerAction({
    id: "terminal.focus-prev",
    label: "Focus Previous Pane",
    keywords: ["switch", "cycle", "navigate"],
    icon: "chevron-left",
    category: "terminal",
    execute: () => {
      const { paneTree, activePaneId, setActivePaneId } = useAppStore.getState();
      const leafIds = collectLeafIds(paneTree);
      if (leafIds.length <= 1) return;
      const idx = leafIds.indexOf(activePaneId);
      const prevId = leafIds[(idx - 1 + leafIds.length) % leafIds.length];
      setActivePaneId(prevId);
      terminalRegistry.focusTerminal(prevId);
    },
  });

  registerAction({
    id: "terminal.close-others",
    label: "Close Other Panes",
    keywords: ["maximize", "solo", "zen", "focus"],
    icon: "maximize",
    category: "terminal",
    execute: () => {
      const { activePaneId, closeOtherPanes } = useAppStore.getState();
      const closedIds = closeOtherPanes(activePaneId);
      for (const id of closedIds) {
        terminalRegistry.destroy(id);
      }
    },
  });

  registerAction({
    id: "terminal.fix-further",
    label: "Fix Further",
    keywords: ["debug", "error", "agent", "ai", "help", "cursor"],
    icon: "zap",
    category: "terminal",
    execute: async () => {
      const { activePaneId, splitPane, panes } = useAppStore.getState();
      const terminalId = panes.get(activePaneId)?.terminalId;
      if (!terminalId) return;
      const [infos, cwd] = await Promise.all([
        window.bump.getTerminalInfo(),
        window.bump.getTerminalCwd(terminalId),
      ]);
      const info = infos.find((i) => i.id === terminalId);
      const newPaneId = useAppStore
        .getState()
        .splitPane(activePaneId, "horizontal", cwd ?? undefined);
      if (info?.logPath) {
        pendingInputs.set(
          newPaneId,
          `cursor-agent -f "with the terminal logs at ${info.logPath}, `
        );
      }
    },
  });

  registerAction({
    id: "window.fullscreen",
    label: "Toggle Full Screen",
    shortcut: "Cmd+Ctrl+F",
    keywords: ["fullscreen", "maximize", "screen"],
    icon: "maximize",
    category: "general",
    execute: () => {
      window.bump.toggleFullscreen();
    },
  });

  registerAction({
    id: "window.devtools",
    label: "Toggle Developer Tools",
    shortcut: "Cmd+Alt+I",
    keywords: ["devtools", "developer", "inspect", "console", "debug"],
    icon: "code",
    category: "general",
    execute: () => {
      window.bump.toggleDevTools();
    },
  });

  registerAction({
    id: "terminal.focus-left",
    label: "Focus Pane Left",
    shortcut: "Cmd+Alt+ArrowLeft",
    keywords: ["navigate", "switch", "pane"],
    icon: "arrow-left",
    category: "terminal",
    execute: () => {
      const { paneTree, activePaneId, setActivePaneId } = useAppStore.getState();
      const targetId = findPaneInDirection(paneTree, activePaneId, "left");
      if (targetId) {
        setActivePaneId(targetId);
        terminalRegistry.focusTerminal(targetId);
      }
    },
  });

  registerAction({
    id: "terminal.focus-right",
    label: "Focus Pane Right",
    shortcut: "Cmd+Alt+ArrowRight",
    keywords: ["navigate", "switch", "pane"],
    icon: "arrow-right",
    category: "terminal",
    execute: () => {
      const { paneTree, activePaneId, setActivePaneId } = useAppStore.getState();
      const targetId = findPaneInDirection(paneTree, activePaneId, "right");
      if (targetId) {
        setActivePaneId(targetId);
        terminalRegistry.focusTerminal(targetId);
      }
    },
  });

  registerAction({
    id: "terminal.focus-up",
    label: "Focus Pane Up",
    shortcut: "Cmd+Alt+ArrowUp",
    keywords: ["navigate", "switch", "pane"],
    icon: "arrow-up",
    category: "terminal",
    execute: () => {
      const { paneTree, activePaneId, setActivePaneId } = useAppStore.getState();
      const targetId = findPaneInDirection(paneTree, activePaneId, "up");
      if (targetId) {
        setActivePaneId(targetId);
        terminalRegistry.focusTerminal(targetId);
      }
    },
  });

  registerAction({
    id: "terminal.focus-down",
    label: "Focus Pane Down",
    shortcut: "Cmd+Alt+ArrowDown",
    keywords: ["navigate", "switch", "pane"],
    icon: "arrow-down",
    category: "terminal",
    execute: () => {
      const { paneTree, activePaneId, setActivePaneId } = useAppStore.getState();
      const targetId = findPaneInDirection(paneTree, activePaneId, "down");
      if (targetId) {
        setActivePaneId(targetId);
        terminalRegistry.focusTerminal(targetId);
      }
    },
  });

  registerAction({
    id: "view.zoom-in",
    label: "Zoom In",
    shortcut: "Cmd+=",
    keywords: ["scale", "bigger", "larger", "font", "size"],
    icon: "plus",
    category: "general",
    execute: zoomIn,
  });

  registerAction({
    id: "view.zoom-out",
    label: "Zoom Out",
    shortcut: "Cmd+-",
    keywords: ["scale", "smaller", "font", "size"],
    icon: "minus",
    category: "general",
    execute: zoomOut,
  });

  registerAction({
    id: "view.reset-zoom",
    label: "Reset Zoom",
    shortcut: "Cmd+0",
    keywords: ["scale", "default", "font", "size", "actual"],
    icon: "refresh",
    category: "general",
    execute: resetZoom,
  });

}
