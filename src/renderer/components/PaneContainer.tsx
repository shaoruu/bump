import { memo, useCallback, useRef, useEffect, useState } from "react";
import { useAppStore } from "../store/appStore.js";
import type { PaneNode } from "../store/appStore.js";
import { SplitView } from "./SplitView.js";
import { terminalRegistry } from "./TerminalRegistry.js";

type DropZone = "left" | "right" | "top" | "bottom" | "center";

let currentDragPaneId: string | null = null;
const pendingInputs = new Map<string, string>();

function countLeaves(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

function handleTerminalExit(paneId: string) {
  const { paneTree, closePane } = useAppStore.getState();
  const leafCount = countLeaves(paneTree);

  if (leafCount > 1) {
    terminalRegistry.destroy(paneId);
    closePane(paneId);
  } else {
    terminalRegistry.restart(paneId);
  }
}

function computeDropZone(
  clientX: number,
  clientY: number,
  rect: DOMRect
): DropZone {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const margin = 0.25;
  if (x < margin) return "left";
  if (x > 1 - margin) return "right";
  if (y < margin) return "top";
  if (y > 1 - margin) return "bottom";
  return "center";
}

export function PaneContainer() {
  const paneTree = useAppStore((s) => s.paneTree);

  return (
    <div className="flex-1 h-full overflow-hidden">
      <PaneNodeRenderer node={paneTree} />
    </div>
  );
}

const PaneNodeRenderer = memo(function PaneNodeRenderer({
  node,
}: {
  node: PaneNode;
}) {
  if (node.type === "leaf") {
    return <PaneSlot paneId={node.paneId} />;
  }

  return (
    <SplitView
      splitId={node.id}
      direction={node.direction}
      sizes={node.sizes}
      left={<PaneNodeRenderer node={node.children[0]} />}
      right={<PaneNodeRenderer node={node.children[1]} />}
    />
  );
});

function PaneSlot({ paneId }: { paneId: string }) {
  const activePaneId = useAppStore((s) => s.activePaneId);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setTerminalId = useAppStore((s) => s.setTerminalId);
  const initialCwd = useAppStore((s) => s.panes.get(paneId)?.initialCwd);
  const isActive = activePaneId === paneId;
  const slotRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("terminal " + paneId);
  const terminalIdRef = useRef<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const enterCountRef = useRef(0);
  const dropZoneRef = useRef<DropZone | null>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    const entry = terminalRegistry.getOrCreate(
      paneId,
      {
        onReady: (terminalId) => {
          setTerminalId(paneId, terminalId);
          terminalIdRef.current = terminalId;
          const input = pendingInputs.get(paneId);
          if (input) {
            pendingInputs.delete(paneId);
            setTimeout(() => {
              window.bump.writeTerminal(terminalId, input);
            }, 300);
          }
        },
        onExit: handleTerminalExit,
      },
      initialCwd
    );

    slot.appendChild(entry.container);

    return () => {
      if (entry.container.parentNode === slot) {
        slot.removeChild(entry.container);
      }
    };
  }, [paneId, setTerminalId]);

  useEffect(() => {
    const check = setInterval(() => {
      if (terminalIdRef.current) {
        clearInterval(check);
        const unsub = window.bump.onTerminalTitle(
          terminalIdRef.current,
          setTitle
        );
        return () => unsub();
      }
    }, 50);
    return () => clearInterval(check);
  }, []);

  const handleFocus = useCallback(() => {
    setActivePaneId(paneId);
  }, [paneId, setActivePaneId]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData("application/x-pane-id", paneId);
      e.dataTransfer.effectAllowed = "move";
      currentDragPaneId = paneId;
      setIsDragging(true);
    },
    [paneId]
  );

  const handleDragEnd = useCallback(() => {
    currentDragPaneId = null;
    setIsDragging(false);
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!currentDragPaneId || currentDragPaneId === paneId) return;
      e.preventDefault();
      enterCountRef.current++;
    },
    [paneId]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!currentDragPaneId || currentDragPaneId === paneId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = computeDropZone(e.clientX, e.clientY, rect);
      dropZoneRef.current = zone;
      setDropZone(zone);
    },
    [paneId]
  );

  const handleDragLeave = useCallback(() => {
    enterCountRef.current--;
    if (enterCountRef.current <= 0) {
      enterCountRef.current = 0;
      dropZoneRef.current = null;
      setDropZone(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      enterCountRef.current = 0;
      const sourcePaneId = e.dataTransfer.getData("application/x-pane-id");
      const zone = dropZoneRef.current;
      dropZoneRef.current = null;
      setDropZone(null);
      if (!sourcePaneId || sourcePaneId === paneId || !zone) return;
      const store = useAppStore.getState();
      if (zone === "center") {
        store.swapPanes(sourcePaneId, paneId);
      } else {
        store.movePane(sourcePaneId, paneId, zone);
      }
    },
    [paneId]
  );

  const shortTitle = title.split("/").slice(-2).join("/");

  return (
    <div
      className={`h-full w-full relative flex flex-col ${
        isActive ? "ring-1 ring-inset ring-accent/20" : ""
      } ${isDragging ? "opacity-50" : ""}`}
      onMouseDown={handleFocus}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="h-6 shrink-0 flex items-center px-2 bg-surface-1 text-2xs text-text-tertiary select-none border-b border-white/[0.06] cursor-grab active:cursor-grabbing group/header"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <span className="flex-1 truncate">{shortTitle}</span>
        <button
          ref={menuButtonRef}
          onClick={() => setMenuOpen((prev) => !prev)}
          className="shrink-0 px-0.5 text-text-tertiary hover:text-text-secondary opacity-0 group-hover/header:opacity-100 transition-opacity"
        >
          ...
        </button>
      </div>
      <div ref={slotRef} className="flex-1 min-h-0" />
      {dropZone && <DropOverlay zone={dropZone} />}
      {menuOpen && (
        <PaneMenu
          paneId={paneId}
          triggerRef={menuButtonRef}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

function DropOverlay({ zone }: { zone: DropZone }) {
  const zoneClass: Record<DropZone, string> = {
    left: "left-0 top-0 w-1/2 h-full",
    right: "right-0 top-0 w-1/2 h-full",
    top: "left-0 top-0 w-full h-1/2",
    bottom: "left-0 bottom-0 w-full h-1/2",
    center: "inset-0",
  };

  return (
    <div
      className={`absolute pointer-events-none z-10 bg-accent/10 border border-accent/25 ${zoneClass[zone]}`}
    />
  );
}

function PaneMenu({
  paneId,
  triggerRef,
  onClose,
}: {
  paneId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!triggerRef.current || !triggerRef.current.contains(target))
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, triggerRef]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const splitRight = () => {
    const terminalId = useAppStore.getState().panes.get(paneId)?.terminalId;
    if (terminalId) {
      window.bump.getTerminalCwd(terminalId).then((cwd) => {
        useAppStore.getState().splitPane(paneId, "horizontal", cwd ?? undefined);
      });
    } else {
      useAppStore.getState().splitPane(paneId, "horizontal");
    }
    onClose();
  };

  const splitDown = () => {
    const terminalId = useAppStore.getState().panes.get(paneId)?.terminalId;
    if (terminalId) {
      window.bump.getTerminalCwd(terminalId).then((cwd) => {
        useAppStore.getState().splitPane(paneId, "vertical", cwd ?? undefined);
      });
    } else {
      useAppStore.getState().splitPane(paneId, "vertical");
    }
    onClose();
  };

  const fixFurther = async () => {
    onClose();
    const terminalId = useAppStore.getState().panes.get(paneId)?.terminalId;
    if (!terminalId) return;
    const [infos, cwd] = await Promise.all([
      window.bump.getTerminalInfo(),
      window.bump.getTerminalCwd(terminalId),
    ]);
    const info = infos.find((i) => i.id === terminalId);
    const newPaneId = useAppStore
      .getState()
      .splitPane(paneId, "horizontal", cwd ?? undefined);
    if (info?.logPath) {
      pendingInputs.set(
        newPaneId,
        `cursor "in the terminal logs ${info.logPath}, "`
      );
    }
  };

  const closePane = () => {
    const { paneTree, workspaces } = useAppStore.getState();
    if (paneTree.type === "leaf" && workspaces.length <= 1) {
      terminalRegistry.destroy(paneId);
      window.bump.closeWindow();
      onClose();
      return;
    }
    terminalRegistry.destroy(paneId);
    useAppStore.getState().closePane(paneId);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="absolute top-6 right-0 z-50 bg-surface-1 border border-border py-1 min-w-[160px] shadow-lg"
    >
      <MenuButton label="Split Right" shortcut="⌘D" onClick={splitRight} />
      <MenuButton label="Split Down" shortcut="⌘⇧D" onClick={splitDown} />
      <div className="h-px bg-white/[0.06] mx-2 my-1" />
      <MenuButton label="Fix further..." onClick={fixFurther} />
      <div className="h-px bg-white/[0.06] mx-2 my-1" />
      <MenuButton label="Close" shortcut="⌘W" onClick={closePane} />
    </div>
  );
}

function MenuButton({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-1 text-2xs text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
    >
      <span>{label}</span>
      {shortcut && <span className="text-text-tertiary ml-4">{shortcut}</span>}
    </button>
  );
}
