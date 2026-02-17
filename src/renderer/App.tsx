import { useEffect, useState, useCallback } from "react";
import { PaneContainer } from "./components/PaneContainer.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { InputBar } from "./components/InputBar.js";
import { TabBar } from "./components/TabBar.js";
import { PermissionModal } from "./components/PermissionModal.js";
import { LoginView } from "./components/LoginView.js";
import { ChatMenu } from "./components/ChatMenu.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { PromptDialog } from "./components/Dialog.js";
import { useAppStore } from "./store/appStore.js";
import { registerCoreActions, getActions, executeAction } from "./lib/actions.js";

export function App() {
  const isAuthChecked = useAppStore((s) => s.isAuthChecked);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuth = useAppStore((s) => s.setAuth);
  const setAuthChecked = useAppStore((s) => s.setAuthChecked);
  const appendAgentText = useAppStore((s) => s.appendAgentText);
  const addToolCall = useAppStore((s) => s.addToolCall);
  const updateToolCall = useAppStore((s) => s.updateToolCall);
  const setPendingPermission = useAppStore((s) => s.setPendingPermission);
  const agentPanelVisible = useAppStore((s) => s.agentPanelVisible);
  const mode = useAppStore((s) => s.mode);
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
    window.bump.checkAuth().then((status) => {
      setAuth(status.authenticated, status.email);
      setAuthChecked();
    });
  }, [setAuth, setAuthChecked]);

  useEffect(() => {
    const unsubUpdate = window.bump.onAgentUpdate((update) => {
      if (update.sessionUpdate === "agent_message_chunk") {
        if (update.content.type === "text") {
          appendAgentText(update.content.text);
        }
      } else if (update.sessionUpdate === "tool_call") {
        addToolCall({
          toolCallId: update.toolCallId,
          title: update.title,
          subtitle: update.subtitle,
          kind: update.kind,
          status: "pending",
          rawInput: update.rawInput,
          timestamp: Date.now(),
        });
      } else if (update.sessionUpdate === "tool_call_update") {
        updateToolCall(update.toolCallId, {
          status: update.status,
          content: update.content,
          rawOutput: update.rawOutput,
        });
      }
    });

    const unsubPermission = window.bump.onPermissionRequest((request) => {
      setPendingPermission(request);
    });

    return () => {
      unsubUpdate();
      unsubPermission();
    };
  }, [appendAgentText, addToolCall, updateToolCall, setPendingPermission]);

  useEffect(() => {
    return window.bump.onClosePane(() => {
      executeAction("terminal.close");
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

  if (!isAuthChecked) {
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
      <div className="flex-1 flex min-h-0">
        <div
          className={`flex-1 min-w-0 ${
            agentPanelVisible ? "border-r border-border" : ""
          }`}
        >
          <PaneContainer />
        </div>
        {agentPanelVisible && (
          <div className="w-[360px] shrink-0 bg-surface-0 flex flex-col">
            <div className="flex items-center justify-between px-2 h-6 border-b border-white/[0.06]">
              <ChatMenu />
              <button
                onClick={() =>
                  useAppStore.getState().setAgentPanelVisible(false)
                }
                className="text-2xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                close
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <AgentPanel />
            </div>
          </div>
        )}
      </div>
      {mode === "agent" && <InputBar />}
      <PermissionModal />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
  const key = parts.filter((p) => p !== "cmd" && p !== "shift")[0];

  if (!key) return false;
  if (needsMeta !== e.metaKey) return false;
  if (needsShift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key;
}
