import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GhosttyTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorText: string;
  selectionBackground: string;
  selectionForeground: string;
  palette: string[];
}

const GHOSTTY_THEME_DIRS = [
  "/Applications/Ghostty.app/Contents/Resources/ghostty/themes",
];

function parseThemeFile(name: string, content: string): GhosttyTheme {
  const theme: GhosttyTheme = {
    name,
    background: "#0a0a0a",
    foreground: "#e6e6e6",
    cursor: "#e6e6e6",
    cursorText: "#0a0a0a",
    selectionBackground: "#364a82",
    selectionForeground: "#e6e6e6",
    palette: new Array(16).fill("#000000"),
  };

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    switch (key) {
      case "background":
        theme.background = value;
        break;
      case "foreground":
        theme.foreground = value;
        break;
      case "cursor-color":
        theme.cursor = value;
        break;
      case "cursor-text":
        theme.cursorText = value;
        break;
      case "selection-background":
        theme.selectionBackground = value;
        break;
      case "selection-foreground":
        theme.selectionForeground = value;
        break;
      case "palette": {
        const parts = value.split("=");
        if (parts.length === 2) {
          const index = parseInt(parts[0], 10);
          if (index >= 0 && index < 16) {
            theme.palette[index] = parts[1];
          }
        }
        break;
      }
    }
  }

  return theme;
}

let cachedThemes: GhosttyTheme[] | null = null;

export function loadGhosttyThemes(): GhosttyTheme[] {
  if (cachedThemes) return cachedThemes;

  const themes: GhosttyTheme[] = [];

  for (const dir of GHOSTTY_THEME_DIRS) {
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        try {
          const content = readFileSync(join(dir, file), "utf-8");
          themes.push(parseThemeFile(file, content));
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // dir doesn't exist
    }
  }

  themes.sort((a, b) => a.name.localeCompare(b.name));
  cachedThemes = themes;
  return themes;
}
