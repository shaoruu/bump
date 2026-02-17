import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist/main",
            rollupOptions: {
              external: ["electron", "keytar", "node-pty"],
              output: {
                banner: `import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __pathDirname } from 'node:path'; const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);`,
              },
            },
          },
        },
        onstart(args) {
          args.startup();
        },
      },
    ]),
    renderer(),
  ],
  server: {
    port: 5174,
    hmr: {
      overlay: false,
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist/renderer",
  },
});
