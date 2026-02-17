import { useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../store/appStore.js";
import type {
  AgentMessage,
  ToolCall,
  ToolCallKind,
} from "../../shared/types.js";

type TimelineItem =
  | { type: "message"; data: AgentMessage }
  | { type: "toolCall"; data: ToolCall }
  | { type: "toolCallGroup"; data: ToolCall[] };

const IMPORTANT_KINDS = new Set<ToolCallKind>([
  "edit",
  "execute",
  "ask",
  "delete",
]);

function isImportant(tc: ToolCall): boolean {
  return IMPORTANT_KINDS.has(tc.kind);
}

function buildTimeline(
  messages: AgentMessage[],
  toolCalls: ToolCall[]
): TimelineItem[] {
  const nonEmpty = messages.filter((m) => m.content.trim().length > 0);

  type RawItem =
    | { type: "message"; data: AgentMessage }
    | { type: "toolCall"; data: ToolCall };

  const raw: RawItem[] = [
    ...nonEmpty.map((m) => ({ type: "message" as const, data: m })),
    ...toolCalls.map((tc) => ({ type: "toolCall" as const, data: tc })),
  ];
  raw.sort((a, b) => a.data.timestamp - b.data.timestamp);

  const result: TimelineItem[] = [];
  let minorGroup: ToolCall[] = [];

  const flushMinor = () => {
    if (minorGroup.length === 0) return;
    if (minorGroup.length === 1) {
      result.push({ type: "toolCall", data: minorGroup[0] });
    } else {
      result.push({ type: "toolCallGroup", data: [...minorGroup] });
    }
    minorGroup = [];
  };

  for (const item of raw) {
    if (item.type === "message") {
      flushMinor();
      result.push(item);
    } else {
      if (isImportant(item.data)) {
        flushMinor();
        result.push({ type: "toolCall", data: item.data });
      } else {
        minorGroup.push(item.data);
      }
    }
  }
  flushMinor();

  return result;
}

function summarizeGroup(toolCalls: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const tc of toolCalls) {
    counts.set(tc.kind, (counts.get(tc.kind) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [kind, count] of counts) {
    parts.push(`${kind} x${count}`);
  }
  return parts.join(", ");
}

function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <span className="text-green-500">+</span>;
  if (status === "failed") return <span className="text-red-500">x</span>;
  return <span className="text-yellow-500 animate-pulse">.</span>;
}

function ToolCallLine({ tc }: { tc: ToolCall }) {
  const subtitle = tc.subtitle ? ` ${tc.subtitle}` : "";

  if (tc.kind === "execute" && tc.status !== "pending") {
    const command = tc.rawInput?.command as string | undefined;
    const stdout = tc.rawOutput?.stdout as string | undefined;
    const stderr = tc.rawOutput?.stderr as string | undefined;
    const output = stdout || stderr;
    const exitCode = tc.rawOutput?.exitCode as number | undefined;

    return (
      <div className="mb-1">
        <div className="flex items-start gap-1.5 text-2xs">
          <StatusDot status={tc.status} />
          <div className="min-w-0 flex-1">
            <span className="text-text-secondary">{tc.title}</span>
            {command && (
              <div className="mt-0.5 rounded bg-surface-2 px-1.5 py-1 text-text-tertiary">
                $ {command}
              </div>
            )}
            {output && (
              <pre className="mt-0.5 max-h-24 overflow-auto rounded bg-surface-2 px-1.5 py-1 text-2xs text-text-tertiary whitespace-pre-wrap">
                {output.length > 1000 ? output.slice(0, 1000) + "..." : output}
              </pre>
            )}
            {exitCode !== undefined && exitCode !== 0 && (
              <span className="text-red-500 text-2xs">exit {exitCode}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (tc.kind === "edit") {
    const path = tc.rawInput?.path as string | undefined;
    const shortPath = path?.split("/").slice(-2).join("/");

    return (
      <div className="mb-1 flex items-start gap-1.5 text-2xs">
        <StatusDot status={tc.status} />
        <span className="text-text-secondary">
          {tc.status === "pending" ? "editing" : "edited"}
        </span>
        {shortPath && (
          <span className="text-text-primary">{shortPath}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-1 flex items-start gap-1.5 text-2xs">
      <StatusDot status={tc.status} />
      <span className="text-text-secondary">
        {tc.title}{subtitle}
      </span>
    </div>
  );
}

function ToolCallGroupView({ toolCalls }: { toolCalls: ToolCall[] }) {
  const allDone = toolCalls.every((tc) => tc.status !== "pending");
  const hasFailed = toolCalls.some((tc) => tc.status === "failed");

  return (
    <div className="mb-1 flex items-start gap-1.5 text-2xs">
      {hasFailed ? (
        <span className="text-red-500">x</span>
      ) : allDone ? (
        <span className="text-green-500">+</span>
      ) : (
        <span className="text-yellow-500 animate-pulse">.</span>
      )}
      <span className="text-text-tertiary">
        {summarizeGroup(toolCalls)}
      </span>
    </div>
  );
}

export function AgentPanel() {
  const messages = useAppStore((s) => s.agentMessages);
  const toolCalls = useAppStore((s) => s.toolCalls);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(
    () => buildTimeline(messages, toolCalls),
    [messages, toolCalls]
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline]);

  if (timeline.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-tertiary">
        <div className="text-center text-xs">
          <p>no agent activity yet</p>
          <p className="mt-1 text-2xs">press cmd+i to switch modes</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-2">
      {timeline.map((item, i) => {
        if (item.type === "message") {
          const msg = item.data;
          return (
            <div
              key={msg.id}
              className={`mb-2 ${msg.role === "user" ? "" : ""}`}
            >
              {msg.role === "user" ? (
                <div className="rounded bg-surface-2 px-2 py-1.5 text-sm text-text-primary mb-2">
                  {msg.content}
                </div>
              ) : (
                <div className="text-sm text-text-primary whitespace-pre-wrap mb-2">
                  {msg.content}
                </div>
              )}
            </div>
          );
        }

        if (item.type === "toolCallGroup") {
          const key = item.data.map((tc) => tc.toolCallId).join("-");
          return <ToolCallGroupView key={key} toolCalls={item.data} />;
        }

        return <ToolCallLine key={item.data.toolCallId} tc={item.data} />;
      })}

      {agentStatus === "active" && (
        <span className="inline-block h-3.5 w-[2px] bg-text-primary animate-pulse" />
      )}
    </div>
  );
}
