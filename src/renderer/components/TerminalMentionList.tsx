import { forwardRef, useEffect, useImperativeHandle, useState, useCallback, useRef } from "react";

export interface TerminalMentionItem {
  id: string;
  label: string;
  logPath: string;
}

export interface TerminalMentionListProps {
  items: TerminalMentionItem[];
  command: (item: TerminalMentionItem) => void;
}

export interface TerminalMentionListHandle {
  onKeyDown: (event: { event: KeyboardEvent }) => boolean;
}

export const TerminalMentionList = forwardRef<TerminalMentionListHandle, TerminalMentionListProps>(
  function TerminalMentionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedRef = useRef<HTMLButtonElement>(null);

    useEffect(() => { setSelectedIndex(0); }, [items]);
    useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest" }); }, [selectedIndex]);

    const selectItem = useCallback((index: number) => {
      const item = items[index];
      if (item) command(item);
    }, [items, command]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") { setSelectedIndex((i) => (i + items.length - 1) % items.length); return true; }
        if (event.key === "ArrowDown") { setSelectedIndex((i) => (i + 1) % items.length); return true; }
        if (event.key === "Enter") { selectItem(selectedIndex); return true; }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="border border-white/[0.08] bg-surface-1 p-2 shadow-xl">
          <span className="text-xs text-text-tertiary">no terminals</span>
        </div>
      );
    }

    return (
      <div className="max-h-40 overflow-y-auto border border-white/[0.08] bg-surface-1 py-0.5 shadow-xl">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={index === selectedIndex ? selectedRef : null}
            onClick={() => selectItem(index)}
            className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors ${
              index === selectedIndex ? "bg-white/[0.06] text-text-primary" : "text-text-secondary hover:bg-white/[0.03]"
            }`}
          >
            <span className="text-text-tertiary text-2xs">{item.id}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    );
  }
);
