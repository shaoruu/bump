import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import * as acp from "@zed-industries/agent-client-protocol";
import type {
  PermissionResponse,
  SessionUpdatePayload,
  ToolCallContent,
  ToolCallKind,
} from "../shared/types.js";

let cachedAgentPath: string | null = null;

async function resolveAgentPath(): Promise<string> {
  if (cachedAgentPath) return cachedAgentPath;

  if (process.env.AGENT_CLI_PATH) {
    cachedAgentPath = process.env.AGENT_CLI_PATH;
    return cachedAgentPath;
  }

  const shell = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  try {
    const result = execFileSync(shell, ["-l", "-c", "which cursor-agent"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    if (result && !result.includes("not found")) {
      cachedAgentPath = result;
      return cachedAgentPath;
    }
  } catch {
    // fall through
  }

  cachedAgentPath = "cursor-agent";
  return cachedAgentPath;
}

export class AgentSession {
  private agentProcess: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private lastAssistantMessageId: string | null = null;

  constructor(
    private mainWindow: BrowserWindow,
    private workspacePath: string
  ) {}

  async start(): Promise<void> {
    const agentCliPath = await resolveAgentPath();

    this.agentProcess = spawn(agentCliPath, ["acp"], {
      cwd: this.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        CURSOR_API_KEY: "",
      },
    });

    if (!this.agentProcess.stdin || !this.agentProcess.stdout) {
      throw new Error("Failed to create agent process streams");
    }

    const stderrChunks: string[] = [];
    this.agentProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    this.agentProcess.on("exit", () => {
      this.agentProcess = null;
    });

    const input = Writable.toWeb(
      this.agentProcess.stdin
    ) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(
      this.agentProcess.stdout
    ) as ReadableStream<Uint8Array>;

    const stream = acp.ndJsonStream(input, output);

    this.connection = new acp.ClientSideConnection(
      () => this.createHandler(),
      stream
    );

    const exitPromise = new Promise<never>((_resolve, reject) => {
      this.agentProcess!.on("exit", (code) => {
        const stderr = stderrChunks.join("").trim();
        reject(new Error(stderr || `cursor-agent exited with code ${code}`));
      });
    });

    const initResult = await Promise.race([
      this.connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      }),
      exitPromise,
    ]);

    if (initResult.authMethods && initResult.authMethods.length > 0) {
      const authMethod = initResult.authMethods[0];
      await this.connection.authenticate({ methodId: authMethod.id });
    }

    const sessionResult = await Promise.race([
      this.connection.newSession({
        cwd: this.workspacePath,
        mcpServers: [],
      }),
      exitPromise,
    ]);

    this.sessionId = sessionResult.sessionId;
  }

  async prompt(
    text: string,
    terminalLogPaths?: string[]
  ): Promise<{ stopReason: string }> {
    if (!this.connection || !this.sessionId) {
      throw new Error("Session not started");
    }

    let fullPrompt = text;
    if (terminalLogPaths && terminalLogPaths.length > 0) {
      const pathList = terminalLogPaths.map((p) => "  - " + p).join("\n");
      fullPrompt = "The user has terminal sessions running. Their recent output is saved at these paths (read them if relevant):\n" + pathList + "\n\n" + text;
    }

    const result = await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: fullPrompt }],
    });

    return { stopReason: result.stopReason };
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  async stop(): Promise<void> {
    if (this.agentProcess) {
      const pid = this.agentProcess.pid;
      if (pid) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            this.agentProcess.kill("SIGKILL");
          } catch {
            // already dead
          }
        }
      }
      this.agentProcess = null;
    }
    this.connection = null;
    this.sessionId = null;
    this.lastAssistantMessageId = null;
  }

  private createHandler(): acp.Client {
    const session = this;

    return {
      async requestPermission(
        params: acp.RequestPermissionRequest
      ): Promise<acp.RequestPermissionResponse> {
        const allowOption = params.options.find(
          (opt) => opt.kind === "allow_once"
        ) ?? params.options[0];

        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        };
      },

      async sessionUpdate(params: acp.SessionNotification): Promise<void> {
        const update = params.update;
        let payload: SessionUpdatePayload | null = null;

        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        ) {
          payload = {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: update.content.text },
          };
        } else if (update.sessionUpdate === "agent_thought_chunk") {
          payload = {
            sessionUpdate: "agent_message_chunk",
            content: { type: "thinking" },
          };
        } else if (update.sessionUpdate === "tool_call") {
          const rawTitle = update.title;
          const titleMatch = rawTitle.match(/^(.+?)\s+`([^`]+)`$/);
          payload = {
            sessionUpdate: "tool_call",
            toolCallId: update.toolCallId,
            title: titleMatch ? titleMatch[1] : rawTitle,
            subtitle: titleMatch ? titleMatch[2] : undefined,
            kind: (update.kind ?? "other") as ToolCallKind,
            status: "pending",
            rawInput: update.rawInput,
          };
        } else if (update.sessionUpdate === "tool_call_update") {
          payload = {
            sessionUpdate: "tool_call_update",
            toolCallId: update.toolCallId,
            status: update.status as "completed" | "failed",
            content: update.content as ToolCallContent[] | undefined,
            rawOutput: update.rawOutput,
          };
        }

        if (payload && !session.mainWindow.isDestroyed()) {
          session.mainWindow.webContents.send("agent:update", payload);
        }
      },

      async writeTextFile(): Promise<acp.WriteTextFileResponse> {
        return {};
      },

      async readTextFile(): Promise<acp.ReadTextFileResponse> {
        return { content: "" };
      },

      async extMethod(): Promise<Record<string, unknown>> {
        return {};
      },
    };
  }
}
