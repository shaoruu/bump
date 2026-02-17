import { init, Terminal, FitAddon } from "../../vendor/ghostty-web/lib/index.js";
import type { CanvasRenderer } from "../../vendor/ghostty-web/lib/renderer.js";
import { useAppStore } from "../store/appStore.js";


const terminalTheme = {
  background: "#0a0a0a",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  cursorAccent: "#0a0a0a",
  selectionBackground: "rgba(82, 182, 154, 0.25)",
  black: "#0a0a0a",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#06b6d4",
  white: "#e6e6e6",
  brightBlack: "#525252",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

let ghosttyReady: Promise<void> | null = null;

function ensureGhosttyInit(): Promise<void> {
  if (!ghosttyReady) {
    ghosttyReady = init();
  }
  return ghosttyReady;
}

interface TerminalCallbacks {
  onReady: (terminalId: string) => void;
  onExit: (paneId: string) => void;
}

interface TerminalEntry {
  container: HTMLDivElement;
  terminal: Terminal | null;
  terminalId: string | null;
  cleanup: (() => void) | null;
  callbacks: TerminalCallbacks;
}

import { getThemeCache } from "../lib/theme-cache.js";

class TerminalRegistry {
  private entries = new Map<string, TerminalEntry>();
  private currentTheme: Record<string, string> | null = getThemeCache()?.terminalTheme ?? null;

  get(paneId: string): TerminalEntry | undefined {
    return this.entries.get(paneId);
  }

  getOrCreate(paneId: string, callbacks: TerminalCallbacks, cwd?: string): TerminalEntry {
    const existing = this.entries.get(paneId);
    if (existing) return existing;

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.background = this.currentTheme?.background ?? "#0a0a0a";
    container.style.position = "relative";
    container.style.overflow = "hidden";

    const entry: TerminalEntry = {
      container,
      terminal: null,
      terminalId: null,
      cleanup: null,
      callbacks,
    };

    this.entries.set(paneId, entry);
    this.initTerminal(paneId, entry, cwd);

    return entry;
  }

  restart(paneId: string) {
    const entry = this.entries.get(paneId);
    if (!entry) return;

    entry.cleanup?.();

    while (entry.container.firstChild) {
      entry.container.firstChild.remove();
    }

    entry.terminalId = null;
    entry.cleanup = null;

    this.initTerminal(paneId, entry);
  }

  private async initTerminal(paneId: string, entry: TerminalEntry, cwd?: string) {
    await ensureGhosttyInit();

    const theme = this.currentTheme ?? terminalTheme;

    const terminal = new Terminal({
      cursorBlink: false,
      fontFamily:
        '"Berkeley Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: this.currentFontSize,
      theme,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.attachCustomKeyEventHandler((e) => {
      if (!e.metaKey) return false;

      const key = e.key.toLowerCase();
      if (key === "c" && terminalRegistry.hasSelection(paneId)) {
        terminalRegistry.copySelection(paneId);
        return true;
      }
      if (key === "v") {
        window.bump.readClipboard().then((text) => {
          if (text) terminal.paste(text);
        });
        return true;
      }
      if (key === "a") {
        terminal.selectAll();
        return true;
      }

      return true;
    });

    entry.terminal = terminal;
    terminal.open(entry.container);

    requestAnimationFrame(() => {
      fitAddon.fit();

      window.bump.createTerminal(cwd).then(({ id }) => {
        entry.terminalId = id;
        const { cols, rows } = terminal;
        window.bump.resizeTerminal(id, cols, rows);
        entry.callbacks.onReady(id);
      });
    });

    const inputDisposable = terminal.onData((data) => {
      if (entry.terminalId) {
        window.bump.writeTerminal(entry.terminalId, data);
      }
    });

    let realUnsubData: (() => void) | null = null;
    let realUnsubExit: (() => void) | null = null;

    let writeBuffer = "";
    let writeRaf = 0;

    const flushWrites = () => {
      if (writeBuffer.length > 0) {
        terminal.write(writeBuffer);
        writeBuffer = "";
      }
      writeRaf = 0;
    };

    const waitForId = setInterval(() => {
      if (entry.terminalId) {
        clearInterval(waitForId);
        realUnsubData = window.bump.onTerminalData(
          entry.terminalId,
          (data) => {
            writeBuffer += data;
            if (!writeRaf) {
              writeRaf = requestAnimationFrame(flushWrites);
            }
          }
        );
        realUnsubExit = window.bump.onTerminalExit(entry.terminalId, () => {
          entry.callbacks.onExit(paneId);
        });
      }
    }, 10);

    let resizeTimeout: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
      resizeTimeout = requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (entry.terminalId) {
            const { cols, rows } = terminal;
            window.bump.resizeTerminal(entry.terminalId, cols, rows);
          }
        } catch {
          // ignore
        }
      });
    });
    resizeObserver.observe(entry.container);

    terminal.focus();

    entry.cleanup = () => {
      if (writeRaf) cancelAnimationFrame(writeRaf);
      flushWrites();
      inputDisposable.dispose();
      realUnsubData?.();
      realUnsubExit?.();
      clearInterval(waitForId);
      resizeObserver.disconnect();
      if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
      terminal.dispose();
      entry.terminal = null;
      if (entry.terminalId) {
        window.bump.closeTerminal(entry.terminalId);
      }
    };
  }

  destroy(paneId: string) {
    const entry = this.entries.get(paneId);
    if (entry) {
      entry.cleanup?.();
      entry.container.remove();
      this.entries.delete(paneId);
    }
  }

  setTheme(theme: Record<string, string>) {
    for (const [, entry] of this.entries) {
      if (entry.terminal) {
        const renderer = entry.terminal.renderer as CanvasRenderer | undefined;
        if (renderer) {
          renderer.setTheme(theme);
        }
      }
      if (theme.background) {
        entry.container.style.background = theme.background;
      }
    }
    this.currentTheme = theme;
    useAppStore.getState().bumpThemeVersion();
  }

  getCurrentTheme(): Record<string, string> | null {
    return this.currentTheme;
  }

  private currentFontSize = 13;

  setFontSize(size: number) {
    this.currentFontSize = size;
    for (const [, entry] of this.entries) {
      if (entry.terminal) {
        entry.terminal.options.fontSize = size;
      }
    }
  }

  getFontSize(): number {
    return this.currentFontSize;
  }

  clearTerminal(paneId: string) {
    const entry = this.entries.get(paneId);
    if (!entry?.terminal || !entry.terminalId) return;
    entry.terminal.clear();
    window.bump.writeTerminal(entry.terminalId, "\x0c");
  }

  copyOutput(paneId: string) {
    const entry = this.entries.get(paneId);
    if (!entry?.terminal) return;
    const buffer = entry.terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    const text = lines.join("\n").trimEnd();
    if (text) window.bump.copyToClipboard(text);
  }

  copySelection(paneId: string): boolean {
    const entry = this.entries.get(paneId);
    return entry?.terminal?.copySelection() ?? false;
  }

  hasSelection(paneId: string): boolean {
    const entry = this.entries.get(paneId);
    return entry?.terminal?.hasSelection() ?? false;
  }

  getSelection(paneId: string): string {
    const entry = this.entries.get(paneId);
    return entry?.terminal?.getSelection() ?? "";
  }

  selectAll(paneId: string) {
    const entry = this.entries.get(paneId);
    entry?.terminal?.selectAll();
  }

  clearSelection(paneId: string) {
    const entry = this.entries.get(paneId);
    entry?.terminal?.clearSelection();
  }

  pasteToTerminal(paneId: string, text: string) {
    const entry = this.entries.get(paneId);
    if (entry?.terminal) {
      entry.terminal.paste(text);
    }
  }

  focusTerminal(paneId: string) {
    const entry = this.entries.get(paneId);
    if (entry?.terminal) {
      entry.terminal.focus();
    }
  }

  focusActivePane() {
    const { mode, activePaneId } = useAppStore.getState();
    if (mode === "agent") {
      const input =
        document.querySelector<HTMLInputElement>("input[placeholder]");
      input?.focus();
    } else {
      this.focusTerminal(activePaneId);
    }
  }
}

export const terminalRegistry = new TerminalRegistry();
