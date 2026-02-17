import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store/appStore.js";

export function ChatMenu() {
  const chats = useAppStore((s) => s.chats);
  const activeChatId = useAppStore((s) => s.activeChatId);
  const switchChat = useAppStore((s) => s.switchChat);
  const createChat = useAppStore((s) => s.createChat);
  const deleteChat = useAppStore((s) => s.deleteChat);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find((c) => c.id === activeChatId);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="text-2xs text-text-secondary hover:text-text-primary transition-colors"
      >
        {activeChat?.name ?? "agent"}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-0.5 w-44 bg-surface-1 border border-white/[0.08] shadow-xl z-50 overflow-hidden">
          <div className="max-h-[200px] overflow-y-auto">
            {chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => { switchChat(chat.id); setOpen(false); }}
                className={`w-full text-left px-2 py-1 flex items-center justify-between group text-2xs transition-colors ${
                  chat.id === activeChatId ? "bg-white/[0.06] text-text-primary" : "text-text-secondary hover:bg-white/[0.03]"
                }`}
              >
                <span className="truncate">{chat.name}</span>
                {chats.length > 1 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                    className="text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-red-400 ml-1 shrink-0"
                  >
                    x
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => { createChat(); setOpen(false); }}
            className="w-full text-left px-2 py-1 text-2xs text-text-tertiary hover:text-text-secondary hover:bg-white/[0.03] border-t border-white/[0.06] transition-colors"
          >
            + new
          </button>
        </div>
      )}
    </div>
  );
}
