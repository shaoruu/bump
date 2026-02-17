import { create } from "zustand";
import type {
  InputMode,
  AgentStatus,
  AgentMessage,
  ToolCall,
  PermissionRequest,
} from "../../shared/types.js";

type SplitDirection = "horizontal" | "vertical";

interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  children: [PaneNode, PaneNode];
  sizes: [number, number];
}

interface LeafNode {
  type: "leaf";
  paneId: string;
}

type PaneNode = SplitNode | LeafNode;

interface Pane {
  id: string;
  terminalId: string | null;
}

interface AppState {
  panes: Map<string, Pane>;
  paneTree: PaneNode;
  activePaneId: string;

  isAuthChecked: boolean;
  isAuthenticated: boolean;
  userEmail: string | null;
  setAuth: (authenticated: boolean, email?: string) => void;
  setAuthChecked: () => void;

  mode: InputMode;
  agentStatus: AgentStatus;
  agentMessages: AgentMessage[];
  toolCalls: ToolCall[];
  pendingPermission: PermissionRequest | null;
  workspacePath: string | null;
  agentPanelVisible: boolean;

  setTerminalId: (paneId: string, terminalId: string) => void;
  setActivePaneId: (paneId: string) => void;
  getActiveTerminalId: () => string | null;

  splitPane: (paneId: string, direction: SplitDirection) => string;
  closePane: (paneId: string) => void;
  updateSplitSizes: (splitId: string, sizes: [number, number]) => void;

  setMode: (mode: InputMode) => void;
  toggleMode: () => void;
  setAgentStatus: (status: AgentStatus) => void;
  appendAgentText: (text: string) => void;
  addUserMessage: (text: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (
    toolCallId: string,
    updates: Partial<Pick<ToolCall, "status" | "content" | "rawOutput">>
  ) => void;
  setPendingPermission: (request: PermissionRequest | null) => void;
  setWorkspacePath: (path: string) => void;
  setAgentPanelVisible: (visible: boolean) => void;
  clearAgentMessages: () => void;
}

let paneCounter = 0;
function generatePaneId(): string {
  return `pane-${++paneCounter}`;
}

let splitCounter = 0;
function generateSplitId(): string {
  return `split-${++splitCounter}`;
}

const initialPaneId = generatePaneId();

function findAndReplace(
  node: PaneNode,
  targetPaneId: string,
  replacement: PaneNode
): PaneNode {
  if (node.type === "leaf") {
    return node.paneId === targetPaneId ? replacement : node;
  }
  return {
    ...node,
    children: [
      findAndReplace(node.children[0], targetPaneId, replacement),
      findAndReplace(node.children[1], targetPaneId, replacement),
    ],
  };
}

function findParentAndSibling(
  node: PaneNode,
  targetPaneId: string
): { parent: SplitNode; sibling: PaneNode; index: 0 | 1 } | null {
  if (node.type === "leaf") return null;

  for (let i = 0; i < 2; i++) {
    const child = node.children[i];
    if (child.type === "leaf" && child.paneId === targetPaneId) {
      return {
        parent: node,
        sibling: node.children[i === 0 ? 1 : 0],
        index: i as 0 | 1,
      };
    }
    const result = findParentAndSibling(child, targetPaneId);
    if (result) return result;
  }
  return null;
}

function replaceSplitWithNode(
  tree: PaneNode,
  splitId: string,
  replacement: PaneNode
): PaneNode {
  if (tree.type === "leaf") return tree;
  if (tree.type === "split" && tree.id === splitId) return replacement;
  return {
    ...tree,
    children: [
      replaceSplitWithNode(tree.children[0], splitId, replacement),
      replaceSplitWithNode(tree.children[1], splitId, replacement),
    ],
  };
}

function collectLeafIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.paneId];
  return [
    ...collectLeafIds(node.children[0]),
    ...collectLeafIds(node.children[1]),
  ];
}

export const useAppStore = create<AppState>((set, get) => ({
  panes: new Map([[initialPaneId, { id: initialPaneId, terminalId: null }]]),
  paneTree: { type: "leaf", paneId: initialPaneId },
  activePaneId: initialPaneId,

  isAuthChecked: false,
  isAuthenticated: false,
  userEmail: null,
  setAuth: (authenticated, email) =>
    set({ isAuthenticated: authenticated, userEmail: email ?? null }),
  setAuthChecked: () => set({ isAuthChecked: true }),

  mode: "shell",
  agentStatus: "idle",
  agentMessages: [],
  toolCalls: [],
  pendingPermission: null,
  workspacePath: null,
  agentPanelVisible: false,

  setTerminalId: (paneId, terminalId) =>
    set((state) => {
      const panes = new Map(state.panes);
      const pane = panes.get(paneId);
      if (pane) {
        panes.set(paneId, { ...pane, terminalId });
      }
      return { panes };
    }),

  setActivePaneId: (paneId) => set({ activePaneId: paneId }),

  getActiveTerminalId: () => {
    const state = get();
    const pane = state.panes.get(state.activePaneId);
    return pane?.terminalId ?? null;
  },

  splitPane: (paneId, direction) => {
    const state = get();
    const newPaneId = generatePaneId();
    const splitId = generateSplitId();

    const newSplit: SplitNode = {
      type: "split",
      id: splitId,
      direction,
      children: [
        { type: "leaf", paneId },
        { type: "leaf", paneId: newPaneId },
      ],
      sizes: [50, 50],
    };

    const newTree = findAndReplace(state.paneTree, paneId, newSplit);
    const panes = new Map(state.panes);
    panes.set(newPaneId, { id: newPaneId, terminalId: null });

    set({
      panes,
      paneTree: newTree,
      activePaneId: newPaneId,
    });

    return newPaneId;
  },

  closePane: (paneId) => {
    const state = get();
    const leafIds = collectLeafIds(state.paneTree);
    if (leafIds.length <= 1) return;

    const result = findParentAndSibling(state.paneTree, paneId);
    if (!result) return;

    const newTree = replaceSplitWithNode(
      state.paneTree,
      result.parent.id,
      result.sibling
    );

    const panes = new Map(state.panes);
    const closingPane = panes.get(paneId);
    panes.delete(paneId);

    const siblingLeafIds = collectLeafIds(result.sibling);
    const newActivePaneId =
      state.activePaneId === paneId
        ? siblingLeafIds[0]
        : state.activePaneId;

    set({
      panes,
      paneTree: newTree,
      activePaneId: newActivePaneId,
    });
  },

  updateSplitSizes: (splitId, sizes) =>
    set((state) => {
      function updateNode(node: PaneNode): PaneNode {
        if (node.type === "leaf") return node;
        if (node.id === splitId) return { ...node, sizes };
        return {
          ...node,
          children: [
            updateNode(node.children[0]),
            updateNode(node.children[1]),
          ],
        };
      }
      return { paneTree: updateNode(state.paneTree) };
    }),

  setMode: (mode) => set({ mode }),
  toggleMode: () =>
    set((state) => ({
      mode: state.mode === "shell" ? "agent" : "shell",
      agentPanelVisible: state.mode === "shell",
    })),

  setAgentStatus: (status) => set({ agentStatus: status }),

  appendAgentText: (text) =>
    set((state) => {
      const messages = [...state.agentMessages];
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant") {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + text,
        };
      } else {
        messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: text,
          timestamp: Date.now(),
        });
      }
      return { agentMessages: messages };
    }),

  addUserMessage: (text) =>
    set((state) => ({
      agentMessages: [
        ...state.agentMessages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          timestamp: Date.now(),
        },
      ],
    })),

  addToolCall: (toolCall) =>
    set((state) => ({
      toolCalls: [...state.toolCalls, toolCall],
    })),

  updateToolCall: (toolCallId, updates) =>
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.toolCallId === toolCallId ? { ...tc, ...updates } : tc
      ),
    })),

  setPendingPermission: (request) => set({ pendingPermission: request }),
  setWorkspacePath: (path) => set({ workspacePath: path }),
  setAgentPanelVisible: (visible) => set({ agentPanelVisible: visible }),
  clearAgentMessages: () => set({ agentMessages: [], toolCalls: [] }),
}));

export type { PaneNode, SplitNode, LeafNode, SplitDirection, Pane };
