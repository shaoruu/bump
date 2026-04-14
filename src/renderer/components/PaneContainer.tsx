import { memo, useCallback, useRef, useEffect, useState, useMemo } from "react";
import { useAppStore } from "../store/appStore.js";
import type { PaneNode } from "../store/appStore.js";
import { SplitView } from "./SplitView.js";
import { terminalRegistry } from "./TerminalRegistry.js";
import { CopyIcon, ZapIcon, MoreHorizontalIcon, CheckIcon } from "./Icons.js";
import { Tooltip } from "./Tooltip.js";
import { useMenuPosition, type Position } from "../hooks/useMenuPosition.js";

type DropZone = "left" | "right" | "top" | "bottom" | "center";

let currentDragPaneId: string | null = null;

function shellEscape(path: string): string {
  if (!/[^a-zA-Z0-9_./-]/.test(path)) {
    return path;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}
export const pendingInputs = new Map<string, string>();

function useTerminalCwd(paneId: string): string | null {
  const [cwd, setCwd] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const terminalId = useAppStore((s) => s.panes.get(paneId)?.terminalId ?? null);

  useEffect(() => {
    window.bump.getCwd().then(setHome);
  }, []);

  useEffect(() => {
    if (!terminalId) {
      setCwd(null);
      return;
    }

    let cancelled = false;
    const check = async () => {
      const dir = await window.bump.getTerminalCwd(terminalId);
      if (!cancelled) setCwd(dir);
    };

    check();
    const interval = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [terminalId]);

  return useMemo(() => {
    if (!cwd) return null;
    if (home && cwd.startsWith(home)) return "~" + cwd.slice(home.length);
    return cwd;
  }, [cwd, home]);
}

function useGitBranch(paneId: string): string | null {
  const [branch, setBranch] = useState<string | null>(null);
  const terminalId = useAppStore((s) => s.panes.get(paneId)?.terminalId ?? null);

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
      key={node.id}
      splitId={node.id}
      direction={node.direction}
      sizes={node.sizes}
      left={<PaneNodeRenderer node={node.children[0]} />}
      right={<PaneNodeRenderer node={node.children[1]} />}
    />
  );
});

function PaneSlot({ paneId }: { paneId: string }) {
  const isActive = useAppStore((s) => s.activePaneId === paneId);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const initialCwd = useAppStore((s) => s.panes.get(paneId)?.initialCwd);
  const slotRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("terminal " + paneId);
  const terminalIdRef = useRef<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, openContextMenu, closeContextMenu] = useMenuPosition();
  const [headerContextMenu, openHeaderContextMenu, closeHeaderContextMenu] = useMenuPosition();
  const [isReady, setIsReady] = useState(false);
  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const enterCountRef = useRef(0);
  const fileEnterCountRef = useRef(0);
  const dropZoneRef = useRef<DropZone | null>(null);

  const themeVersion = useAppStore((s) => s.themeVersion);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    const entry = terminalRegistry.getOrCreate(
      paneId,
      {
        onReady: (terminalId) => {
          useAppStore.getState().setTerminalId(paneId, terminalId);
          terminalIdRef.current = terminalId;
          setIsReady(true);
          const input = pendingInputs.get(paneId);
          if (input) {
            pendingInputs.delete(paneId);
            setTimeout(() => {
              window.bump.writeTerminal(terminalId, input);
            }, 300);
          }
        },
        onVisible: () => {
          setIsTerminalVisible(true);
        },
        onExit: handleTerminalExit,
      },
      initialCwd
    );

    if (entry.terminalId) {
      terminalIdRef.current = entry.terminalId;
    }
    setIsReady(entry.isReady);
    setIsTerminalVisible(entry.isVisible);

    slot.appendChild(entry.container);

    return () => {
      if (entry.container.parentNode === slot) {
        slot.removeChild(entry.container);
      }
    };
  }, [paneId]);

  useEffect(() => {
    if (themeVersion === 0) return;
    const entry = terminalRegistry.get(paneId);
    if (entry?.terminal?.wasmTerm && entry.terminal.renderer) {
      const renderer = entry.terminal.renderer;
      (renderer as { render: Function }).render(
        entry.terminal.wasmTerm, true, entry.terminal.viewportY, entry.terminal
      );
    }
  }, [paneId, themeVersion]);

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        terminalRegistry.focusTerminal(paneId);
      });
    }
  }, [isActive, paneId]);

  useEffect(() => {
    if (!isReady || !terminalIdRef.current) return;
    return window.bump.onTerminalTitle(terminalIdRef.current, setTitle);
  }, [isReady]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const handler = (e: Event) => {
      const { x, y } = (e as CustomEvent<Position>).detail;
      openContextMenu({ x, y });
    };
    slot.addEventListener("terminal-context-menu", handler);
    return () => slot.removeEventListener("terminal-context-menu", handler);
  }, [openContextMenu]);

  const handleFocus = useCallback(() => {
    terminalRegistry.clearAllSelectionsExcept(paneId);
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
      const hasFiles = e.dataTransfer.types.includes("Files");
      if (hasFiles) {
        e.preventDefault();
        fileEnterCountRef.current++;
        setFileDragOver(true);
        return;
      }
      if (!currentDragPaneId || currentDragPaneId === paneId) return;
      e.preventDefault();
      enterCountRef.current++;
    },
    [paneId]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      const hasFiles = e.dataTransfer.types.includes("Files");
      if (hasFiles) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        return;
      }
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
    if (fileEnterCountRef.current > 0) {
      fileEnterCountRef.current--;
      if (fileEnterCountRef.current <= 0) {
        fileEnterCountRef.current = 0;
        setFileDragOver(false);
      }
    }
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

      if (e.dataTransfer.files.length > 0) {
        fileEnterCountRef.current = 0;
        setFileDragOver(false);
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => shellEscape(window.bump.getPathForFile(f)))
          .join(" ");
        if (paths) {
          terminalRegistry.pasteToTerminal(paneId, paths);
          terminalRegistry.focusTerminal(paneId);
        }
        return;
      }

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

  const handleCopyOutputPath = useCallback(async () => {
    const tid = terminalIdRef.current;
    if (!tid) return;
    const infos = await window.bump.getTerminalInfo();
    const info = infos.find((i) => i.id === tid);
    if (info?.logPath) {
      window.bump.copyToClipboard(info.logPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const handleFixFurther = useCallback(async () => {
    const tid = terminalIdRef.current;
    if (!tid) return;
    const [infos, cwd] = await Promise.all([
      window.bump.getTerminalInfo(),
      window.bump.getTerminalCwd(tid),
    ]);
    const info = infos.find((i) => i.id === tid);
    const newPaneId = useAppStore
      .getState()
      .splitPane(paneId, "horizontal", cwd ?? undefined);
    if (info?.logPath) {
      pendingInputs.set(
        newPaneId,
        `cursor-agent -f "with the terminal logs at ${info.logPath}, `
      );
    }
  }, [paneId]);

  const shortTitle = title.split("/").slice(-2).join("/");
  const cwd = useTerminalCwd(paneId);
  const branch = useGitBranch(paneId);

  return (
    <div
      className={`h-full w-full relative flex flex-col transition-opacity ${isDragging ? "opacity-50" : ""}`}
      onMouseDown={handleFocus}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={`h-6 shrink-0 flex items-center px-2 text-2xs select-none border-b cursor-grab active:cursor-grabbing group/header ${
          isActive
            ? "bg-surface-2 text-[rgb(var(--chrome-text-primary))] border-border"
            : "bg-surface-1 text-[rgb(var(--chrome-text-secondary))] border-overlay/[0.06]"
        }`}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          openHeaderContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {cwd && <span dir="rtl" className="truncate">{'\u200E'}{cwd}</span>}
          {branch && <span className="shrink-0 opacity-50">{branch}</span>}
        </div>
        <div className="shrink-0 grid items-center ml-2">
          <div className="col-start-1 row-start-1 flex items-center gap-2 opacity-50 transition-opacity group-hover/header:opacity-0">
            <span className="truncate max-w-[120px]">{shortTitle}</span>
          </div>
          <div className="col-start-1 row-start-1 flex items-center justify-end gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
            <Tooltip label={copied ? "Copied!" : "Copy output path"}>
              <button
                onClick={handleCopyOutputPath}
                className={`p-0.5 transition-colors ${
                  copied
                    ? "text-accent"
                    : "text-[rgb(var(--chrome-text-secondary))] hover:text-[rgb(var(--chrome-text-primary))]"
                }`}
              >
                {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              </button>
            </Tooltip>
            <Tooltip label="Fix further">
              <button
                onClick={handleFixFurther}
                className="p-0.5 text-[rgb(var(--chrome-text-secondary))] hover:text-[rgb(var(--chrome-text-primary))] transition-colors"
              >
                <ZapIcon size={12} />
              </button>
            </Tooltip>
            <Tooltip label="More">
              <button
                ref={menuButtonRef}
                onClick={() => setMenuOpen((prev) => !prev)}
                className="p-0.5 text-[rgb(var(--chrome-text-secondary))] hover:text-[rgb(var(--chrome-text-primary))] transition-colors"
              >
                <MoreHorizontalIcon size={12} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <div ref={slotRef} className="flex-1 min-h-0" />
      {!isTerminalVisible && (
        <div className="absolute inset-x-0 top-6 bottom-0 z-20 flex items-center justify-center bg-surface-0 px-6">
          <div className="flex items-center gap-2 border border-overlay/[0.08] bg-surface-1 px-4 py-3 text-xs text-text-secondary shadow-lg">
            <span className="text-accent">$</span>
            <span>{isReady ? "starting shell..." : "starting terminal..."}</span>
            <span className="h-3.5 w-1.5 bg-accent/50 animate-pulse" />
          </div>
        </div>
      )}
      {dropZone && <DropOverlay zone={dropZone} />}
      {fileDragOver && <FileDropOverlay />}
      {menuOpen && (
        <PaneMenu
          paneId={paneId}
          triggerRef={menuButtonRef}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {contextMenu && (
        <TerminalContextMenu
          paneId={paneId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}
      {headerContextMenu && (
        <PaneHeaderContextMenu
          paneId={paneId}
          x={headerContextMenu.x}
          y={headerContextMenu.y}
          onClose={closeHeaderContextMenu}
        />
      )}
      {!isActive && !isDragging && (
        <div className="absolute inset-0 pointer-events-none z-[1] bg-surface-0/40" />
      )}
    </div>
  );
}

function usePaneActions(paneId: string, onClose: () => void) {
  const copy = useCallback(() => {
    const text = terminalRegistry.getSelection(paneId);
    if (text) window.bump.copyToClipboard(text);
    onClose();
  }, [paneId, onClose]);

  const paste = useCallback(() => {
    window.bump.readClipboard().then((text) => {
      if (text) terminalRegistry.pasteToTerminal(paneId, text);
    });
    onClose();
  }, [paneId, onClose]);

  const selectAll = useCallback(() => {
    terminalRegistry.selectAll(paneId);
    onClose();
  }, [paneId, onClose]);

  const clear = useCallback(() => {
    terminalRegistry.clearTerminal(paneId);
    onClose();
  }, [paneId, onClose]);

  const copyOutput = useCallback(() => {
    terminalRegistry.copyOutput(paneId);
    onClose();
  }, [paneId, onClose]);

  const splitRight = useCallback(() => {
    const terminalId = useAppStore.getState().panes.get(paneId)?.terminalId;
    if (terminalId) {
      window.bump.getTerminalCwd(terminalId).then((cwd) => {
        useAppStore.getState().splitPane(paneId, "horizontal", cwd ?? undefined);
      });
    } else {
      useAppStore.getState().splitPane(paneId, "horizontal");
    }
    onClose();
  }, [paneId, onClose]);

  const splitDown = useCallback(() => {
    const terminalId = useAppStore.getState().panes.get(paneId)?.terminalId;
    if (terminalId) {
      window.bump.getTerminalCwd(terminalId).then((cwd) => {
        useAppStore.getState().splitPane(paneId, "vertical", cwd ?? undefined);
      });
    } else {
      useAppStore.getState().splitPane(paneId, "vertical");
    }
    onClose();
  }, [paneId, onClose]);

  const closePane = useCallback(() => {
    const { paneTree, workspaces, activeWorkspaceId, openConfirm } = useAppStore.getState();
    if (paneTree.type === "leaf" && workspaces.length <= 1) {
      terminalRegistry.destroy(paneId);
      window.bump.closeWindow();
      onClose();
      return;
    }
    if (paneTree.type === "leaf" && workspaces.length > 1) {
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      openConfirm({
        title: `Close "${ws?.name ?? "workspace"}"?`,
        onConfirm: () => {
          const s = useAppStore.getState();
          for (const [id] of s.panes) {
            terminalRegistry.destroy(id);
          }
          s.closeWorkspace(s.activeWorkspaceId);
        },
      });
      onClose();
      return;
    }
    terminalRegistry.destroy(paneId);
    useAppStore.getState().closePane(paneId);
    onClose();
  }, [paneId, onClose]);

  return { copy, paste, selectAll, clear, copyOutput, splitRight, splitDown, closePane };
}

function useContextMenuDismiss(
  menuRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  excludeRef?: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!excludeRef?.current || !excludeRef.current.contains(target))
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuRef, onClose, excludeRef]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
}

function TerminalContextMenu({
  paneId,
  x,
  y,
  onClose,
}: {
  paneId: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const hasSelection = terminalRegistry.hasSelection(paneId);
  const actions = usePaneActions(paneId, onClose);

  useContextMenuDismiss(menuRef, onClose);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{ left: x, top: y }}
      className="fixed z-50 bg-surface-1 border border-border py-1 min-w-[180px] shadow-lg"
    >
      <MenuButton label="Copy" shortcut="⌘C" onClick={actions.copy} disabled={!hasSelection} />
      <MenuButton label="Paste" shortcut="⌘V" onClick={actions.paste} />
      <MenuButton label="Select All" shortcut="⌘A" onClick={actions.selectAll} />
      <MenuDivider />
      <MenuButton label="Clear" shortcut="⌘K" onClick={actions.clear} />
      <MenuButton label="Copy Output" onClick={actions.copyOutput} />
      <MenuDivider />
      <MenuButton label="Split Right" shortcut="⌘D" onClick={actions.splitRight} />
      <MenuButton label="Split Down" shortcut="⌘⇧D" onClick={actions.splitDown} />
      <MenuDivider />
      <MenuButton label="Close" shortcut="⌘W" onClick={actions.closePane} />
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

function FileDropOverlay() {
  return (
    <div className="absolute inset-x-0 top-6 bottom-0 pointer-events-none z-10 bg-accent/10 border-2 border-dashed border-accent/50 flex items-center justify-center">
      <span className="text-accent text-sm font-medium">Drop files</span>
    </div>
  );
}

function PaneHeaderContextMenu({
  paneId,
  x,
  y,
  onClose,
}: {
  paneId: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const actions = usePaneActions(paneId, onClose);

  useContextMenuDismiss(menuRef, onClose);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{ left: x, top: y }}
      className="fixed z-50 bg-surface-1 border border-border py-1 min-w-[160px] shadow-lg"
    >
      <MenuButton label="Clear" shortcut="⌘K" onClick={actions.clear} />
      <MenuButton label="Copy Output" onClick={actions.copyOutput} />
      <MenuDivider />
      <MenuButton label="Split Right" shortcut="⌘D" onClick={actions.splitRight} />
      <MenuButton label="Split Down" shortcut="⌘⇧D" onClick={actions.splitDown} />
      <MenuDivider />
      <MenuButton label="Close" shortcut="⌘W" onClick={actions.closePane} />
    </div>
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
  const actions = usePaneActions(paneId, onClose);

  useContextMenuDismiss(menuRef, onClose, triggerRef);

  return (
    <div
      ref={menuRef}
      className="absolute top-6 right-0 z-50 bg-surface-1 border border-border py-1 min-w-[160px] shadow-lg"
    >
      <MenuButton label="Split Right" shortcut="⌘D" onClick={actions.splitRight} />
      <MenuButton label="Split Down" shortcut="⌘⇧D" onClick={actions.splitDown} />
      <MenuDivider />
      <MenuButton label="Close" shortcut="⌘W" onClick={actions.closePane} />
    </div>
  );
}

function MenuDivider() {
  return <div className="h-px bg-overlay/[0.06] mx-2 my-1" />;
}

function MenuButton({
  label,
  shortcut,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center justify-between px-3 py-1 text-2xs transition-colors ${
        disabled
          ? "text-text-tertiary/50 cursor-default"
          : "text-text-secondary hover:bg-overlay/[0.06] hover:text-text-primary"
      }`}
    >
      <span>{label}</span>
      {shortcut && <span className="text-text-tertiary ml-4">{shortcut}</span>}
    </button>
  );
}
