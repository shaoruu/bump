import { useEffect, useState, useCallback } from "react";
import { PaneContainer } from "./components/PaneContainer.js";
import { TabBar } from "./components/TabBar.js";
import { LoginView } from "./components/LoginView.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { PromptDialog } from "./components/Dialog.js";
import { useAppStore } from "./store/appStore.js";
import { registerCoreActions, getActions, initUiScale } from "./lib/actions.js";
import { terminalRegistry } from "./components/TerminalRegistry.js";
import { loadPersistedLayout, startLayoutPersistence } from "./lib/layout-persistence.js";

export function App() {
  const isLayoutLoaded = useAppStore((s) => s.isLayoutLoaded);
  const isAuthChecked = useAppStore((s) => s.isAuthChecked);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuth = useAppStore((s) => s.setAuth);
  const setAuthChecked = useAppStore((s) => s.setAuthChecked);
  const promptDialog = useAppStore((s) => s.promptDialog);
  const closePrompt = useAppStore((s) => s.closePrompt);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"actions" | "themes">("actions");

  const openPalette = useCallback(() => {
    setPaletteMode("actions");
    setPaletteOpen(true);
  }, []);

  const openThemePicker = useCallback(() => {
    setPaletteMode("themes");
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    registerCoreActions(openPalette, openThemePicker);
  }, [openPalette, openThemePicker]);

  useEffect(() => {
    initUiScale();
  }, []);

  useEffect(() => {
    return window.bump.onShortcut((shortcut) => {
      if (shortcut === "Cmd+P") {
        setPaletteOpen((prev) => !prev);
        return;
      }

      const match = shortcut.match(/^Cmd\+(\d)$/);
      if (match) {
        const index = parseInt(match[1], 10) - 1;
        const { workspaces, switchWorkspace } = useAppStore.getState();
        if (index < workspaces.length) {
          switchWorkspace(workspaces[index].id);
        }
        return;
      }

      const actions = getActions();
      for (const action of actions) {
        if (!action.shortcut) continue;
        if (normalizeShortcut(action.shortcut) === shortcut) {
          action.execute();
          return;
        }
      }
    });
  }, []);

  useEffect(() => {
    loadPersistedLayout();
  }, []);

  useEffect(() => {
    if (!isLayoutLoaded) return;
    return startLayoutPersistence();
  }, [isLayoutLoaded]);

  useEffect(() => {
    window.bump.checkAuth().then((status) => {
      setAuth(status.authenticated, status.email);
      setAuthChecked();
    });
  }, [setAuth, setAuthChecked]);

  useEffect(() => {
    return window.bump.onMenuCopy(() => {
      const { activePaneId } = useAppStore.getState();
      terminalRegistry.copySelection(activePaneId);
    });
  }, []);

  useEffect(() => {
    return window.bump.onMenuPaste(() => {
      window.bump.readClipboard().then((text) => {
        if (text) {
          const { activePaneId } = useAppStore.getState();
          terminalRegistry.pasteToTerminal(activePaneId, text);
        }
      });
    });
  }, []);

  useEffect(() => {
    return window.bump.onMenuSelectAll(() => {
      const { activePaneId } = useAppStore.getState();
      terminalRegistry.selectAll(activePaneId);
    });
  }, []);

  if (!isAuthChecked || !isLayoutLoaded) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-0">
        <span className="text-xs text-text-tertiary">loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    const handleRefresh = async () => {
      const status = await window.bump.checkAuth();
      setAuth(status.authenticated, status.email);
    };

    return <LoginView onRefresh={handleRefresh} />;
  }

  return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 min-h-0">
        <PaneContainer />
      </div>
      {paletteOpen && (
        <CommandPalette
          initialMode={paletteMode}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {promptDialog && (
        <PromptDialog
          open
          title={promptDialog.title}
          defaultValue={promptDialog.defaultValue}
          placeholder={promptDialog.placeholder}
          submitLabel={promptDialog.submitLabel}
          onSubmit={promptDialog.onSubmit}
          onClose={closePrompt}
        />
      )}
    </div>
  );
}

function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.split("+").map((s) => s.trim());
  const result: string[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "cmd" || lower === "cmdorctrl") result.push("Cmd");
    else if (lower === "shift") result.push("Shift");
    else if (lower === "alt" || lower === "option") result.push("Alt");
    else if (lower === "ctrl") result.push("Ctrl");
    else if (lower.startsWith("arrow")) result.push(part);
    else if (part === "=") result.push("=");
    else if (part === "-") result.push("-");
    else if (part === "0") result.push("0");
    else result.push(part.toUpperCase());
  }

  const modifiers = ["Cmd", "Shift", "Alt", "Ctrl"];
  const mods = result.filter((p) => modifiers.includes(p));
  const keys = result.filter((p) => !modifiers.includes(p));

  return [...mods, ...keys].join("+");
}
