import { useAppStore, collectLeafIds } from "../store/appStore.js";
import { terminalRegistry } from "../components/TerminalRegistry.js";
import { pendingInputs } from "../components/PaneContainer.js";
import type {
  ControlBridgeParams,
  ControlBridgeResult,
  ControlWorkspaceInfo,
} from "../../shared/types.js";

const TERMINAL_READY_TIMEOUT_MS = 15000;

function listWorkspaces(): ControlWorkspaceInfo[] {
  const state = useAppStore.getState();
  return state.workspaces.map((ws) => {
    const isActive = ws.id === state.activeWorkspaceId;
    // Active workspace keeps live state in the top-level store fields;
    // inactive ones keep a snapshot on the workspace object.
    const paneEntries = isActive ? Array.from(state.panes.entries()) : ws.panes;
    return {
      id: ws.id,
      name: ws.name,
      isActive,
      activePaneId: isActive ? state.activePaneId : ws.activePaneId,
      paneTree: isActive ? state.paneTree : ws.paneTree,
      panes: paneEntries.map(([paneId, pane]) => ({
        paneId,
        terminalId: pane.terminalId,
      })),
    };
  });
}

function findPaneWorkspace(paneId: string): string | null {
  const state = useAppStore.getState();
  if (state.panes.has(paneId)) return state.activeWorkspaceId;
  for (const ws of state.workspaces) {
    if (ws.id === state.activeWorkspaceId) continue;
    if (ws.panes.some(([id]) => id === paneId)) return ws.id;
  }
  return null;
}

function ensurePaneActive(paneId: string): void {
  const workspaceId = findPaneWorkspace(paneId);
  if (!workspaceId) throw new Error(`unknown pane '${paneId}'`);
  const state = useAppStore.getState();
  if (workspaceId !== state.activeWorkspaceId) {
    state.switchWorkspace(workspaceId);
  }
}

function waitForPaneTerminal(paneId: string): Promise<string> {
  // A pane's terminal is created lazily once its slot mounts (PaneSlot.onReady
  // calls setTerminalId), so wait for the store to report the terminal id.
  const existing = useAppStore.getState().panes.get(paneId)?.terminalId;
  if (existing) return Promise.resolve(existing);
  return new Promise<string>((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for terminal in pane '${paneId}'`));
    }, TERMINAL_READY_TIMEOUT_MS);
    unsubscribe = useAppStore.subscribe((state) => {
      const terminalId = state.panes.get(paneId)?.terminalId;
      if (terminalId) {
        clearTimeout(timer);
        unsubscribe();
        resolve(terminalId);
      }
    });
  });
}

async function inheritCwd(paneId: string): Promise<string | undefined> {
  const terminalId = useAppStore.getState().panes.get(paneId)?.terminalId;
  if (!terminalId) return undefined;
  return (await window.bump.getTerminalCwd(terminalId)) ?? undefined;
}

async function splitPaneAndRun(
  params: ControlBridgeParams
): Promise<ControlBridgeResult> {
  const paneId = params.paneId;
  if (!paneId) throw new Error("paneId is required");
  ensurePaneActive(paneId);
  const direction = params.direction === "vertical" ? "vertical" : "horizontal";
  const cwd = params.cwd ?? (await inheritCwd(paneId));
  const newPaneId = useAppStore.getState().splitPane(paneId, direction, cwd);
  if (params.command) pendingInputs.set(newPaneId, params.command + "\r");
  const terminalId = await waitForPaneTerminal(newPaneId);
  return { paneId: newPaneId, terminalId };
}

async function newWorkspaceWithTerminal(
  cwd?: string,
  command?: string
): Promise<ControlBridgeResult> {
  useAppStore.getState().createWorkspace(cwd);
  const state = useAppStore.getState();
  const paneId = state.activePaneId;
  if (command) pendingInputs.set(paneId, command + "\r");
  const terminalId = await waitForPaneTerminal(paneId);
  return { workspaceId: state.activeWorkspaceId, paneId, terminalId };
}

async function createTerminal(
  params: ControlBridgeParams
): Promise<ControlBridgeResult> {
  if (!params.workspaceId) {
    return newWorkspaceWithTerminal(params.cwd, params.command);
  }
  const state = useAppStore.getState();
  if (!state.workspaces.some((w) => w.id === params.workspaceId)) {
    throw new Error(`unknown workspace '${params.workspaceId}'`);
  }
  state.switchWorkspace(params.workspaceId);
  const activePaneId = useAppStore.getState().activePaneId;
  const result = await splitPaneAndRun({
    paneId: activePaneId,
    direction: "horizontal",
    cwd: params.cwd,
    command: params.command,
  });
  return { workspaceId: params.workspaceId, ...result };
}

function focusPane(params: ControlBridgeParams): ControlBridgeResult {
  const paneId = params.paneId;
  if (!paneId) throw new Error("paneId is required");
  ensurePaneActive(paneId);
  useAppStore.getState().setActivePaneId(paneId);
  terminalRegistry.focusTerminal(paneId);
  return { paneId };
}

function closePane(params: ControlBridgeParams): ControlBridgeResult {
  const paneId = params.paneId;
  if (!paneId) throw new Error("paneId is required");
  ensurePaneActive(paneId);
  const state = useAppStore.getState();
  const leafIds = collectLeafIds(state.paneTree);
  if (leafIds.length <= 1) {
    if (state.workspaces.length <= 1) {
      throw new Error("cannot close the last pane of the last workspace");
    }
    for (const [id] of state.panes) terminalRegistry.destroy(id);
    state.closeWorkspace(state.activeWorkspaceId);
    return { paneId, closed: true };
  }
  terminalRegistry.destroy(paneId);
  state.closePane(paneId);
  return { paneId, closed: true };
}

function closeOtherPanes(params: ControlBridgeParams): ControlBridgeResult {
  const paneId = params.paneId;
  if (!paneId) throw new Error("paneId is required");
  ensurePaneActive(paneId);
  const closedIds = useAppStore.getState().closeOtherPanes(paneId);
  for (const id of closedIds) terminalRegistry.destroy(id);
  return { paneId };
}

function activateWorkspace(params: ControlBridgeParams): ControlBridgeResult {
  const id = params.id;
  if (!id) throw new Error("workspace id is required");
  const state = useAppStore.getState();
  if (!state.workspaces.some((w) => w.id === id)) {
    throw new Error(`unknown workspace '${id}'`);
  }
  state.switchWorkspace(id);
  return { workspaceId: id };
}

function renameWorkspace(params: ControlBridgeParams): ControlBridgeResult {
  const id = params.id;
  if (!id) throw new Error("workspace id is required");
  if (!params.name || !params.name.trim()) throw new Error("name is required");
  const state = useAppStore.getState();
  if (!state.workspaces.some((w) => w.id === id)) {
    throw new Error(`unknown workspace '${id}'`);
  }
  state.renameWorkspace(id, params.name);
  return { workspaceId: id };
}

function closeWorkspace(params: ControlBridgeParams): ControlBridgeResult {
  const id = params.id;
  if (!id) throw new Error("workspace id is required");
  const state = useAppStore.getState();
  if (state.workspaces.length <= 1) {
    throw new Error("cannot close the last workspace");
  }
  const target = state.workspaces.find((w) => w.id === id);
  if (!target) throw new Error(`unknown workspace '${id}'`);
  const panes =
    id === state.activeWorkspaceId ? state.panes : new Map(target.panes);
  for (const [paneId] of panes) terminalRegistry.destroy(paneId);
  state.closeWorkspace(id);
  return { workspaceId: id, closed: true };
}

function handle(
  method: string,
  params: ControlBridgeParams
): ControlBridgeResult | Promise<ControlBridgeResult> {
  switch (method) {
    case "workspaces.list":
      return { workspaces: listWorkspaces() };
    case "workspaces.create":
      return newWorkspaceWithTerminal(params.cwd, params.command);
    case "workspaces.activate":
      return activateWorkspace(params);
    case "workspaces.rename":
      return renameWorkspace(params);
    case "workspaces.close":
      return closeWorkspace(params);
    case "panes.split":
      return splitPaneAndRun(params);
    case "panes.focus":
      return focusPane(params);
    case "panes.close":
      return closePane(params);
    case "panes.closeOthers":
      return closeOtherPanes(params);
    case "terminals.create":
      return createTerminal(params);
    default:
      throw new Error(`unknown control method '${method}'`);
  }
}

export function initControlBridge(): () => void {
  const reportState = () => {
    window.bump.reportControlState({
      workspaceCount: useAppStore.getState().workspaces.length,
    });
  };
  reportState();

  const unsubscribeStore = useAppStore.subscribe((state, prev) => {
    if (state.workspaces !== prev.workspaces) reportState();
  });

  const unsubscribeRequest = window.bump.onControlRequest((request) => {
    void (async () => {
      try {
        const result = await handle(request.method, request.params);
        window.bump.sendControlResponse({ reqId: request.reqId, result });
      } catch (err) {
        window.bump.sendControlResponse({
          reqId: request.reqId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });

  return () => {
    unsubscribeStore();
    unsubscribeRequest();
  };
}
