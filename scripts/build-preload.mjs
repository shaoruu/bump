import * as esbuild from "esbuild";
import { watch } from "chokidar";

const isDev = process.argv.includes("--watch");

async function build() {
  await esbuild.build({
    entryPoints: ["src/preload/index.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    outfile: "dist/preload/index.cjs",
    format: "cjs",
    external: ["electron"],
  });
  console.log("Preload built successfully");
}

await build();

if (isDev) {
  console.log("Watching for changes...");
  watch("src/preload/**/*.ts").on("change", async () => {
    console.log("Rebuilding preload...");
    await build();
  });
}
