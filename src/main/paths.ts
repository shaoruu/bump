import { app } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";

const isDev = !app.isPackaged;

export const BUMP_DIR = join(homedir(), isDev ? ".bump-dev" : ".bump");
export const USER_DATA_DIR = isDev
  ? join(homedir(), ".bump-dev", "electron")
  : app.getPath("userData");
