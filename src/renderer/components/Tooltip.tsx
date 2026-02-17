import type { ReactNode } from "react";

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
}

export function Tooltip({ label, children, side = "bottom" }: TooltipProps) {
  return (
    <div className="relative group/tooltip">
      {children}
      <div
        className={`absolute left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover/tooltip:opacity-100 transition-opacity delay-150 z-50 ${
          side === "bottom" ? "top-full mt-1" : "bottom-full mb-1"
        }`}
      >
        <div className="px-1.5 py-0.5 bg-surface-2 border border-white/[0.08] text-text-secondary text-2xs whitespace-nowrap">
          {label}
        </div>
      </div>
    </div>
  );
}
