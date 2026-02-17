import { useEffect } from "react";
import { PaneContainer } from "./components/PaneContainer.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { InputBar } from "./components/InputBar.js";
import { ModeIndicator } from "./components/ModeIndicator.js";
import { PermissionModal } from "./components/PermissionModal.js";
import { LoginView } from "./components/LoginView.js";
import { useAppStore } from "./store/appStore.js";
import { terminalRegistry } from "./components/TerminalRegistry.js";

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        const { activePaneId, splitPane } = useAppStore.getState();
        splitPane(activePaneId, "horizontal");
      }

      if (e.metaKey && e.key === "d" && e.shiftKey) {
        e.preventDefault();
        const { activePaneId, splitPane } = useAppStore.getState();
        splitPane(activePaneId, "vertical");
      }

      if (e.metaKey && e.key === "i") {
        e.preventDefault();
        const store = useAppStore.getState();
        store.toggleMode();
        if (store.mode === "agent") {
          terminalRegistry.focusTerminal(store.activePaneId);
        }
        return;
      }

      if (e.metaKey && e.key === "w") {
        e.preventDefault();
        const { activePaneId, closePane } = useAppStore.getState();
        terminalRegistry.destroy(activePaneId);
        closePane(activePaneId);
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
      <ModeIndicator />
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
            <div className="flex items-center justify-between px-3 h-8 border-b border-border">
              <span className="text-2xs text-text-secondary">
                agent
              </span>
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
    </div>
  );
}
