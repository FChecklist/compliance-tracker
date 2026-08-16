// EXPERIMENTAL SPIKE support script -- see src/app/litert-spike/page.tsx's
// header comment for scope. Not wired into predev/prebuild on purpose: this
// only needs to run once before visiting /litert-spike in dev, and shouldn't
// add cost to every normal dev/build invocation for a prototype route.
//
// @litertjs/core ships its WASM runtime files inside node_modules (not
// servable by Next.js directly). This copies the two non-threaded variants
// (default + broad-compat fallback) into public/litert-spike/wasm/ so the
// browser can fetch them as static assets. Threaded/JSPI variants are
// skipped -- loadLiteRt() defaults to threads:false, jspi:false, and the
// threaded build needs COOP/COEP cross-origin-isolation headers this spike
// doesn't set up.
//
// These are Apache-2.0 licensed files straight from the npm package (no
// licensing concern, unlike the model file in worker-src/inference-worker.ts), but at
// ~9MB/variant they're deliberately left out of git (see .gitignore) so this
// spike doesn't bloat repo history. Run `node scripts/spike-litert-copy-wasm.mjs`
// after `bun install` to regenerate them locally.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..", "node_modules", "@litertjs", "core", "wasm");
const dest = join(__dirname, "..", "public", "litert-spike", "wasm");

if (!existsSync(src)) {
  console.error(`spike-litert-copy-wasm: ${src} not found -- run \`bun add @litertjs/core\` first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

const files = [
  "litert_wasm_internal.js",
  "litert_wasm_internal.wasm",
  "litert_wasm_compat_internal.js",
  "litert_wasm_compat_internal.wasm",
];

for (const f of files) {
  copyFileSync(join(src, f), join(dest, f));
  console.log(`copied ${f}`);
}
console.log(`done -- wasm assets in ${dest}`);
