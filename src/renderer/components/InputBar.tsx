import { useState, useRef, useCallback, useEffect } from "react";
import { useAppStore } from "../store/appStore.js";
import { terminalRegistry } from "./TerminalRegistry.js";

export function InputBar() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const addUserMessage = useAppStore((s) => s.addUserMessage);
  const appendAgentText = useAppStore((s) => s.appendAgentText);
  const setAgentStatus = useAppStore((s) => s.setAgentStatus);
  const setAgentPanelVisible = useAppStore((s) => s.setAgentPanelVisible);
  const mode = useAppStore((s) => s.mode);

  useEffect(() => {
    if (mode === "agent") {
      inputRef.current?.focus();
    }
  }, [mode]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    setInput("");
    addUserMessage(text);
    setAgentPanelVisible(true);
    setAgentStatus("active");

    try {
      const activeTerminalId = useAppStore.getState().getActiveTerminalId();
      let terminalContext: string | undefined;
      if (activeTerminalId) {
        terminalContext = await window.bump.getTerminalBuffer(activeTerminalId);
      }

      const status = await window.bump.getAgentStatus();
      if (status === "idle") {
        const cwd = await window.bump.getCwd();
        await window.bump.startAgent(cwd);
      }

      await window.bump.promptAgent(text, terminalContext);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent error";
      appendAgentText(`\n[Error: ${message}]`);
    } finally {
      setAgentStatus("idle");
    }
  }, [
    input,
    addUserMessage,
    setAgentPanelVisible,
    setAgentStatus,
    appendAgentText,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        const { activePaneId } = useAppStore.getState();
        terminalRegistry.focusTerminal(activePaneId);
      }
    },
    [handleSubmit, agentStatus]
  );

  if (mode !== "agent") return null;

  return (
    <div className="border-t border-border bg-surface-1 px-3 py-2 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          agentStatus === "active" ? "agent is working..." : "ask anything..."
        }
        className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-tertiary border-none outline-none "
        autoFocus
      />
      <span className="text-2xs text-text-tertiary shrink-0">
        cmd+i
      </span>
    </div>
  );
}
