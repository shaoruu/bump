import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();

const binSource = join(repoRoot, "cli", "bump");
const binDir = join(home, ".local", "bin");
const binTarget = join(binDir, "bump");

const skillSource = join(repoRoot, "skills", "bump-control");
const skillsDir = join(home, ".cursor", "skills");
const skillLink = join(skillsDir, "bump-control");

function step(message) {
  console.log(`\n\u2192 ${message}`);
}

function ensureGoInstalled() {
  try {
    const version = execFileSync("go", ["version"], { encoding: "utf-8" }).trim();
    console.log(`  using ${version}`);
  } catch {
    console.error(
      "\nGo is required to build the bump CLI but was not found on PATH.\n" +
        "Install Go (https://go.dev/dl/) and re-run this script."
    );
    process.exit(1);
  }
}

function buildCli() {
  step("Building the bump CLI (go build)");
  execFileSync("go", ["build", "-o", binSource, "."], {
    cwd: join(repoRoot, "cli"),
    stdio: "inherit",
  });
  console.log(`  built ${binSource}`);
}

function installCli() {
  step(`Installing the CLI to ${binTarget}`);
  mkdirSync(binDir, { recursive: true });
  copyFileSync(binSource, binTarget);
  chmodSync(binTarget, 0o755);
  console.log("  installed");

  const pathDirs = (process.env.PATH ?? "").split(":");
  if (!pathDirs.includes(binDir)) {
    console.log(
      `  note: ${binDir} is not on your PATH. Add it, e.g.:\n` +
        `        export PATH="$HOME/.local/bin:$PATH"`
    );
  }
}

function linkSkill() {
  step(`Linking the skill into ${skillLink}`);
  mkdirSync(skillsDir, { recursive: true });

  try {
    const info = lstatSync(skillLink);
    if (info.isSymbolicLink()) {
      if (resolve(dirname(skillLink), readlinkSync(skillLink)) === skillSource) {
        console.log("  already linked");
        return;
      }
      rmSync(skillLink);
    } else {
      console.log(
        `  skipped: ${skillLink} already exists and is not a symlink.\n` +
          "        Remove it manually if you want this script to manage it."
      );
      return;
    }
  } catch {
    // nothing there yet
  }

  symlinkSync(skillSource, skillLink);
  console.log(`  linked -> ${skillSource}`);
}

console.log("Setting up the bump control surface (CLI + skill)");
ensureGoInstalled();
buildCli();
installCli();
linkSkill();

console.log(
  "\nDone. Next steps:\n" +
    "  1. Open bump (the control server runs while the app is open).\n" +
    "  2. Run `bump status` to confirm the CLI can reach it.\n" +
    "  3. In Cursor, the `bump-control` skill is now available.\n"
);
