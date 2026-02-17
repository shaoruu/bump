import { Command } from "cmdk";
import { useEffect, useState, useCallback, useRef } from "react";
import { getActions, getRecentActionIds, recordRecentAction } from "../lib/actions.js";
import type { Action } from "../lib/actions.js";
import type { GhosttyTheme } from "../../shared/types.js";

import { terminalRegistry } from "./TerminalRegistry.js";
import { useAppStore } from "../store/appStore.js";
import { setThemeCache } from "../lib/theme-cache.js";

const THEME_CSS_VARS = [
  "--surface-0",
  "--surface-1",
  "--surface-2",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
] as const;

interface ThemeSnapshot {
  cssVars: Record<string, string>;
  terminalTheme: Record<string, string> | null;
}

function captureThemeSnapshot(): ThemeSnapshot {
  const style = document.documentElement.style;
  return {
    cssVars: Object.fromEntries(
      THEME_CSS_VARS.map((name) => [name, style.getPropertyValue(name)])
    ),
    terminalTheme: terminalRegistry.getCurrentTheme(),
  };
}

function restoreThemeSnapshot(snapshot: ThemeSnapshot) {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(snapshot.cssVars)) {
    style.setProperty(name, value);
  }
  if (snapshot.terminalTheme) {
    terminalRegistry.setTheme(snapshot.terminalTheme);
  }
}

let themesCache: GhosttyTheme[] = [];

interface CommandPaletteProps {
  initialMode?: "actions" | "themes";
  onClose: () => void;
}

export function CommandPalette({ initialMode = "actions", onClose }: CommandPaletteProps) {
  const [mode, setMode] = useState(initialMode);
  const [themes, setThemes] = useState(themesCache);
  const [search, setSearch] = useState("");
  const [highlightedValue, setHighlightedValue] = useState(
    initialMode === "themes" ? useAppStore.getState().themeName : ""
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const snapshotRef = useRef<ThemeSnapshot | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (mode === "themes") {
      if (themes.length === 0) {
        window.bump.listThemes().then((loaded) => {
          themesCache = loaded;
          setThemes(loaded);
        });
      }
      snapshotRef.current = captureThemeSnapshot();
    }
  }, [mode, themes.length]);

  const revertPreview = useCallback(() => {
    if (!snapshotRef.current) return;
    restoreThemeSnapshot(snapshotRef.current);
    snapshotRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    revertPreview();
    onClose();
    requestAnimationFrame(() => terminalRegistry.focusActivePane());
  }, [onClose, revertPreview]);

  const handleActionSelect = useCallback(
    (action: Action) => {
      recordRecentAction(action.id);
      if (action.id === "theme.change") {
        setMode("themes");
        setSearch("");
        setHighlightedValue(useAppStore.getState().themeName);
        return;
      }
      handleClose();
      action.execute();
    },
    [handleClose]
  );

  const handleThemeSelect = useCallback(
    (theme: GhosttyTheme) => {
      snapshotRef.current = null;
      onClose();
      requestAnimationFrame(() => terminalRegistry.focusActivePane());
      applyTheme(theme);
    },
    [onClose]
  );

  const handleHighlightChange = useCallback(
    (value: string) => {
      setHighlightedValue(value);
      if (mode !== "themes" || themes.length === 0) return;
      const normalized = value.trim().toLowerCase();
      const theme = themes.find(
        (t) => t.name.toLowerCase() === normalized
      );
      if (theme) applyThemeVisuals(theme);
    },
    [mode, themes]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18%]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-[440px] border border-white/[0.08] bg-surface-1 shadow-2xl overflow-hidden">
        <Command
          shouldFilter={true}
          value={highlightedValue}
          onValueChange={handleHighlightChange}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (mode === "themes") {
                revertPreview();
                setMode("actions");
                setSearch("");
              } else {
                handleClose();
              }
            }
          }}
        >
          <Command.Input
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            placeholder={
              mode === "themes" ? "search themes..." : "type a command..."
            }
            className="w-full bg-transparent px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary border-b border-white/[0.06] outline-none"
          />
          <Command.List className="max-h-[300px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-xs text-text-tertiary">
              no results
            </Command.Empty>

            {mode === "actions" && (
              <ActionList onSelect={handleActionSelect} search={search} />
            )}

            {mode === "themes" && (
              <ThemeList themes={themes} onSelect={handleThemeSelect} />
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

const GROUP_HEADING_CLASS =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider";

function ActionItem({
  action,
  onSelect,
}: {
  action: Action;
  onSelect: (a: Action) => void;
}) {
  return (
    <Command.Item
      key={action.id}
      value={action.label}
      keywords={action.keywords}
      onSelect={() => onSelect(action)}
      className="flex items-center justify-between px-2 py-1.5 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-white/[0.06]"
    >
      <span>{action.label}</span>
      {action.shortcut && (
        <span className="text-2xs text-text-tertiary">{action.shortcut}</span>
      )}
    </Command.Item>
  );
}

function ActionList({
  onSelect,
  search,
}: {
  onSelect: (a: Action) => void;
  search: string;
}) {
  const actions = getActions();

  if (search) {
    return (
      <>
        {actions.map((action) => (
          <ActionItem key={action.id} action={action} onSelect={onSelect} />
        ))}
      </>
    );
  }

  const recentIds = getRecentActionIds();
  const recentActions = recentIds
    .map((id) => actions.find((a) => a.id === id))
    .filter((a): a is Action => a !== undefined);

  const recentIdSet = new Set(recentActions.map((a) => a.id));
  const categories = ["general", "terminal", "agent", "theme"] as const;

  return (
    <>
      {recentActions.length > 0 && (
        <Command.Group heading="recent" className={GROUP_HEADING_CLASS}>
          {recentActions.map((action) => (
            <ActionItem
              key={`recent-${action.id}`}
              action={action}
              onSelect={onSelect}
            />
          ))}
        </Command.Group>
      )}
      {categories.map((cat) => {
        const items = actions.filter(
          (a) => a.category === cat && !recentIdSet.has(a.id)
        );
        if (items.length === 0) return null;
        return (
          <Command.Group
            key={cat}
            heading={cat}
            className={GROUP_HEADING_CLASS}
          >
            {items.map((action) => (
              <ActionItem
                key={action.id}
                action={action}
                onSelect={onSelect}
              />
            ))}
          </Command.Group>
        );
      })}
    </>
  );
}

function ThemeList({
  themes,
  onSelect,
}: {
  themes: GhosttyTheme[];
  onSelect: (t: GhosttyTheme) => void;
}) {
  if (themes.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-text-tertiary">
        loading themes...
      </div>
    );
  }

  return (
    <>
      {themes.map((theme) => (
        <Command.Item
          key={theme.name}
          value={theme.name}
          onSelect={() => onSelect(theme)}
          className="flex items-center gap-2 px-2 py-1.5 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-white/[0.06]"
        >
          <span
            className="w-3 h-3 border border-white/10 shrink-0"
            style={{ background: theme.background }}
          />
          <span>{theme.name}</span>
        </Command.Item>
      ))}
    </>
  );
}

function buildTerminalTheme(theme: GhosttyTheme): Record<string, string> {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorText,
    selectionBackground: theme.selectionBackground,
    selectionForeground: theme.selectionForeground,
    black: theme.palette[0],
    red: theme.palette[1],
    green: theme.palette[2],
    yellow: theme.palette[3],
    blue: theme.palette[4],
    magenta: theme.palette[5],
    cyan: theme.palette[6],
    white: theme.palette[7],
    brightBlack: theme.palette[8],
    brightRed: theme.palette[9],
    brightGreen: theme.palette[10],
    brightYellow: theme.palette[11],
    brightBlue: theme.palette[12],
    brightMagenta: theme.palette[13],
    brightCyan: theme.palette[14],
    brightWhite: theme.palette[15],
  };
}

function buildCssVars(theme: GhosttyTheme): Record<string, string> {
  return {
    "--surface-0": hexToRgb(theme.background),
    "--surface-1": hexToRgb(lighten(theme.background, 0.05)),
    "--surface-2": hexToRgb(lighten(theme.background, 0.1)),
    "--text-primary": hexToRgb(theme.foreground),
    "--text-secondary": hexToRgb(lighten(theme.foreground, -0.3)),
    "--text-tertiary": hexToRgb(lighten(theme.foreground, -0.5)),
  };
}

function applyCssVars(vars: Record<string, string>) {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) {
    style.setProperty(name, value);
  }
}

function applyThemeVisuals(theme: GhosttyTheme) {
  terminalRegistry.setTheme(buildTerminalTheme(theme));
  applyCssVars(buildCssVars(theme));
}

function applyTheme(theme: GhosttyTheme) {
  applyThemeVisuals(theme);
  useAppStore.getState().setThemeName(theme.name);
  window.bump.setSetting("theme", theme.name);
  setThemeCache({
    name: theme.name,
    cssVars: buildCssVars(theme),
    terminalTheme: buildTerminalTheme(theme),
  });
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function lighten(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  let r = parseInt(h.substring(0, 2), 16);
  let g = parseInt(h.substring(2, 4), 16);
  let b = parseInt(h.substring(4, 6), 16);
  if (amount > 0) {
    r = Math.min(255, r + Math.round(255 * amount));
    g = Math.min(255, g + Math.round(255 * amount));
    b = Math.min(255, b + Math.round(255 * amount));
  } else {
    r = Math.max(0, r + Math.round(r * amount));
    g = Math.max(0, g + Math.round(g * amount));
    b = Math.max(0, b + Math.round(b * amount));
  }
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
