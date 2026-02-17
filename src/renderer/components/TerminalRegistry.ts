import "@xterm/xterm/css/xterm.css";

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

let xtermModules: {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
  WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon;
  WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon;
} | null = null;

async function loadXtermModules() {
  if (xtermModules) return xtermModules;
  const [xtermModule, fitModule, webLinksModule, webglModule] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
    import("@xterm/addon-webgl"),
  ]);
  xtermModules = {
    Terminal: xtermModule.Terminal,
    FitAddon: fitModule.FitAddon,
    WebLinksAddon: webLinksModule.WebLinksAddon,
    WebglAddon: webglModule.WebglAddon,
  };
  return xtermModules;
}

interface TerminalCallbacks {
  onReady: (terminalId: string) => void;
  onExit: (paneId: string) => void;
}

interface TerminalEntry {
  container: HTMLDivElement;
  terminal: import("@xterm/xterm").Terminal | null;
  terminalId: string | null;
  cleanup: (() => void) | null;
  callbacks: TerminalCallbacks;
}

import { getThemeCache } from "../lib/theme-cache.js";

class TerminalRegistry {
  private entries = new Map<string, TerminalEntry>();
  private currentTheme: Record<string, string> | null = getThemeCache()?.xtermTheme ?? null;

  getOrCreate(paneId: string, callbacks: TerminalCallbacks, cwd?: string): TerminalEntry {
    const existing = this.entries.get(paneId);
    if (existing) return existing;

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.background = "#0a0a0a";
    container.style.padding = "2px";

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

    const xterm = entry.container.querySelector(".xterm");
    if (xterm) xterm.remove();

    entry.terminalId = null;
    entry.cleanup = null;

    this.initTerminal(paneId, entry);
  }

  private async initTerminal(paneId: string, entry: TerminalEntry, cwd?: string) {
    const modules = await loadXtermModules();
    const { Terminal, FitAddon, WebLinksAddon, WebglAddon } = modules;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"Berkeley Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.0,
      theme: terminalTheme,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.metaKey && e.key === "d") return false;
      if (e.metaKey && e.key === "w") return false;
      if (e.metaKey && e.key === "i") return false;
      if (e.metaKey && e.key === "p") return false;
      if (e.metaKey && e.key === "n") return false;
      if (e.metaKey && e.key === "t") return false;
      if (e.metaKey && e.key === "k") return false;
      if (e.metaKey && e.key >= "1" && e.key <= "9") return false;
      return true;
    });

    entry.terminal = terminal;
    terminal.open(entry.container);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // fall back to DOM renderer
    }

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

    if (this.currentTheme) {
      terminal.options.theme = this.currentTheme;
      entry.container.style.background = this.currentTheme.background || "#0a0a0a";
    }

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
        entry.terminal.options.theme = theme;
      }
      if (theme.background) {
        entry.container.style.background = theme.background;
      }
    }
    this.currentTheme = theme;
  }

  getCurrentTheme(): Record<string, string> | null {
    return this.currentTheme;
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
    if (text) navigator.clipboard.writeText(text);
  }

  focusTerminal(paneId: string) {
    const entry = this.entries.get(paneId);
    if (entry) {
      const xtermEl = entry.container.querySelector(
        ".xterm-helper-textarea"
      ) as HTMLTextAreaElement | null;
      xtermEl?.focus();
    }
  }
}

export const terminalRegistry = new TerminalRegistry();
