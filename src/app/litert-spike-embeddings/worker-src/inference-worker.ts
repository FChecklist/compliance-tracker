// EXPERIMENTAL SPIKE -- see ../page.tsx header comment for scope/removal.
//
// Bundling/worker-placement approach copied deliberately from the sibling
// src/app/litert-spike/worker-src/inference-worker.ts (that spike's header
// comment documents the exact root cause: @litertjs/core's Emscripten glue
// resolves the .wasm binary relative to the WORKER SCRIPT's own
// self.location, not the path string passed to loadLiteRt(), which breaks
// both Turbopack-bundled ES-module workers and any worker not physically
// co-located with the wasm files). Same fix here: esbuild-bundle this file to
// a classic (non-module) worker script, physically placed in
// public/litert-spike-embeddings/wasm/ next to the wasm binaries, via
// scripts/spike-litert-embeddings-setup.mjs.
//
// What's different from the vision spike: this loads a TEXT embeddings
// model, which (unlike an image classifier) cannot run on raw bytes -- it
// needs real WordPiece tokenization into input_ids/attention_mask tensors
// first. See ./wordpiece-tokenizer.ts.

import { loadLiteRt, loadAndCompile, Tensor, type CompiledModel, type TensorDetails } from "@litertjs/core";
import { parseVocab, encode } from "./wordpiece-tokenizer";

const WASM_JS_URL = "litert_wasm_internal.js"; // same-directory as this bundled script

// all-MiniLM-L6-v2, INT8-quantized (weights only -- confirmed via its HF
// model card's own usage example that input_ids/attention_mask stay int32
// and output stays float32, i.e. this is weight-only quantization, not a
// fully int8-quantized graph that would need dequantization params this API
// doesn't expose). Community conversion
// (Nihal2000/all-MiniLM-L6-v2-quant.tflite, 22.8MB) but -- UNLIKE the
// sibling vision spike's model -- explicitly tagged license: apache-2.0 on
// its HuggingFace model card, consistent with the apache-2.0 license on the
// upstream sentence-transformers/all-MiniLM-L6-v2 it was converted from
// (confirmed by fetching both HF pages directly, not assumed).
//
// REAL FINDING from this spike, stated plainly rather than hidden: this
// model loads and compiles successfully (see the real measured timings this
// route reports), but model.run() fails with "TensorBuffer ranked tensor
// type Int32[1, 32] does not match expected ranked tensor type
// Int32[-1, -1]" -- this TF-signature-based export declares BOTH input dims
// fully dynamic, and @litertjs/core v2.5.2's CompiledModel.run() requires
// the constructed Tensor's declared shape to exactly match the model's own
// declared shape (including -1 markers) -- there is no public resize-input-
// tensor call to concretize a dynamic-shape model before running it, and
// passing shape=[-1,-1] straight through instead crashes inside LiteRT's
// native layout code (litert_layout.h) when it tries to allocate a concrete
// buffer. A second real model was tried to work around this
// (Bombek1/all-MiniLM-L12-v2-litert, converted with Google's own
// ai-edge-torch tool from PyTorch, which -- being traced against concrete
// example inputs -- DOES declare a fixed shape) but hit a *different* real
// wall: that PyTorch-traced export kept native int64 input_ids, and
// @litertjs/core's exposed Tensor/DATATYPES surface only supports
// {float32, int32, uint8} -- "Element type INT64 is not supported.",
// thrown at compile time, before any inference is even attempted. Kept this
// (the first) model as the one this page loads because it gets further
// (real load/compile timings + confirmed accelerator + confirmed embedding
// dimensionality from the model's own output signature), and its failure
// mode is more informative than the second model's earlier, blunter one.
// Fetched at inference time from its original public location rather than
// vendored into this repo, purely to avoid a 22.8MB binary in git history --
// not a licensing workaround.
const MODEL_URL =
  "https://huggingface.co/Nihal2000/all-MiniLM-L6-v2-quant.tflite/resolve/main/all-MiniLM-L6-v2-quant.tflite";

// Tokenizer vocab for the same model (all-MiniLM-L6-v2 uses the standard
// bert-base-uncased WordPiece vocab, 30522 tokens). Fetched directly from the
// canonical sentence-transformers repo (apache-2.0) at inference time, same
// reasoning as the model URL above.
const VOCAB_URL = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt";

// Fallback sequence length used only if the model reports a dynamic
// (non-positive) sequence dimension. All-MiniLM-L6-v2's real max is 128, but
// this spike's sample sentences never need that; a shorter fixed length
// means smaller tensors and faster runs with identical results for our
// inputs (attention_mask zeroes out the padding regardless).
const FALLBACK_MAX_SEQ_LEN = 32;

interface RunMsg {
  type: "run";
  sentences: string[];
}
type InMsg = { type: "init" } | RunMsg;

let compiledModel: CompiledModel | null = null;
let vocab: Map<string, number> | null = null;
let maxSeqLen = FALLBACK_MAX_SEQ_LEN;

function findInputDim(details: readonly TensorDetails[], nameHint: string): TensorDetails | undefined {
  return details.find((d) => d.name.toLowerCase().includes(nameHint));
}

/**
 * Sanitizes a model-reported tensor shape into a concrete allocation shape.
 * TFLite exports commonly report dynamic dimensions as -1 or 0 (e.g. a
 * dynamic batch size, or a dynamic sequence length when the model supports
 * variable-length input) -- LiteRT.js Tensor constructor needs concrete
 * positive dimensions to allocate a real buffer, so any non-positive
 * dimension is replaced positionally: batch (dim 0) becomes 1 (this spike
 * only ever runs one sentence per model.run() call), sequence (last dim)
 * becomes the resolved maxSeqLen. Found necessary by direct testing: passing
 * a raw declared shape that still contains -1 straight through crashes deep
 * inside LiteRT native layout code (litert_layout.h).
 */
function sanitizeShape(shape: Int32Array | number[], maxSeqLen: number): number[] {
  const dims = Array.from(shape);
  return dims.map((d, i) => {
    if (d > 0) return d;
    return i === dims.length - 1 ? maxSeqLen : 1;
  });
}

function buildInputTensors(
  details: readonly TensorDetails[],
  encoded: { inputIds: Int32Array; attentionMask: Int32Array; tokenTypeIds: Int32Array },
  maxSeqLen: number,
): Record<string, Tensor> {
  const byHint: Array<[string, Int32Array]> = [
    ["input_ids", encoded.inputIds],
    ["attention_mask", encoded.attentionMask],
    ["token_type_ids", encoded.tokenTypeIds],
  ];
  const tensors: Record<string, Tensor> = {};
  const matchedNames = new Set<string>();
  const usedData = new Set<Int32Array>();

  for (const [hint, data] of byHint) {
    const match = findInputDim(details, hint);
    if (match) {
      tensors[match.name] = new Tensor(data, sanitizeShape(match.shape, maxSeqLen));
      matchedNames.add(match.name);
      usedData.add(data);
    }
  }

  // Fallback for models (like this one) whose tflite export gives generic
  // signature names ("inputs", "inputs_1") instead of "input_ids"/
  // "attention_mask" -- assign the remaining tensors positionally, in
  // declared-input order. This model has exactly 2 inputs (input_ids,
  // attention_mask -- no token_type_ids), confirmed via its HF model cards
  // own Python usage example before writing this.
  const unmatchedDetails = details.filter((d) => !matchedNames.has(d.name));
  const unmatchedData = byHint.map(([, data]) => data).filter((data) => !usedData.has(data));
  unmatchedDetails.forEach((d, i) => {
    if (unmatchedData[i]) {
      tensors[d.name] = new Tensor(unmatchedData[i], sanitizeShape(d.shape, maxSeqLen));
    }
  });

  return tensors;
}

function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // Both inputs are already L2-normalized, so cosine similarity reduces to
  // a plain dot product.
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function init() {
  const t0 = performance.now();
  try {
    await loadLiteRt(WASM_JS_URL);
    const t1 = performance.now();

    const vocabPromise = fetch(VOCAB_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`vocab fetch failed: HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => parseVocab(text));

    let accelerator = "webgpu";
    let model: CompiledModel;
    try {
      model = await loadAndCompile(MODEL_URL, { accelerator: "webgpu" });
    } catch (webgpuError) {
      console.warn("[litert-spike-embeddings worker] webgpu compile failed, falling back to wasm:", webgpuError);
      accelerator = "wasm";
      model = await loadAndCompile(MODEL_URL, { accelerator: "wasm" });
    }
    const t2 = performance.now();

    vocab = await vocabPromise;
    const t3 = performance.now();

    compiledModel = model;
    const inputDetails = model.getInputDetails();
    const outputDetails = model.getOutputDetails();

    const inputIdsDetail = findInputDim(inputDetails, "input_ids") ?? inputDetails[0];
    const seqDim = inputIdsDetail ? (Array.from(inputIdsDetail.shape).at(-1) ?? 0) : 0;
    maxSeqLen = seqDim > 0 ? seqDim : FALLBACK_MAX_SEQ_LEN;

    const embeddingDim = Array.from(outputDetails[0]?.shape ?? []).at(-1) ?? 0;

    postMessage({
      type: "ready",
      accelerator,
      isFullyAccelerated: model.isFullyAccelerated,
      inputNames: inputDetails.map((d) => d.name),
      maxSeqLen,
      embeddingDim,
      timings: {
        wasmLoadMs: Math.round(t1 - t0),
        vocabFetchMs: Math.round(t3 - t2),
        modelCompileMs: Math.round(t2 - t1),
        totalColdLoadMs: Math.round(t3 - t0),
      },
    });
  } catch (err) {
    postMessage({ type: "error", phase: "init", message: err instanceof Error ? err.message : String(err) });
  }
}

async function embed(text: string): Promise<{ vector: Float32Array; tokenCount: number; inferenceMs: number }> {
  if (!compiledModel || !vocab) throw new Error("Model/vocab not loaded yet.");

  const encoded = encode(text, vocab, maxSeqLen);
  const inputDetails = compiledModel.getInputDetails();
  const outputDetails = compiledModel.getOutputDetails();
  const inputTensors = buildInputTensors(inputDetails, encoded, maxSeqLen);

  const t0 = performance.now();
  const outputs = await compiledModel.run(inputTensors);
  const outputList: Tensor[] = Array.isArray(outputs) ? outputs : Object.values(outputs);
  const outShape = Array.from(outputDetails[0]?.shape ?? outputList[0]?.type.layout.dimensions ?? []);
  const raw = (await outputList[0].data()) as Float32Array;
  const t1 = performance.now();

  let embedding: Float32Array;
  if (outShape.length >= 3) {
    // [1, seqLen, hidden] token-level output -- mean-pool over real
    // (non-padding) tokens using the attention mask, matching
    // sentence-transformers' own default pooling strategy for this model
    // family.
    const seqLen = outShape.at(-2) ?? maxSeqLen;
    const hidden = outShape.at(-1) ?? 0;
    const pooled = new Float32Array(hidden);
    let realTokens = 0;
    for (let s = 0; s < seqLen; s++) {
      if (encoded.attentionMask[s] === 0) continue;
      realTokens++;
      for (let h = 0; h < hidden; h++) pooled[h] += raw[s * hidden + h];
    }
    const denom = realTokens || 1;
    for (let h = 0; h < hidden; h++) pooled[h] /= denom;
    embedding = pooled;
  } else {
    // Already a pooled [1, hidden] sentence embedding.
    embedding = raw;
  }

  Object.values(inputTensors).forEach((t) => t.delete());
  outputList.forEach((t) => t.delete());

  return {
    vector: l2Normalize(embedding),
    tokenCount: encoded.tokens.length,
    inferenceMs: Math.round(t1 - t0),
  };
}

async function runAll(msg: RunMsg) {
  if (!compiledModel || !vocab) {
    postMessage({ type: "error", phase: "run", message: "Model not loaded yet." });
    return;
  }
  try {
    const overallStart = performance.now();
    const results: { text: string; tokenCount: number; inferenceMs: number; vector: Float32Array }[] = [];
    for (const text of msg.sentences) {
      const { vector, tokenCount, inferenceMs } = await embed(text);
      results.push({ text, tokenCount, inferenceMs, vector });
    }
    const overallEnd = performance.now();

    const similarities: Array<{ aIndex: number; bIndex: number; cosine: number; expectedMostSimilar: boolean }> = [];
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        similarities.push({
          aIndex: i,
          bIndex: j,
          cosine: cosineSimilarity(results[i].vector, results[j].vector),
          // Sample set is constructed (see page.tsx) so sentences 0 and 1
          // are the paraphrase pair -- the one pair this spike expects
          // highest.
          expectedMostSimilar: i === 0 && j === 1,
        });
      }
    }

    postMessage({
      type: "result",
      accelerator: compiledModel.options.accelerator as string,
      isFullyAccelerated: compiledModel.isFullyAccelerated,
      embeddingDim: results[0]?.vector.length ?? 0,
      sentences: results.map(({ text, tokenCount, inferenceMs }) => ({ text, tokenCount, inferenceMs })),
      similarities,
      totalInferenceMs: Math.round(overallEnd - overallStart),
    });
  } catch (err) {
    postMessage({ type: "error", phase: "run", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "init") void init();
  else if (msg.type === "run") void runAll(msg);
};
