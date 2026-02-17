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
} | null = null;

async function loadXtermModules() {
  if (xtermModules) return xtermModules;
  const [xtermModule, fitModule, webLinksModule] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
  ]);
  xtermModules = {
    Terminal: xtermModule.Terminal,
    FitAddon: fitModule.FitAddon,
    WebLinksAddon: webLinksModule.WebLinksAddon,
  };
  return xtermModules;
}

interface TerminalCallbacks {
  onReady: (terminalId: string) => void;
  onExit: (paneId: string) => void;
}

interface TerminalEntry {
  container: HTMLDivElement;
  terminalId: string | null;
  cleanup: (() => void) | null;
  callbacks: TerminalCallbacks;
}

class TerminalRegistry {
  private entries = new Map<string, TerminalEntry>();

  getOrCreate(paneId: string, callbacks: TerminalCallbacks): TerminalEntry {
    const existing = this.entries.get(paneId);
    if (existing) return existing;

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.background = "#0a0a0a";
    container.style.padding = "2px";

    const entry: TerminalEntry = {
      container,
      terminalId: null,
      cleanup: null,
      callbacks,
    };

    this.entries.set(paneId, entry);
    this.initTerminal(paneId, entry);

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

  private async initTerminal(paneId: string, entry: TerminalEntry) {
    const modules = await loadXtermModules();
    const { Terminal, FitAddon, WebLinksAddon } = modules;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"Berkeley Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
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
      return true;
    });

    terminal.open(entry.container);

    requestAnimationFrame(() => {
      fitAddon.fit();

      window.bump.createTerminal().then(({ id }) => {
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

    const waitForId = setInterval(() => {
      if (entry.terminalId) {
        clearInterval(waitForId);
        realUnsubData = window.bump.onTerminalData(
          entry.terminalId,
          (data) => terminal.write(data)
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
      inputDisposable.dispose();
      realUnsubData?.();
      realUnsubExit?.();
      clearInterval(waitForId);
      resizeObserver.disconnect();
      if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
      terminal.dispose();
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
