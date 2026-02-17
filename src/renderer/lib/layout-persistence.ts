import { useAppStore, collectLeafIds } from "../store/appStore.js";
import type { PaneNode, PersistedLayout } from "../store/appStore.js";

interface PersistedPane {
  id: string;
  cwd?: string;
}

interface PersistedWorkspace {
  id: string;
  name: string;
  panes: [string, PersistedPane][];
  paneTree: PaneNode;
  activePaneId: string;
}

const STORAGE_KEY = "layout";
const SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function isValidLayout(layout: PersistedLayout): boolean {
  if (!layout.workspaces?.length) return false;
  for (const ws of layout.workspaces) {
    if (!ws.panes?.length || !ws.paneTree) return false;
    const paneIds = new Set(ws.panes.map(([id]) => id));
    const leafIds = collectLeafIds(ws.paneTree);
    if (leafIds.length === 0) return false;
    for (const id of leafIds) {
      if (!paneIds.has(id)) return false;
    }
    if (!leafIds.includes(ws.activePaneId)) {
      ws.activePaneId = leafIds[0];
    }
  }
  if (!layout.workspaces.find((w) => w.id === layout.activeWorkspaceId)) {
    layout.activeWorkspaceId = layout.workspaces[0].id;
  }
  return true;
}

async function collectLayout(): Promise<PersistedLayout> {
  const state = useAppStore.getState();

  const allWorkspaces = state.workspaces.map((w) =>
    w.id === state.activeWorkspaceId
      ? {
          ...w,
          panes: Array.from(state.panes.entries()),
          paneTree: state.paneTree,
          activePaneId: state.activePaneId,
        }
      : w
  );

  const persistedWorkspaces: PersistedWorkspace[] = await Promise.all(
    allWorkspaces.map(async (ws) => {
      const persistedPanes: [string, PersistedPane][] = await Promise.all(
        ws.panes.map(async ([id, pane]) => {
          let cwd: string | undefined;
          if (pane.terminalId) {
            try {
              cwd =
                (await window.bump.getTerminalCwd(pane.terminalId)) ??
                undefined;
            } catch {
              // terminal may already be closed
            }
          }
          if (!cwd) cwd = pane.initialCwd;
          return [id, { id: pane.id, cwd }] as [string, PersistedPane];
        })
      );
      return {
        id: ws.id,
        name: ws.name,
        panes: persistedPanes,
        paneTree: ws.paneTree,
        activePaneId: ws.activePaneId,
      };
    })
  );

  return {
    workspaces: persistedWorkspaces,
    activeWorkspaceId: state.activeWorkspaceId,
  };
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    collectLayout().then((layout) =>
      window.bump.setSetting(STORAGE_KEY, JSON.stringify(layout))
    );
  }, SAVE_DEBOUNCE_MS);
}

export async function loadPersistedLayout(): Promise<void> {
  try {
    const raw = await window.bump.getSetting(STORAGE_KEY);
    if (raw) {
      const layout = JSON.parse(raw) as PersistedLayout;
      if (isValidLayout(layout)) {
        useAppStore.getState().restoreLayout(layout);
      }
    }
  } catch {
    // corrupt data, start fresh
  }
  useAppStore.getState().setLayoutLoaded();
}

export function startLayoutPersistence(): () => void {
  let prev = {
    workspaces: useAppStore.getState().workspaces,
    paneTree: useAppStore.getState().paneTree,
    activePaneId: useAppStore.getState().activePaneId,
    activeWorkspaceId: useAppStore.getState().activeWorkspaceId,
  };

  const unsub = useAppStore.subscribe((state) => {
    const next = {
      workspaces: state.workspaces,
      paneTree: state.paneTree,
      activePaneId: state.activePaneId,
      activeWorkspaceId: state.activeWorkspaceId,
    };
    if (
      next.workspaces !== prev.workspaces ||
      next.paneTree !== prev.paneTree ||
      next.activePaneId !== prev.activePaneId ||
      next.activeWorkspaceId !== prev.activeWorkspaceId
    ) {
      prev = next;
      scheduleSave();
    }
  });

  return () => {
    unsub();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };
}
