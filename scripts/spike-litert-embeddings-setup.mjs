// EXPERIMENTAL SPIKE support script -- see
// src/app/litert-spike-embeddings/page.tsx's header comment for scope.
// Sibling to scripts/spike-litert-copy-wasm.mjs + spike-litert-build-worker.mjs
// (the vision spike's two separate scripts) but combined into one file here
// since this route needs the exact same two steps every time and there's no
// reason to run them independently for this spike.
//
// Step 1: @litertjs/core ships its WASM runtime files inside node_modules
// (not servable by Next.js directly) -- copies the two non-threaded variants
// (default + broad-compat fallback) into public/litert-spike-embeddings/wasm/
// so the browser can fetch them as static assets. Same Apache-2.0 runtime
// files as the sibling vision spike (this is LiteRT.js's own runtime, not
// model-specific) -- deliberately left out of git (~9MB/variant, see
// .gitignore) so this spike doesn't bloat repo history.
//
// Step 2: bundles worker-src/inference-worker.ts with esbuild into a plain
// classic (non-module) worker script, physically placed in the SAME
// directory as the wasm binaries. Required because @litertjs/core's
// Emscripten glue resolves the .wasm binary's URL relative to the WORKER
// SCRIPT's own self.location, not the path passed to loadLiteRt() -- see
// worker-src/inference-worker.ts's header comment (which points back to the
// sibling vision spike's worker for the original root-cause investigation).
//
// Run `bun run spike:litert-embeddings-setup` after `bun install` to
// regenerate these locally before visiting /litert-spike-embeddings.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmSrc = join(__dirname, "..", "node_modules", "@litertjs", "core", "wasm");
const dest = join(__dirname, "..", "public", "litert-spike-embeddings", "wasm");

if (!existsSync(wasmSrc)) {
  console.error(`spike-litert-embeddings-setup: ${wasmSrc} not found -- run \`bun install\` first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

const wasmFiles = [
  "litert_wasm_internal.js",
  "litert_wasm_internal.wasm",
  "litert_wasm_compat_internal.js",
  "litert_wasm_compat_internal.wasm",
];

for (const f of wasmFiles) {
  copyFileSync(join(wasmSrc, f), join(dest, f));
  console.log(`copied ${f}`);
}

const entry = join(__dirname, "..", "src", "app", "litert-spike-embeddings", "worker-src", "inference-worker.ts");
const outfile = join(dest, "inference-worker.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: false,
  sourcemap: false,
});

console.log(`built ${outfile}`);
console.log(`done -- embeddings spike assets in ${dest}`);
