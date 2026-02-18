import { useState, useRef, useCallback, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../store/appStore.js";
import { terminalRegistry } from "./TerminalRegistry.js";


function useGitBranch(): string | null {
  const [branch, setBranch] = useState<string | null>(null);
  const terminalId = useAppStore((s) => s.panes.get(s.activePaneId)?.terminalId ?? null);

  useEffect(() => {
    if (!terminalId) {
      setBranch(null);
      return;
    }

    let cancelled = false;
    const check = async () => {
      const b = await window.bump.getTerminalGitBranch(terminalId);
      if (!cancelled) setBranch(b);
    };

    check();
    const interval = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [terminalId]);

  return branch;
}

function useCurrentTime() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return time;
}


export function TabBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const time = useCurrentTime();
  const branch = useGitBranch();

  useEffect(() => {
    window.bump.isFullscreen().then(setIsFullscreen);
    return window.bump.onFullscreenChange(setIsFullscreen);
  }, []);

  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useAppStore((s) => s.switchWorkspace);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const reorderWorkspaces = useAppStore((s) => s.reorderWorkspaces);
  const createWorkspace = useAppStore((s) => s.createWorkspace);

  const formatTime = () => {
    const hours = time.getHours();
    const minutes = time.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "pm" : "am";
    const h = hours % 12 || 12;
    return `${h}:${minutes}${ampm}`;
  };

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
          modifiers={[restrictToHorizontalAxis]}
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
      <div className="shrink-0 titlebar-no-drag pr-2 flex items-center gap-2 text-2xs text-text-tertiary">
        {branch && (
          <span className="flex items-center gap-1 max-w-[120px]">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
              <circle cx="2" cy="1.5" r="1.2" fill="currentColor" />
              <circle cx="2" cy="7.5" r="1.2" fill="currentColor" />
              <circle cx="7" cy="3.5" r="1.2" fill="currentColor" />
              <path d="M2 2.7V5M2 5C2 6.2 7 6 7 4.7V4.7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
            </svg>
            <span className="truncate">{branch}</span>
          </span>
        )}
        <span>{formatTime()}</span>
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
