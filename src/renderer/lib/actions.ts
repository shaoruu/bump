import { useAppStore } from "../store/appStore.js";
import { terminalRegistry } from "../components/TerminalRegistry.js";

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
    id: "mode.toggle",
    label: "Toggle Agent Mode",
    shortcut: "Cmd+I",
    keywords: ["ai", "chat", "switch"],
    category: "agent",
    execute: () => {
      const store = useAppStore.getState();
      store.toggleMode();
      if (store.mode === "agent") {
        terminalRegistry.focusTerminal(store.activePaneId);
      }
    },
  });

  registerAction({
    id: "agent.clear",
    label: "Clear Agent History",
    keywords: ["reset", "delete", "messages"],
    category: "agent",
    execute: () => {
      useAppStore.getState().clearAgentMessages();
    },
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
    id: "chat.new",
    label: "New Chat",
    shortcut: "Cmd+N",
    category: "agent",
    execute: () => {
      useAppStore.getState().createChat();
    },
  });

  registerAction({
    id: "chat.switch",
    label: "Switch Chat...",
    category: "agent",
    execute: openPalette,
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
}
