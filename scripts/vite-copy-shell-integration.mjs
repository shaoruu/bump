import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The shell-integration rc files are runtime assets read by the main process,
// not code to bundle. Copy the whole tree (dotfiles included) next to the
// bundled main output so pty-manager can resolve it in dev and packaged builds.
export function copyShellIntegration() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const src = resolve(repoRoot, "src/main/shell-integration");
  const dest = resolve(repoRoot, "dist/main/shell-integration");
  const copy = () => {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  };
  return {
    name: "bump-copy-shell-integration",
    closeBundle: copy,
  };
}
