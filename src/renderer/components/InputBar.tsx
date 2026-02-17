import { useCallback, useEffect } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import { useAppStore } from "../store/appStore.js";
import { terminalRegistry } from "./TerminalRegistry.js";
import {
  TerminalMentionList,
  type TerminalMentionItem,
  type TerminalMentionListHandle,
} from "./TerminalMentionList.js";

interface SuggestionCallbackProps {
  items: TerminalMentionItem[];
  command: (attrs: { id: string; label: string }) => void;
  clientRect?: (() => DOMRect | null) | null;
  editor: Parameters<typeof useEditor>[0] extends undefined ? never : ReturnType<typeof useEditor>;
}

function extractText(json: Record<string, unknown>): string {
  const parts: string[] = [];
  const traverse = (node: Record<string, unknown>) => {
    if (node.type === "mention" && (node.attrs as Record<string, unknown>)?.label) {
      parts.push("@" + (node.attrs as Record<string, unknown>).label);
    } else if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) traverse(child as Record<string, unknown>);
    }
  };
  traverse(json);
  return parts.join("").trim();
}

let mentionPopupOpen = false;

function createMentionSuggestion() {
  let popup: HTMLDivElement | null = null;
  let component: ReactRenderer<TerminalMentionListHandle> | null = null;

  return {
    char: "@",
    pluginKey: new PluginKey("terminal-mention"),
    items: async ({ query }: { query: string }): Promise<TerminalMentionItem[]> => {
      const terminals = await window.bump.getTerminalInfo();
      const q = query.toLowerCase();
      return terminals
        .filter((t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
        .map((t) => ({ id: t.id, label: t.title, logPath: t.logPath }));
    },
    render: () => ({
      onStart: (props: SuggestionCallbackProps) => {
        mentionPopupOpen = true;
        popup = document.createElement("div");
        popup.style.position = "fixed";
        popup.style.zIndex = "9999";
        document.body.appendChild(popup);

        component = new ReactRenderer(TerminalMentionList, {
          props: {
            items: props.items,
            command: (item: TerminalMentionItem) => {
              props.command({ id: item.logPath, label: 'terminal ' + item.id });
            },
          },
          editor: props.editor,
        }) as ReactRenderer<TerminalMentionListHandle>;

        popup.appendChild(component.element);
        const rect = props.clientRect?.();
        if (rect && popup) {
          popup.style.left = rect.left + "px";
          popup.style.bottom = (window.innerHeight - rect.top + 4) + "px";
        }
      },
      onUpdate: (props: SuggestionCallbackProps) => {
        component?.updateProps({
          items: props.items,
          command: (item: TerminalMentionItem) => {
            props.command({ id: item.logPath, label: 'terminal ' + item.id });
          },
        });
        const rect = props.clientRect?.();
        if (rect && popup) {
          popup.style.left = rect.left + "px";
          popup.style.bottom = (window.innerHeight - rect.top + 4) + "px";
        }
      },
      onKeyDown: (props: { event: KeyboardEvent; }) => {
        if (props.event.key === "Escape") {
          popup?.remove(); popup = null;
          component?.destroy(); component = null;
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        mentionPopupOpen = false;
        popup?.remove(); popup = null;
        component?.destroy(); component = null;
      },
    }),
  };
}

export function InputBar() {
  const agentStatus = useAppStore((s) => s.agentStatus);
  const addUserMessage = useAppStore((s) => s.addUserMessage);
  const appendAgentText = useAppStore((s) => s.appendAgentText);
  const setAgentStatus = useAppStore((s) => s.setAgentStatus);
  const setAgentPanelVisible = useAppStore((s) => s.setAgentPanelVisible);
  const mode = useAppStore((s) => s.mode);

  const handleSubmit = useCallback(async (text: string) => {
    if (!text) return;
    addUserMessage(text);
    setAgentPanelVisible(true);
    setAgentStatus("active");

    try {
      const status = await window.bump.getAgentStatus();
      if (status === "idle") {
        const cwd = await window.bump.getCwd();
        await window.bump.startAgent(cwd);
      }
      await window.bump.promptAgent(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent error";
      appendAgentText("\n[Error: " + message + "]");
    } finally {
      setAgentStatus("idle");
    }
  }, [addUserMessage, setAgentPanelVisible, setAgentStatus, appendAgentText]);

  const editor = useEditor({
    onCreate: () => {
    },
    onUpdate: ({ editor: e }) => {
    },
    extensions: [
      StarterKit.configure({
        heading: false, codeBlock: false, blockquote: false,
        bold: false, italic: false, strike: false, code: false,
        bulletList: false, orderedList: false, listItem: false,
        horizontalRule: false, dropcursor: false, gapcursor: false,
      }),
      Placeholder.configure({
        placeholder: agentStatus === "active" ? "agent is working..." : "ask anything... @ to tag terminals",
      }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: createMentionSuggestion(),
      }),
    ],
    editorProps: {
      attributes: { class: "outline-none min-h-[20px] max-h-[120px] overflow-y-auto text-sm leading-5 text-text-primary" },
      handleKeyDown: (view, event) => {
        if (mentionPopupOpen) return false;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const json = view.state.toJSON().doc as Record<string, unknown>;
          const text = extractText(json);
          if (text) {
            handleSubmit(text);
            view.dispatch(view.state.tr.delete(0, view.state.doc.content.size).setMeta("addToHistory", false));
          }
          return true;
        }
        if (event.key === "Escape") {
          const { activePaneId } = useAppStore.getState();
          terminalRegistry.focusTerminal(activePaneId);
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (mode === "agent" && editor) {
      editor.commands.focus();
    }
  }, [mode, editor]);

  if (mode !== "agent") return null;

  return (
    <div className="border-t border-white/[0.06] bg-surface-1 px-3 py-2 flex items-end gap-2">
      <div className="flex-1 tiptap-input">
        <EditorContent editor={editor} />
      </div>
      <span className="text-2xs text-text-tertiary shrink-0 pb-0.5">cmd+i</span>
    </div>
  );
}
