// EXPERIMENTAL SPIKE -- see ../page.tsx header comment for scope/removal.
//
// This file is NOT bundled by Next.js/Turbopack. It's bundled separately by
// scripts/spike-litert-build-worker.mjs (esbuild, IIFE/classic-worker format)
// straight into public/litert-spike/wasm/inference-worker.js, run manually
// (or via `bun run spike:litert-setup`) -- see that script's header for why.
//
// Root cause, found by direct testing (2026-07-13), not documented anywhere
// upstream: @litertjs/core's Emscripten glue resolves the .wasm binary's URL
// relative to the WORKER SCRIPT's own self.location, not relative to the
// path string passed into loadLiteRt(). Two consequences that make this
// unusable out of the box in a bundler-built app:
//
//   1. An ES-module Worker (`new Worker(url, {type:"module"})`, the natural
//      choice when your worker source uses top-level `import`) fails outright
//      -- the glue calls importScripts() internally, which module workers
//      forbid ("Module scripts don't support importScripts()").
//   2. A classic Worker avoids that, but then the wasm fetch resolves against
//      the *worker script's own* directory, not the directory passed to
//      loadLiteRt(). A worker bundled by Turbopack lives under
//      /_next/static/chunks/..., nowhere near /litert-spike/wasm/, so the
//      fetch 404s and the 404 HTML gets fed straight into
//      WebAssembly.instantiate() with no response.ok check -- surfaces as an
//      opaque "expected magic word ... found 3c 21 44 4f" (the bytes of
//      "<!DO"[CTYPE]) error that has nothing obviously to do with pathing.
//
// Fix used here: bundle this file to a plain classic-worker script and
// physically place it in the SAME directory as the wasm binaries
// (public/litert-spike/wasm/inference-worker.js) so self.location-relative
// resolution lands on the right files by construction. Confirmed working via
// a minimal repro before wiring it into this file -- see the final report
// for the exact fetch-URL evidence.

import { loadLiteRt, loadAndCompile, Tensor, type CompiledModel } from "@litertjs/core";

interface RunMsg {
  type: "run";
  width: number;
  height: number;
  pixels: ArrayBuffer;
}
type InMsg = { type: "init" } | RunMsg;

// Same-origin, same-directory as this bundled script (see header comment).
const WASM_JS_URL = "litert_wasm_internal.js";

// See ../litert-worker.ts.bak / page.tsx for the full licensing caveat: this
// streams from the model's original public GitHub location rather than
// being vendored into this repo.
const MODEL_URL =
  "https://raw.githubusercontent.com/AhmetFurkanDEMIR/Blur-image-detection-with-Flutter-and-TFLite/main/assets/tflite/model.tflite";

const LABELS = ["BLUR", "SHARP"] as const;

let compiledModel: CompiledModel | null = null;

async function init() {
  const t0 = performance.now();
  try {
    await loadLiteRt(WASM_JS_URL);
    const t1 = performance.now();

    let accelerator = "webgpu";
    let model: CompiledModel;
    try {
      model = await loadAndCompile(MODEL_URL, { accelerator: "webgpu" });
    } catch (webgpuError) {
      console.warn("[litert-spike worker] webgpu compile failed, falling back to wasm:", webgpuError);
      accelerator = "wasm";
      model = await loadAndCompile(MODEL_URL, { accelerator: "wasm" });
    }
    const t2 = performance.now();

    compiledModel = model;
    const input0 = model.getInputDetails()[0];

    postMessage({
      type: "ready",
      inputShape: Array.from(input0.shape),
      inputDtype: input0.dtype,
      accelerator,
      isFullyAccelerated: model.isFullyAccelerated,
      timings: {
        wasmLoadMs: Math.round(t1 - t0),
        modelCompileMs: Math.round(t2 - t1),
        totalColdLoadMs: Math.round(t2 - t0),
      },
    });
  } catch (err) {
    postMessage({ type: "error", phase: "init", message: err instanceof Error ? err.message : String(err) });
  }
}

async function runInference(msg: RunMsg) {
  if (!compiledModel) {
    postMessage({ type: "error", phase: "run", message: "Model not loaded yet." });
    return;
  }
  const t0 = performance.now();
  try {
    const inputDetails = compiledModel.getInputDetails()[0];
    const [, h, w, c] = inputDetails.shape;
    if (msg.width !== w || msg.height !== h) {
      throw new Error(`Preprocessed image (${msg.width}x${msg.height}) != model input (${w}x${h}).`);
    }

    const rgba = new Uint8ClampedArray(msg.pixels);
    const pixelCount = w * h;
    let inputData: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>;

    if (inputDetails.dtype === "uint8") {
      inputData = new Uint8Array(pixelCount * c);
      for (let i = 0; i < pixelCount; i++) {
        inputData[i * 3] = rgba[i * 4];
        inputData[i * 3 + 1] = rgba[i * 4 + 1];
        inputData[i * 3 + 2] = rgba[i * 4 + 2];
      }
    } else {
      inputData = new Float32Array(pixelCount * c);
      for (let i = 0; i < pixelCount; i++) {
        inputData[i * 3] = rgba[i * 4] / 255;
        inputData[i * 3 + 1] = rgba[i * 4 + 1] / 255;
        inputData[i * 3 + 2] = rgba[i * 4 + 2] / 255;
      }
    }

    const inputTensor = new Tensor(inputData, [1, h, w, c]);
    const outputs = await compiledModel.run(inputTensor);
    const outputList: Tensor[] = Array.isArray(outputs) ? outputs : Object.values(outputs);
    const data = await outputList[0].data();

    const blur = Number(data[0]);
    const sharp = Number(data[1]);
    const label = blur >= sharp ? LABELS[0] : LABELS[1];

    inputTensor.delete();
    outputList.forEach((t) => t.delete());

    const t1 = performance.now();
    postMessage({
      type: "result",
      label,
      confidences: { BLUR: blur, SHARP: sharp },
      accelerator: compiledModel.options.accelerator as string,
      isFullyAccelerated: compiledModel.isFullyAccelerated,
      inferenceMs: Math.round(t1 - t0),
    });
  } catch (err) {
    postMessage({ type: "error", phase: "run", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "init") void init();
  else if (msg.type === "run") void runInference(msg);
};
