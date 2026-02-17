import { useState, useRef, useCallback, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const workspaceIds = workspaces.map((w) => w.id);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = workspaceIds.indexOf(active.id as string);
      const newIndex = workspaceIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderWorkspaces(arrayMove(workspaceIds, oldIndex, newIndex));
    },
    [workspaceIds, reorderWorkspaces]
  );

  return (
    <div className="flex items-center h-[32px] bg-surface-1 select-none titlebar-drag border-b border-border">
      <div className={`${isFullscreen ? "w-2" : "w-[78px]"} shrink-0`} />
      <div className="flex-1 flex items-center min-w-0 overflow-x-auto gap-0.5 titlebar-no-drag">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={workspaceIds}
            strategy={horizontalListSortingStrategy}
          >
            {workspaces.map((ws, idx) => (
              <SortableTab
                key={ws.id}
                id={ws.id}
                name={ws.name}
                isActive={ws.id === activeWorkspaceId}
                index={idx}
                canClose={workspaces.length > 1}
                onSelect={() => switchWorkspace(ws.id)}
                onClose={() => handleCloseWorkspace(ws.id)}
                onRename={(name) => renameWorkspace(ws.id, name)}
              />
            ))}
          </SortableContext>
        </DndContext>
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

interface SortableTabProps {
  id: string;
  name: string;
  isActive: boolean;
  index: number;
  canClose: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

function SortableTab({
  id,
  name,
  isActive,
  index,
  canClose,
  onSelect,
  onClose,
  onRename,
}: SortableTabProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: editing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

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
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(editing ? {} : listeners)}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      className={`flex items-center gap-1 px-1.5 py-1 text-xs cursor-pointer transition-colors group shrink-0 ${
        isActive ? "bg-white/[0.04] text-text-primary" : "text-text-tertiary hover:text-text-secondary hover:bg-white/[0.03]"
      }`}
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
