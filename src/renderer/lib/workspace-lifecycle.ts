import { useAppStore } from "../store/appStore.js";
import { terminalRegistry } from "../components/TerminalRegistry.js";
import type { TerminalJobActivity } from "../../shared/types.js";

// The one true way to close a workspace: tear down every pane's terminal, then
// drop the workspace from the store. Refuses to close the last workspace.
export function destroyWorkspace(id: string): boolean {
  const state = useAppStore.getState();
  if (state.workspaces.length <= 1) return false;
  const target = state.workspaces.find((w) => w.id === id);
  if (!target) return false;
  const panes =
    id === state.activeWorkspaceId ? state.panes : new Map(target.panes);
  for (const [paneId] of panes) terminalRegistry.destroy(paneId);
  state.closeWorkspace(id);
  return true;
}

export function workspaceTerminalIds(workspaceId: string): (string | null)[] {
  const state = useAppStore.getState();
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return [];
  const panes =
    ws.id === state.activeWorkspaceId
      ? Array.from(state.panes.values())
      : ws.panes.map(([, pane]) => pane);
  return panes.map((pane) => pane.terminalId);
}

// When did this workspace go fully idle? Null while anything is still running,
// while shell integration is not reporting ("unknown"), or while a terminal is
// still spawning - all of which make the workspace ineligible for reaping.
export function workspaceIdleSince(
  terminalIds: (string | null)[],
  activityById: Map<string, TerminalJobActivity>
): number | null {
  if (terminalIds.length === 0) return null;
  let idleSince = 0;
  for (const terminalId of terminalIds) {
    if (!terminalId) return null;
    const activity = activityById.get(terminalId);
    if (!activity || activity.status !== "idle") return null;
    idleSince = Math.max(idleSince, activity.endedAt ?? activity.createdAt);
  }
  return idleSince;
}
