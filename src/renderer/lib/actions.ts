import { useAppStore, collectLeafIds } from "../store/appStore.js";
import { terminalRegistry } from "../components/TerminalRegistry.js";
import { pendingInputs } from "../components/PaneContainer.js";

export interface Action {
  id: string;
  label: string;
  shortcut?: string;
  keywords?: string[];
  category: "general" | "terminal" | "agent" | "theme";
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
    category: "general",
    execute: openPalette,
    hidden: true,
  });

  registerAction({
    id: "terminal.split-horizontal",
    label: "Split Terminal Right",
    shortcut: "Cmd+D",
    keywords: ["pane", "divide"],
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
    category: "general",
    execute: () => {
      window.location.reload();
    },
  });

  registerAction({
    id: "theme.change",
    label: "Change Theme...",
    keywords: ["color", "appearance", "dark", "light", "scheme"],
    category: "theme",
    execute: openThemePicker,
  });

  registerAction({
    id: "workspace.rename",
    label: "Rename Workspace",
    keywords: ["name", "title", "tab"],
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
    category: "terminal",
    execute: () => {
      terminalRegistry.clearTerminal(useAppStore.getState().activePaneId);
    },
  });

  registerAction({
    id: "terminal.restart",
    label: "Restart Terminal",
    keywords: ["reboot", "refresh", "kill", "respawn"],
    category: "terminal",
    execute: () => {
      terminalRegistry.restart(useAppStore.getState().activePaneId);
    },
  });

  registerAction({
    id: "terminal.copy-output",
    label: "Copy Terminal Output",
    keywords: ["buffer", "clipboard", "text", "copy"],
    category: "terminal",
    execute: () => {
      terminalRegistry.copyOutput(useAppStore.getState().activePaneId);
    },
  });

  registerAction({
    id: "terminal.focus-next",
    label: "Focus Next Pane",
    keywords: ["switch", "cycle", "navigate"],
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
    category: "general",
    execute: () => {
      window.bump.toggleFullscreen();
    },
  });

}
