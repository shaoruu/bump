import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { USER_DATA_DIR } from "./paths.js";

type Settings = Record<string, string>;

const settingsPath = join(USER_DATA_DIR, "settings.json");

function readAll(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf-8")) as Settings;
  } catch {
    return {};
  }
}

function writeAll(settings: Settings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function getSetting(key: string): string | null {
  return readAll()[key] ?? null;
}

export function setSetting(key: string, value: string): void {
  const settings = readAll();
  settings[key] = value;
  writeAll(settings);
}
