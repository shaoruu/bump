import { useEffect, useState, useCallback } from "react";
import { PaneContainer } from "./components/PaneContainer.js";
import { TabBar } from "./components/TabBar.js";
import { LoginView } from "./components/LoginView.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { PromptDialog } from "./components/Dialog.js";
import { useAppStore } from "./store/appStore.js";
import { registerCoreActions, getActions, executeAction } from "./lib/actions.js";
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
    return window.bump.onClosePane(() => {
      executeAction("terminal.close");
    });
  }, []);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "p") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        const { workspaces, switchWorkspace } = useAppStore.getState();
        if (index < workspaces.length) {
          switchWorkspace(workspaces[index].id);
        }
        return;
      }

      const actions = getActions();
      for (const action of actions) {
        if (!action.shortcut) continue;
        if (matchShortcut(e, action.shortcut)) {
          e.preventDefault();
          action.execute();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+").map((s) => s.trim());
  const needsMeta = parts.includes("cmd");
  const needsShift = parts.includes("shift");
  const needsCtrl = parts.includes("ctrl");
  const key = parts.filter((p) => p !== "cmd" && p !== "shift" && p !== "ctrl")[0];

  if (!key) return false;
  if (needsMeta !== e.metaKey) return false;
  if (needsShift !== e.shiftKey) return false;
  if (needsCtrl !== e.ctrlKey) return false;
  return e.key.toLowerCase() === key;
}
