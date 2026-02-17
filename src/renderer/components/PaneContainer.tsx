import { memo, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "../store/appStore.js";
import type { PaneNode } from "../store/appStore.js";
import { SplitView } from "./SplitView.js";
import { terminalRegistry } from "./TerminalRegistry.js";

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
  const isActive = activePaneId === paneId;
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    const entry = terminalRegistry.getOrCreate(paneId, {
      onReady: (terminalId) => setTerminalId(paneId, terminalId),
      onExit: handleTerminalExit,
    });

    slot.appendChild(entry.container);

    return () => {
      if (entry.container.parentNode === slot) {
        slot.removeChild(entry.container);
      }
    };
  }, [paneId, setTerminalId]);

  const handleFocus = useCallback(() => {
    setActivePaneId(paneId);
  }, [paneId, setActivePaneId]);

  return (
    <div
      className={`h-full w-full relative ${
        isActive ? "ring-1 ring-inset ring-accent/20" : ""
      }`}
      onMouseDown={handleFocus}
    >
      <div ref={slotRef} className="h-full w-full" />
    </div>
  );
}
