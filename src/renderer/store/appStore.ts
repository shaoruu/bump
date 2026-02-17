import { create } from "zustand";
import { getThemeCache } from "../lib/theme-cache.js";
import type {
  InputMode,
  AgentStatus,
  AgentMessage,
  ToolCall,
  PermissionRequest,
} from "../../shared/types.js";

interface Workspace {
  id: string;
  name: string;
  panes: [string, Pane][];
  paneTree: PaneNode;
  activePaneId: string;
}

interface Chat {
  id: string;
  name: string;
  messages: AgentMessage[];
  toolCalls: ToolCall[];
  createdAt: number;
  updatedAt: number;
}

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
  initialCwd?: string;
}

interface PromptDialogConfig {
  title: string;
  defaultValue: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
}

interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  createWorkspace: (cwd?: string) => void;
  switchWorkspace: (id: string) => void;
  closeWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  reorderWorkspaces: (ids: string[]) => void;

  promptDialog: PromptDialogConfig | null;
  openPrompt: (config: PromptDialogConfig) => void;
  closePrompt: () => void;

  panes: Map<string, Pane>;
  paneTree: PaneNode;
  activePaneId: string;

  isAuthChecked: boolean;
  isAuthenticated: boolean;
  userEmail: string | null;
  setAuth: (authenticated: boolean, email?: string) => void;
  setAuthChecked: () => void;

  chats: Chat[];
  activeChatId: string;
  createChat: () => string;
  switchChat: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  renameChat: (chatId: string, name: string) => void;

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

  splitPane: (paneId: string, direction: SplitDirection, cwd?: string) => string;
  closePane: (paneId: string) => void;
  closeOtherPanes: (keepPaneId: string) => string[];
  updateSplitSizes: (splitId: string, sizes: [number, number]) => void;
  swapPanes: (paneIdA: string, paneIdB: string) => void;
  movePane: (
    sourcePaneId: string,
    targetPaneId: string,
    position: "left" | "right" | "top" | "bottom"
  ) => void;

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

  themeName: string;
  setThemeName: (name: string) => void;
}

let paneCounter = 0;
function generatePaneId(): string {
  return crypto.randomUUID().slice(0, 6);
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

export function collectLeafIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.paneId];
  return [
    ...collectLeafIds(node.children[0]),
    ...collectLeafIds(node.children[1]),
  ];
}

const initialChatId = crypto.randomUUID();
const initialWorkspaceId = crypto.randomUUID();

function makeWorkspacePaneId(): string {
  return generatePaneId();
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [{
    id: initialWorkspaceId,
    name: "workspace",
    panes: [[initialPaneId, { id: initialPaneId, terminalId: null }]],
    paneTree: { type: "leaf", paneId: initialPaneId },
    activePaneId: initialPaneId,
  }],
  activeWorkspaceId: initialWorkspaceId,

  createWorkspace: (cwd?) => {
    const state = get();
    const id = crypto.randomUUID();
    const paneId = makeWorkspacePaneId();
    const ws: Workspace = {
      id,
      name: "workspace",
      panes: [[paneId, { id: paneId, terminalId: null, initialCwd: cwd }]],
      paneTree: { type: "leaf", paneId },
      activePaneId: paneId,
    };
    const savedWorkspaces = state.workspaces.map((w) =>
      w.id === state.activeWorkspaceId
        ? { ...w, panes: Array.from(state.panes.entries()), paneTree: state.paneTree, activePaneId: state.activePaneId }
        : w
    );
    set({
      workspaces: [...savedWorkspaces, ws],
      activeWorkspaceId: id,
      panes: new Map(ws.panes),
      paneTree: ws.paneTree,
      activePaneId: ws.activePaneId,
    });
  },

  switchWorkspace: (id) => {
    const state = get();
    if (id === state.activeWorkspaceId) return;
    const savedWorkspaces = state.workspaces.map((w) =>
      w.id === state.activeWorkspaceId
        ? { ...w, panes: Array.from(state.panes.entries()), paneTree: state.paneTree, activePaneId: state.activePaneId }
        : w
    );
    const target = savedWorkspaces.find((w) => w.id === id);
    if (!target) return;
    set({
      workspaces: savedWorkspaces,
      activeWorkspaceId: id,
      panes: new Map(target.panes),
      paneTree: target.paneTree,
      activePaneId: target.activePaneId,
    });
  },

  closeWorkspace: (id) => {
    const state = get();
    if (state.workspaces.length <= 1) return;
    const remaining = state.workspaces.filter((w) => w.id !== id);
    if (id === state.activeWorkspaceId) {
      const next = remaining[remaining.length - 1];
      set({
        workspaces: remaining,
        activeWorkspaceId: next.id,
        panes: new Map(next.panes),
        paneTree: next.paneTree,
        activePaneId: next.activePaneId,
      });
    } else {
      set({ workspaces: remaining });
    }
  },

  renameWorkspace: (id, name) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
    })),

  reorderWorkspaces: (ids) =>
    set((state) => {
      const map = new Map(state.workspaces.map((w) => [w.id, w]));
      const reordered = ids.map((id) => map.get(id)!).filter(Boolean);
      return { workspaces: reordered };
    }),

  promptDialog: null,
  openPrompt: (config) => set({ promptDialog: config }),
  closePrompt: () => set({ promptDialog: null }),

  panes: new Map([[initialPaneId, { id: initialPaneId, terminalId: null }]]),
  paneTree: { type: "leaf", paneId: initialPaneId },
  activePaneId: initialPaneId,

  isAuthChecked: false,
  isAuthenticated: false,
  userEmail: null,
  setAuth: (authenticated, email) =>
    set({ isAuthenticated: authenticated, userEmail: email ?? null }),
  setAuthChecked: () => set({ isAuthChecked: true }),

  chats: [{ id: initialChatId, name: "Chat 1", messages: [], toolCalls: [], createdAt: Date.now(), updatedAt: Date.now() }],
  activeChatId: initialChatId,

  createChat: () => {
    const id = crypto.randomUUID();
    const hex = id.slice(0, 6);
    const chat: Chat = { id, name: "new " + hex, messages: [], toolCalls: [], createdAt: Date.now(), updatedAt: Date.now() };
    const state = get();
    const updatedChats = state.chats.map((c) =>
      c.id === state.activeChatId
        ? { ...c, messages: state.agentMessages, toolCalls: state.toolCalls, updatedAt: Date.now() }
        : c
    );
    set({ chats: [...updatedChats, chat], activeChatId: id, agentMessages: [], toolCalls: [], agentStatus: "idle" });
    return id;
  },

  switchChat: (chatId) => {
    const state = get();
    const currentChat = state.chats.find((c) => c.id === state.activeChatId);
    if (currentChat) {
      const updated = state.chats.map((c) =>
        c.id === state.activeChatId
          ? { ...c, messages: state.agentMessages, toolCalls: state.toolCalls, updatedAt: Date.now() }
          : c
      );
      const target = updated.find((c) => c.id === chatId);
      if (target) {
        set({
          chats: updated,
          activeChatId: chatId,
          agentMessages: target.messages,
          toolCalls: target.toolCalls,
          agentStatus: "idle",
        });
      }
    }
  },

  deleteChat: (chatId) => {
    const state = get();
    if (state.chats.length <= 1) return;
    const remaining = state.chats.filter((c) => c.id !== chatId);
    if (chatId === state.activeChatId) {
      const next = remaining[remaining.length - 1];
      set({
        chats: remaining,
        activeChatId: next.id,
        agentMessages: next.messages,
        toolCalls: next.toolCalls,
        agentStatus: "idle",
      });
    } else {
      set({ chats: remaining });
    }
  },

  renameChat: (chatId, name) =>
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chatId ? { ...c, name } : c)),
    })),

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

  splitPane: (paneId, direction, cwd?) => {
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
    panes.set(newPaneId, { id: newPaneId, terminalId: null, initialCwd: cwd });

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
    if (leafIds.length <= 1) {
      if (state.workspaces.length > 1) {
        get().closeWorkspace(state.activeWorkspaceId);
      }
      return;
    }

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

  closeOtherPanes: (keepPaneId) => {
    const state = get();
    const allLeafIds = collectLeafIds(state.paneTree);
    const panes = new Map(state.panes);
    const closedIds: string[] = [];
    for (const id of allLeafIds) {
      if (id !== keepPaneId) {
        panes.delete(id);
        closedIds.push(id);
      }
    }
    set({
      panes,
      paneTree: { type: "leaf", paneId: keepPaneId },
      activePaneId: keepPaneId,
    });
    return closedIds;
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

  swapPanes: (paneIdA, paneIdB) =>
    set((state) => {
      function swap(node: PaneNode): PaneNode {
        if (node.type === "leaf") {
          if (node.paneId === paneIdA) return { ...node, paneId: paneIdB };
          if (node.paneId === paneIdB) return { ...node, paneId: paneIdA };
          return node;
        }
        return {
          ...node,
          children: [swap(node.children[0]), swap(node.children[1])],
        };
      }
      return { paneTree: swap(state.paneTree) };
    }),

  movePane: (sourcePaneId, targetPaneId, position) => {
    const state = get();
    const result = findParentAndSibling(state.paneTree, sourcePaneId);
    if (!result) return;

    const treeWithoutSource = replaceSplitWithNode(
      state.paneTree,
      result.parent.id,
      result.sibling
    );

    const direction: SplitDirection =
      position === "left" || position === "right" ? "horizontal" : "vertical";
    const sourceFirst = position === "left" || position === "top";
    const splitId = generateSplitId();

    const newSplit: SplitNode = {
      type: "split",
      id: splitId,
      direction,
      children: sourceFirst
        ? [
            { type: "leaf", paneId: sourcePaneId },
            { type: "leaf", paneId: targetPaneId },
          ]
        : [
            { type: "leaf", paneId: targetPaneId },
            { type: "leaf", paneId: sourcePaneId },
          ],
      sizes: [50, 50],
    };

    set({
      paneTree: findAndReplace(treeWithoutSource, targetPaneId, newSplit),
    });
  },

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
      return {
        agentMessages: messages,
        chats: state.chats.map((c) =>
          c.id === state.activeChatId ? { ...c, messages, updatedAt: Date.now() } : c
        ),
      };
    }),

  addUserMessage: (text) =>
    set((state) => {
      const msg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      const messages = [...state.agentMessages, msg];
      const isFirstMessage = state.agentMessages.filter((m) => m.role === "user").length === 0;
      const chatName = isFirstMessage
        ? text.length > 30 ? text.slice(0, 30) + "..." : text
        : undefined;
      return {
        agentMessages: messages,
        chats: state.chats.map((c) =>
          c.id === state.activeChatId
            ? { ...c, messages, ...(chatName ? { name: chatName } : {}), updatedAt: Date.now() }
            : c
        ),
      };
    }),

  addToolCall: (toolCall) =>
    set((state) => {
      const toolCalls = [...state.toolCalls, toolCall];
      return {
        toolCalls,
        chats: state.chats.map((c) =>
          c.id === state.activeChatId ? { ...c, toolCalls, updatedAt: Date.now() } : c
        ),
      };
    }),

  updateToolCall: (toolCallId, updates) =>
    set((state) => {
      const toolCalls = state.toolCalls.map((tc) =>
        tc.toolCallId === toolCallId ? { ...tc, ...updates } : tc
      );
      return {
        toolCalls,
        chats: state.chats.map((c) =>
          c.id === state.activeChatId ? { ...c, toolCalls, updatedAt: Date.now() } : c
        ),
      };
    }),

  setPendingPermission: (request) => set({ pendingPermission: request }),
  setWorkspacePath: (path) => set({ workspacePath: path }),
  setAgentPanelVisible: (visible) => set({ agentPanelVisible: visible }),
  clearAgentMessages: () => {
    const state = get();
    set({
      agentMessages: [],
      toolCalls: [],
      chats: state.chats.map((c) =>
        c.id === state.activeChatId ? { ...c, messages: [], toolCalls: [], updatedAt: Date.now() } : c
      ),
    });
  },

  themeName: getThemeCache()?.name ?? "Default",
  setThemeName: (name) => set({ themeName: name }),
}));

export type { PaneNode, SplitNode, LeafNode, SplitDirection, Pane, Chat, Workspace };
