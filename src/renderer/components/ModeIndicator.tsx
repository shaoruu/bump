import { useAppStore } from "../store/appStore.js";
import type { PaneNode } from "../store/appStore.js";

function countLeaves(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

export function ModeIndicator() {
  const mode = useAppStore((s) => s.mode);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const toggleMode = useAppStore((s) => s.toggleMode);
  const paneTree = useAppStore((s) => s.paneTree);
  const paneCount = countLeaves(paneTree);

  return (
    <div className="flex items-center gap-2 px-2 h-[28px] bg-surface-1 border-b border-border select-none titlebar-drag">
      <div className="w-[60px]" />
      <div className="flex-1" />
      <div className="flex items-center gap-3 titlebar-no-drag">
        {paneCount > 1 && (
          <span className="text-2xs text-text-tertiary">
            {paneCount} panes
          </span>
        )}
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
