export type InputMode = "shell" | "agent";

export type AgentStatus = "idle" | "connecting" | "active" | "error";

export interface SessionMode {
  id: string;
  name: string;
  description?: string | null;
}

export type ToolCallKind =
  | "execute"
  | "read"
  | "edit"
  | "search"
  | "think"
  | "fetch"
  | "ask"
  | "delete"
  | "switch_mode"
  | "other";

export type ToolCallStatus = "pending" | "completed" | "failed";

export type ToolCallContent =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

export interface ToolCall {
  toolCallId: string;
  title: string;
  subtitle?: string;
  kind: ToolCallKind;
  status: ToolCallStatus;
  content?: ToolCallContent[];
  rawInput?: Record<string, unknown>;
  rawOutput?: Record<string, unknown>;
  timestamp: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once";
}

export interface PermissionRequest {
  toolCall: {
    toolCallId: string;
    title: string;
    kind: string;
  };
  options: PermissionOption[];
}

export interface PermissionResponse {
  outcome:
    | { outcome: "selected"; optionId: string }
    | { outcome: "cancelled" };
}

export type SessionUpdatePayload =
  | {
      sessionUpdate: "agent_message_chunk";
      content: { type: "text"; text: string } | { type: "thinking" };
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      subtitle?: string;
      kind: ToolCallKind;
      status: "pending";
      rawInput?: Record<string, unknown>;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      status: "completed" | "failed";
      content?: ToolCallContent[];
      rawOutput?: Record<string, unknown>;
    };


export interface GhosttyTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorText: string;
  selectionBackground: string;
  selectionForeground: string;
  palette: string[];
}

export type TerminalJobStatus = "idle" | "running" | "unknown";

// Per-terminal command lifecycle, driven by OSC 133 markers. Timestamps are
// epoch milliseconds so both the renderer and the Go CLI can do plain math.
export interface TerminalJobState {
  status: TerminalJobStatus;
  currentCommand: string | null;
  lastCommand: string | null;
  lastExitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  commandCount: number;
}

// Compact form embedded in the terminal list.
export interface TerminalJobSummary {
  status: TerminalJobStatus;
  currentCommand: string | null;
  lastExitCode: number | null;
}

export interface CommandStartEvent {
  type: "command_start";
  terminalId: string;
  commandId: number;
  command: string;
  startedAt: number;
}

export interface CommandEndEvent {
  type: "command_end";
  terminalId: string;
  commandId: number;
  command: string;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number;
  durationMs: number | null;
}

export interface TerminalExitEvent {
  terminalId: string;
  exitCode: number;
}

export type ControlSplitDirection = "horizontal" | "vertical";

export type ControlPaneNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      id: string;
      direction: ControlSplitDirection;
      children: [ControlPaneNode, ControlPaneNode];
      sizes: [number, number];
    };

export interface ControlPaneInfo {
  paneId: string;
  terminalId: string | null;
}

export interface ControlWorkspaceInfo {
  id: string;
  name: string;
  isActive: boolean;
  activePaneId: string;
  paneTree: ControlPaneNode;
  panes: ControlPaneInfo[];
}

// Params routed from the HTTP server into the renderer bridge. Optional by
// design: each control method reads and validates only the fields it needs.
export interface ControlBridgeParams {
  id?: string;
  workspaceId?: string;
  paneId?: string;
  name?: string;
  cwd?: string;
  command?: string;
  direction?: ControlSplitDirection;
}

export interface ControlBridgeResult {
  workspaces?: ControlWorkspaceInfo[];
  workspaceId?: string;
  paneId?: string;
  terminalId?: string | null;
  closed?: boolean;
}

export interface ControlRequestMessage {
  reqId: string;
  method: string;
  params: ControlBridgeParams;
}

export interface ControlResponseMessage {
  reqId: string;
  result?: ControlBridgeResult;
  error?: string;
}

export interface ControlStateReport {
  workspaceCount: number;
}

export interface BumpAPI {
  createTerminal: (cwd?: string) => Promise<{ id: string; pid: number }>;
  getTerminalCwd: (id: string) => Promise<string | null>;
  getTerminalGitBranch: (id: string) => Promise<string | null>;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
  closeAllTerminals: () => Promise<void>;
  onTerminalData: (id: string, cb: (data: string) => void) => () => void;
  onTerminalExit: (id: string, cb: (exitCode: number) => void) => () => void;

  getTerminalInfo: () => Promise<{ id: string; logPath: string; title: string }[]>;
  onTerminalTitle: (id: string, cb: (title: string) => void) => () => void;

  getTerminalBuffer: (id: string) => Promise<string>;

  startAgent: (workspacePath: string) => Promise<void>;
  stopAgent: () => Promise<void>;
  promptAgent: (text: string) => Promise<{ stopReason: string }>;
  cancelAgent: () => Promise<void>;
  getAgentStatus: () => Promise<AgentStatus>;

  onAgentUpdate: (cb: (update: SessionUpdatePayload) => void) => () => void;
  onPermissionRequest: (cb: (request: PermissionRequest) => void) => () => void;
  respondToPermission: (response: PermissionResponse) => void;

  listThemes: () => Promise<GhosttyTheme[]>;

  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;

  onFullscreenChange: (cb: (isFullscreen: boolean) => void) => () => void;

  selectDirectory: () => Promise<string | null>;
  getCwd: () => Promise<string>;

  closeWindow: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  toggleDevTools: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  onClosePane: (cb: () => void) => () => void;
  onMenuPaste: (cb: () => void) => () => void;
  onMenuCopy: (cb: () => void) => () => void;
  onMenuSelectAll: (cb: () => void) => () => void;

  copyToClipboard: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;

  onUiScale: (cb: (direction: "in" | "out" | "reset") => void) => () => void;
  onShortcut: (cb: (shortcut: string) => void) => () => void;

  getPathForFile: (file: File) => string;

  onControlRequest: (cb: (request: ControlRequestMessage) => void) => () => void;
  sendControlResponse: (response: ControlResponseMessage) => void;
  reportControlState: (state: ControlStateReport) => void;
}

declare global {
  interface Window {
    bump: BumpAPI;
  }
}
