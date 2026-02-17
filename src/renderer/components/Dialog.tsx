import { useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import { terminalRegistry } from "./TerminalRegistry.js";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ open, onClose, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

interface PromptDialogProps {
  open: boolean;
  title: string;
  defaultValue: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function PromptDialog({
  open,
  title,
  defaultValue,
  placeholder,
  submitLabel = "confirm",
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    requestAnimationFrame(() => terminalRegistry.focusActivePane());
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      handleClose();
    }
  }, [value, onSubmit, handleClose]);

  return (
    <Dialog open={open} onClose={handleClose}>
      <div className="w-[320px] bg-surface-1 border border-white/[0.08] shadow-2xl p-4">
        <p className="text-sm text-text-primary mb-3">{title}</p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder={placeholder}
          className="w-full bg-surface-0 px-2.5 py-1.5 text-sm text-text-primary border border-white/[0.08] outline-none focus:border-accent/50"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={handleClose}
            className="text-xs text-text-secondary px-3 py-1.5 hover:bg-surface-2 transition-colors"
          >
            cancel
          </button>
          <button
            onClick={handleSubmit}
            className="text-xs text-accent bg-accent/10 px-3 py-1.5 hover:bg-accent/20 transition-colors"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
