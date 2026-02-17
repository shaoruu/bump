const THEME_CACHE_KEY = "bump:theme-cache";

export interface ThemeCache {
  name: string;
  cssVars: Record<string, string>;
  xtermTheme: Record<string, string>;
}

export function getThemeCache(): ThemeCache | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ThemeCache;
  } catch {
    return null;
  }
}

export function setThemeCache(cache: ThemeCache): void {
  localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(cache));
}
