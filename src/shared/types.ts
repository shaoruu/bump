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

export interface BumpAPI {
  createTerminal: () => Promise<{ id: string; pid: number }>;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
  onTerminalData: (id: string, cb: (data: string) => void) => () => void;
  onTerminalExit: (id: string, cb: (exitCode: number) => void) => () => void;

  getTerminalBuffer: (id: string) => Promise<string>;

  startAgent: (workspacePath: string) => Promise<void>;
  stopAgent: () => Promise<void>;
  promptAgent: (text: string, terminalContext?: string) => Promise<{ stopReason: string }>;
  cancelAgent: () => Promise<void>;
  getAgentStatus: () => Promise<AgentStatus>;

  onAgentUpdate: (cb: (update: SessionUpdatePayload) => void) => () => void;
  onPermissionRequest: (cb: (request: PermissionRequest) => void) => () => void;
  respondToPermission: (response: PermissionResponse) => void;

  checkAuth: () => Promise<{ authenticated: boolean; email?: string }>;

  selectDirectory: () => Promise<string | null>;
  getCwd: () => Promise<string>;
}

declare global {
  interface Window {
    bump: BumpAPI;
  }
}
