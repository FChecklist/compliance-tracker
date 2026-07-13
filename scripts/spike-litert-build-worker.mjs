// EXPERIMENTAL SPIKE support script -- see src/app/litert-spike/page.tsx's
// header comment for scope. Companion to spike-litert-copy-wasm.mjs; also
// not wired into predev/prebuild (opt-in, run once before visiting the spike
// page -- see package.json's "spike:litert-setup").
//
// Why this exists instead of just letting Next.js/Turbopack bundle the
// worker the normal way (`new Worker(new URL('./worker.ts', import.meta.url),
// {type:'module'})`): tested that path directly and it does not work with
// @litertjs/core (see src/app/litert-spike/worker-src/inference-worker.ts's
// header comment for the exact two failure modes found). The fix that does
// work needs the worker to be (a) a classic, non-module worker, and (b)
// physically served from the same directory as the wasm binaries so
// Emscripten's self.location-relative path resolution lands correctly.
// Turbopack doesn't give an easy way to force either of those for a
// dev-server-bundled worker chunk, so this bundles the worker source with
// esbuild instead, straight to a plain script, dropped next to the wasm
// files copied by spike-litert-copy-wasm.mjs.
import { build } from "esbuild";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, "..", "src", "app", "litert-spike", "worker-src", "inference-worker.ts");
const outfile = join(__dirname, "..", "public", "litert-spike", "wasm", "inference-worker.js");

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
