import { useAppStore } from "../store/appStore.js";
import {
  destroyWorkspace,
  workspaceIdleSince,
  workspaceTerminalIds,
} from "./workspace-lifecycle.js";

const REAP_TICK_MS = 60 * 1000;
const REAP_IDLE_MS = 15 * 60 * 1000;

// Close every ephemeral workspace that has been fully idle for at least
// minIdleMs. The active workspace is spared unless isActiveIncluded is set
// (the periodic reaper only sets it while the window is unfocused, so a tab
// never vanishes in front of the user). Returns the ids of the closed
// workspaces.
export async function reapIdleEphemeralWorkspaces(
  minIdleMs: number,
  isActiveIncluded = false
): Promise<string[]> {
  const activity = await window.bump.getTerminalJobActivity();
  const activityById = new Map(activity.map((a) => [a.id, a]));
  const now = Date.now();
  const closed: string[] = [];

  for (const ws of useAppStore.getState().workspaces) {
    if (!ws.isEphemeral) continue;
    const isActive = ws.id === useAppStore.getState().activeWorkspaceId;
    if (isActive && !isActiveIncluded) continue;
    const idleSince = workspaceIdleSince(
      workspaceTerminalIds(ws.id),
      activityById
    );
    if (idleSince === null || now - idleSince < minIdleMs) continue;
    if (destroyWorkspace(ws.id)) closed.push(ws.id);
  }

  return closed;
}

export function startWorkspaceReaper(): () => void {
  const timer = setInterval(() => {
    void reapIdleEphemeralWorkspaces(REAP_IDLE_MS, !document.hasFocus());
  }, REAP_TICK_MS);
  return () => clearInterval(timer);
}
