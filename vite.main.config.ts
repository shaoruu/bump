import { defineConfig } from "vite";
import { builtinModules } from "module";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist/main",
    rollupOptions: {
      external: [
        "electron",
        "keytar",
        "node-pty",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        banner: `import { fileURLToPath } from 'node:url'; import { dirname } from 'node:path'; const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);`,
      },
    },
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
