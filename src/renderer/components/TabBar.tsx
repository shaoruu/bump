import { useState, useRef, useCallback, useEffect } from "react";
import { useAppStore } from "../store/appStore.js";
import { terminalRegistry } from "./TerminalRegistry.js";

export function TabBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    return window.bump.onFullscreenChange(setIsFullscreen);
  }, []);

  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useAppStore((s) => s.switchWorkspace);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const reorderWorkspaces = useAppStore((s) => s.reorderWorkspaces);
  const createWorkspace = useAppStore((s) => s.createWorkspace);
  const mode = useAppStore((s) => s.mode);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const toggleMode = useAppStore((s) => s.toggleMode);

  const handleCloseWorkspace = useCallback((wsId: string) => {
    const state = useAppStore.getState();
    if (state.workspaces.length <= 1) return;

    const panes = wsId === state.activeWorkspaceId
      ? state.panes
      : new Map(state.workspaces.find(w => w.id === wsId)!.panes);

    for (const [paneId] of panes) {
      terminalRegistry.destroy(paneId);
    }

    closeWorkspace(wsId);
  }, [closeWorkspace]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((id: string) => {
    setDragId(id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragId && dragId !== id) {
      setDragOverId(id);
    }
  }, [dragId]);

  const handleDrop = useCallback((targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = workspaces.map((w) => w.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    newIds.splice(toIdx, 0, dragId);
    reorderWorkspaces(newIds);
    setDragId(null);
    setDragOverId(null);
  }, [dragId, workspaces, reorderWorkspaces]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  return (
    <div className="flex items-center h-[32px] bg-surface-1 select-none titlebar-drag border-b border-border">
      <div className={`${isFullscreen ? "w-2" : "w-[78px]"} shrink-0`} />
      <div className="flex-1 flex items-center min-w-0 overflow-x-auto gap-0.5 titlebar-no-drag">
        {workspaces.map((ws, idx) => (
          <Tab
            key={ws.id}
            id={ws.id}
            name={ws.name}
            isActive={ws.id === activeWorkspaceId}
            isDragOver={ws.id === dragOverId}
            index={idx}
            canClose={workspaces.length > 1}
            onSelect={() => switchWorkspace(ws.id)}
            onClose={() => handleCloseWorkspace(ws.id)}
            onRename={(name) => renameWorkspace(ws.id, name)}
            onDragStart={() => handleDragStart(ws.id)}
            onDragOver={(e) => handleDragOver(e, ws.id)}
            onDrop={() => handleDrop(ws.id)}
            onDragEnd={handleDragEnd}
          />
        ))}
        <button
          onClick={() => createWorkspace()}
          className="shrink-0 px-2 h-full text-text-tertiary hover:text-text-secondary text-xs transition-colors"
        >
          +
        </button>
      </div>
      <div className="shrink-0 titlebar-no-drag pr-2">
        <button
          onClick={toggleMode}
          className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-white/[0.06] active:bg-white/[0.1] transition-colors"
        >
          <span
            className={`inline-block w-1.5 h-1.5 transition-colors ${
              mode === "agent"
                ? agentStatus === "active"
                  ? "bg-accent animate-pulse"
                  : "bg-accent"
                : "bg-text-tertiary"
            }`}
          />
          <span className="text-2xs text-text-secondary">
            {mode === "shell" ? "shell" : "agent"}
          </span>
        </button>
      </div>
    </div>
  );
}

interface TabProps {
  id: string;
  name: string;
  isActive: boolean;
  isDragOver: boolean;
  index: number;
  canClose: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function Tab({
  name,
  isActive,
  isDragOver,
  index,
  canClose,
  onSelect,
  onClose,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TabProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const handleDoubleClick = useCallback(() => {
    setEditValue(name);
    setEditing(true);
  }, [name]);

  const handleSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
      if (e.key === "Escape") setEditing(false);
    },
    [handleSubmit]
  );

  return (
    <div
      draggable={!editing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      className={`flex items-center gap-1 px-1.5 py-1 text-xs cursor-pointer transition-colors group shrink-0 ${
        isActive ? "bg-white/[0.04] text-text-primary" : "text-text-tertiary hover:text-text-secondary hover:bg-white/[0.03]"
      } ${isDragOver ? "border-l border-accent" : ""}`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="bg-transparent text-xs text-text-primary outline-none w-20"
          style={{ fontStyle: "normal", lineHeight: "20px" }}
          autoFocus
        />
      ) : (
        <span className="truncate max-w-[120px]">{name}</span>
      )}
      {!editing && (index < 9 || canClose) && (
        <span className="w-3 h-3 flex items-center justify-center text-2xs leading-none shrink-0">
          {index < 9 && (
            <span className={`text-text-tertiary ${canClose ? "group-hover:hidden" : ""}`}>
              {index + 1}
            </span>
          )}
          {canClose && (
            <span
              className="hidden group-hover:flex items-center justify-center text-text-tertiary hover:text-text-primary cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
            >
              ×
            </span>
          )}
        </span>
      )}
    </div>
  );
}
