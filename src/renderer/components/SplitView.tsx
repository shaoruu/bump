import { Panel, Group, Separator } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useCallback, useRef, useEffect, useState } from "react";
import { useAppStore } from "../store/appStore.js";
import type { SplitDirection } from "../store/appStore.js";
import type { ReactNode } from "react";

interface SplitViewProps {
  splitId: string;
  direction: SplitDirection;
  sizes: [number, number];
  left: ReactNode;
  right: ReactNode;
}

export function SplitView({
  splitId,
  direction,
  sizes,
  left,
  right,
}: SplitViewProps) {
  const updateSplitSizes = useAppStore((s) => s.updateSplitSizes);
  const distributeEvenly = useAppStore((s) => s.distributeEvenly);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSizesRef = useRef<[number, number] | null>(null);

  const handleLayout = useCallback(
    (layout: Layout) => {
      const leftSize = layout[`${splitId}-left`];
      const rightSize = layout[`${splitId}-right`];
      if (leftSize !== undefined && rightSize !== undefined) {
        pendingSizesRef.current = [leftSize, rightSize];

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
          if (pendingSizesRef.current) {
            updateSplitSizes(splitId, pendingSizesRef.current);
            pendingSizesRef.current = null;
          }
        }, 150);
      }
    },
    [splitId, updateSplitSizes]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleDistribute = useCallback(() => {
    distributeEvenly(splitId);
    setContextMenu(null);
  }, [distributeEvenly, splitId]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const isSideBySide = direction === "horizontal";

  return (
    <>
      <Group
        orientation={isSideBySide ? "horizontal" : "vertical"}
        onLayoutChange={handleLayout}
        className="h-full"
      >
        <Panel
          id={`${splitId}-left`}
          defaultSize={sizes[0]}
          minSize={15}
          className="flex flex-col overflow-hidden"
        >
          {left}
        </Panel>
        <Separator
          className={`
            group relative
            ${isSideBySide ? "w-px" : "h-px"}
            bg-overlay/10
            hover:bg-overlay/[0.15]
            active:bg-accent/40
            transition-colors
          `}
          onDoubleClick={() => updateSplitSizes(splitId, [50, 50])}
          onContextMenu={handleContextMenu}
        >
          <div
            className={`
              absolute
              ${isSideBySide ? "-left-1 -right-1 top-0 bottom-0" : "-top-1 -bottom-1 left-0 right-0"}
            `}
          />
        </Separator>
        <Panel
          id={`${splitId}-right`}
          defaultSize={sizes[1]}
          minSize={15}
          className="flex flex-col overflow-hidden"
        >
          {right}
        </Panel>
      </Group>
      {contextMenu && (
        <SeparatorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDistribute={handleDistribute}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
}

function SeparatorContextMenu({
  x,
  y,
  onDistribute,
  onClose,
}: {
  x: number;
  y: number;
  onDistribute: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
      <button
        onClick={onDistribute}
        className="w-full flex items-center justify-between px-3 py-1 text-2xs text-text-secondary hover:bg-overlay/[0.06] hover:text-text-primary transition-colors"
      >
        <span>Distribute Evenly</span>
      </button>
    </div>
  );
}
