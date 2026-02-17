import { Panel, Group, Separator } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useCallback, useRef, useEffect } from "react";
import { useAppStore } from "../store/appStore.js";
import type { SplitDirection } from "../store/appStore.js";
import type { ReactNode } from "react";

interface SplitViewProps {
  splitId: string;
  direction: SplitDirection;
  sizes: [number, number];
  left: ReactNode;
  right: ReactNode;
}

export function SplitView({
  splitId,
  direction,
  sizes,
  left,
  right,
}: SplitViewProps) {
  const updateSplitSizes = useAppStore((s) => s.updateSplitSizes);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSizesRef = useRef<[number, number] | null>(null);

  const handleLayout = useCallback(
    (layout: Layout) => {
      const leftSize = layout[`${splitId}-left`];
      const rightSize = layout[`${splitId}-right`];
      if (leftSize !== undefined && rightSize !== undefined) {
        pendingSizesRef.current = [leftSize, rightSize];

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
          if (pendingSizesRef.current) {
            updateSplitSizes(splitId, pendingSizesRef.current);
            pendingSizesRef.current = null;
          }
        }, 150);
      }
    },
    [splitId, updateSplitSizes]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const isSideBySide = direction === "horizontal";

  return (
    <Group
      orientation={isSideBySide ? "horizontal" : "vertical"}
      onLayoutChange={handleLayout}
      className="h-full"
    >
      <Panel
        id={`${splitId}-left`}
        defaultSize={sizes[0]}
        minSize={15}
        className="flex flex-col overflow-hidden"
      >
        {left}
      </Panel>
      <Separator
        className={`
          group relative
          ${isSideBySide ? "w-px" : "h-px"}
          bg-white/[0.06]
          hover:bg-white/[0.15]
          active:bg-accent/40
          transition-colors
        `}
        onDoubleClick={() => updateSplitSizes(splitId, [50, 50])}
      >
        <div
          className={`
            absolute
            ${isSideBySide ? "-left-1 -right-1 top-0 bottom-0" : "-top-1 -bottom-1 left-0 right-0"}
          `}
        />
      </Separator>
      <Panel
        id={`${splitId}-right`}
        defaultSize={sizes[1]}
        minSize={15}
        className="flex flex-col overflow-hidden"
      >
        {right}
      </Panel>
    </Group>
  );
}
