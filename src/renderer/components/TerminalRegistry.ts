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

// ghostty-web's `scrollback` is a byte budget for the WASM history buffer
// (~13 bytes per cell), not a line count. 50MB holds tens of thousands of
// lines of history (~50k at 80 cols, ~20k at 200 cols).
const SCROLLBACK_BYTES = 50 * 1024 * 1024;

let ghosttyReady: Promise<void> | null = null;

function ensureGhosttyInit(): Promise<void> {
  if (!ghosttyReady) {
    ghosttyReady = init();
  }
  return ghosttyReady;
}

interface TerminalCallbacks {
  onReady: (terminalId: string) => void;
  onVisible: (paneId: string) => void;
  onExit: (paneId: string) => void;
}

interface TerminalEntry {
  container: HTMLDivElement;
  terminal: Terminal | null;
  terminalId: string | null;
  cleanup: (() => void) | null;
  isReady: boolean;
  isVisible: boolean;
  callbacks: TerminalCallbacks;
  // Bumped on every (re)init so a late PTY creation for a pane that was closed
  // or restarted meanwhile can be detected and cleaned up instead of leaking.
  generation: number;
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
    container.style.opacity = "0";

    const entry: TerminalEntry = {
      container,
      terminal: null,
      terminalId: null,
      cleanup: null,
      isReady: false,
      isVisible: false,
      callbacks,
      generation: 0,
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
    entry.isReady = false;
    entry.isVisible = false;
    entry.container.style.opacity = "0";

    this.initTerminal(paneId, entry);
  }

  private async initTerminal(paneId: string, entry: TerminalEntry, cwd?: string) {
    const generation = ++entry.generation;

    await ensureGhosttyInit();

    if (!this.entries.has(paneId) || entry.generation !== generation) return;

    const theme = this.currentTheme ?? terminalTheme;

    const terminal = new Terminal({
      cursorBlink: false,
      fontFamily:
        '"Berkeley Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: this.currentFontSize,
      scrollback: SCROLLBACK_BYTES,
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

      return false;
    });

    entry.terminal = terminal;
    terminal.open(entry.container);

    let revealTimeoutId: number | null = null;
    let isRevealScheduled = false;

    const revealTerminal = (delayMs: number) => {
      if (entry.isVisible || isRevealScheduled) return;
      isRevealScheduled = true;
      revealTimeoutId = window.setTimeout(() => {
        revealTimeoutId = null;
        isRevealScheduled = false;
        if (!this.entries.has(paneId) || entry.isVisible) return;
        entry.isVisible = true;
        entry.container.style.opacity = "1";
        entry.callbacks.onVisible(paneId);
      }, delayMs);
    };

    const inputDisposable = terminal.onData((data) => {
      if (entry.terminalId) {
        window.bump.writeTerminal(entry.terminalId, data);
      }
    });

    let realUnsubData: (() => void) | null = null;
    let realUnsubExit: (() => void) | null = null;

    let writeBuffer = "";
    let writeRaf = 0;

    const WRITE_BUDGET_MS = 8;
    const WRITE_CHUNK = 64 * 1024;

    const flushWrites = () => {
      if (writeBuffer.length === 0) {
        writeRaf = 0;
        return;
      }

      const start = performance.now();
      while (writeBuffer.length > 0) {
        const chunk = writeBuffer.length <= WRITE_CHUNK
          ? writeBuffer
          : writeBuffer.substring(0, WRITE_CHUNK);
        terminal.write(chunk);
        if (writeBuffer.length <= WRITE_CHUNK) {
          writeBuffer = "";
        } else {
          writeBuffer = writeBuffer.substring(WRITE_CHUNK);
        }
        if (performance.now() - start >= WRITE_BUDGET_MS) break;
      }

      if (writeBuffer.length > 0) {
        writeRaf = requestAnimationFrame(flushWrites);
      } else {
        writeRaf = 0;
      }
    };

    const attachStreams = (id: string) => {
      realUnsubData = window.bump.onTerminalData(id, (data) => {
        if (data.length > 0) {
          revealTerminal(180);
        }
        writeBuffer += data;
        if (!writeRaf) {
          writeRaf = requestAnimationFrame(flushWrites);
        }
      });
      realUnsubExit = window.bump.onTerminalExit(id, () => {
        entry.callbacks.onExit(paneId);
      });
    };

    try {
      fitAddon.fit();
    } catch {
      // container may not be laid out yet (e.g. hidden window); the PTY starts
      // at its default size and the ResizeObserver corrects it once visible
    }

    // Create the PTY on a microtask, NOT inside requestAnimationFrame. Electron
    // pauses rAF while the window is backgrounded/occluded, which is exactly
    // when an agent drives bump via the CLI from another app, so gating PTY
    // creation on rAF made programmatic splits hang and time out.
    window.bump.createTerminal(cwd).then(({ id }) => {
      // The pane may have been closed or restarted while the PTY was starting.
      // Adopt the id only if this init is still current, else close the PTY so
      // it does not leak as an orphan with no pane.
      if (!this.entries.has(paneId) || entry.generation !== generation) {
        window.bump.closeTerminal(id);
        return;
      }
      entry.terminalId = id;
      entry.isReady = true;
      attachStreams(id);
      const { cols, rows } = terminal;
      if (cols > 0 && rows > 0) {
        window.bump.resizeTerminal(id, cols, rows);
      }
      entry.callbacks.onReady(id);
      revealTerminal(1200);
    });

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
      writeRaf = 0;
      writeBuffer = "";
      inputDisposable.dispose();
      realUnsubData?.();
      realUnsubExit?.();
      resizeObserver.disconnect();
      if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
      if (revealTimeoutId) clearTimeout(revealTimeoutId);
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

  clearAllSelectionsExcept(paneId: string) {
    for (const [id, e] of this.entries) {
      if (id !== paneId) {
        e.terminal?.clearSelection();
      }
    }
  }

  focusTerminal(paneId: string) {
    const entry = this.entries.get(paneId);
    if (entry?.terminal) {
      this.clearAllSelectionsExcept(paneId);
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
