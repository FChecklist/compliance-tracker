"use client";

// ============================================================================
// EXPERIMENTAL SPIKE -- NOT A PRODUCT PAGE. Safe to delete this whole
// directory (src/app/litert-spike-embeddings/) plus
// public/litert-spike-embeddings/ once reviewed.
//
// Purpose: Priority 14 / GAP-LITERT-EDGE-INFERENCE, Phase 0 per
// PLATFORM_STRATEGY.md section 28.4 -- prove/disprove whether LiteRT.js
// (@litertjs/core) can load a real, small TEXT EMBEDDINGS model and run
// client-side semantic-similarity inference inside this Next.js 16 App
// Router stack, with real measured numbers, before any commitment to the
// Phase 1 dynamic edge_inference_models manifest infrastructure described in
// section 28.3 (NOT built here).
//
// Distinct from the sibling src/app/litert-spike/ (an unrelated, earlier
// evaluation of an image blur/quality classifier) -- that spike is untouched
// by this one. The real target this could eventually feed: CONSTITUTION.yaml's
// UMR-03 rule (store every chat instruction so a similar future one can be
// answered from what was already learned) could plausibly use a client-side
// embeddings check before any server round-trip -- but this page does NOT
// implement that; it only measures whether the underlying mechanism works at
// all. No chat-service.ts, UMR, or production code path is touched.
//
// What it does: loads all-MiniLM-L6-v2 (INT8-quantized, 384-dim sentence
// embeddings, apache-2.0 -- see worker-src/inference-worker.ts's MODEL_URL
// comment for the licensing check performed) via LiteRT.js in a dedicated Web
// Worker (public/litert-spike-embeddings/wasm/inference-worker.js,
// esbuild-bundled from worker-src/inference-worker.ts -- NOT bundled by
// Turbopack, same reason as the sibling spike), tokenizes 3 hardcoded sample
// sentences with a hand-written WordPiece tokenizer
// (worker-src/wordpiece-tokenizer.ts), embeds each, and reports real load
// time / accelerator / embedding dimensionality / pairwise cosine similarity.
//
// Setup before first use: `bun run spike:litert-embeddings-setup` (copies the
// wasm runtime out of node_modules and builds the worker bundle -- both
// gitignored; see .gitignore's "litert-spike-embeddings" entry and the
// script's own header for why they're regenerated rather than committed).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { WorkerOutMessage, ReadyMessage, ResultMessage } from "./types";

// Constructed on purpose: [0] and [1] are a paraphrase pair (same meaning,
// different words) and [2] is an unrelated topic -- the sanity check this
// spike exists to run is "does cosine(0,1) come out meaningfully higher than
// cosine(0,2) and cosine(1,2)?"
const SAMPLE_SENTENCES = [
  "The quick brown fox jumps over the lazy dog.",
  "A fast auburn fox leaps above a sleepy dog.",
  "Quarterly revenue increased due to strong enterprise sales.",
];

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; info: ReadyMessage }
  | { phase: "error"; message: string };

type RunState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; result: ResultMessage; clientRoundTripMs: number }
  | { phase: "error"; message: string };

export default function LiteRtEmbeddingsSpikePage() {
  const workerRef = useRef<Worker | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const runStartRef = useRef<number>(0);

  useEffect(() => {
    const worker = new Worker("/litert-spike-embeddings/wasm/inference-worker.js");
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        setLoadState({ phase: "ready", info: msg });
        runStartRef.current = performance.now();
        setRunState({ phase: "running" });
        worker.postMessage({ type: "run", sentences: SAMPLE_SENTENCES });
      } else if (msg.type === "error") {
        if (msg.phase === "init") {
          setLoadState({ phase: "error", message: msg.message });
        } else {
          setRunState({ phase: "error", message: msg.message });
        }
      } else if (msg.type === "result") {
        setRunState({
          phase: "done",
          result: msg,
          clientRoundTripMs: Math.round(performance.now() - runStartRef.current),
        });
      }
    };

    worker.postMessage({ type: "init" });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const rerun = () => {
    if (loadState.phase !== "ready" || !workerRef.current) return;
    runStartRef.current = performance.now();
    setRunState({ phase: "running" });
    workerRef.current.postMessage({ type: "run", sentences: SAMPLE_SENTENCES });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <Alert className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <AlertTitle>Experimental spike -- not a product feature</AlertTitle>
        <AlertDescription>
          Priority 14 / GAP-LITERT-EDGE-INFERENCE Phase 0 technology-readiness spike:
          real, narrow LiteRT.js embeddings measurement, not a preview of a shipping
          feature. Not linked from any nav, not wired into the app shell or auth. See
          the header comment in this route&apos;s page.tsx for full scope.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>LiteRT.js text-embeddings spike (all-MiniLM-L6-v2)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Runtime status:</span>
            {loadState.phase === "loading" && <Badge variant="secondary">loading WASM + model + vocab...</Badge>}
            {loadState.phase === "ready" && (
              <Badge className="bg-emerald-600">
                ready via {loadState.info.accelerator}
                {loadState.info.isFullyAccelerated ? " (fully accelerated)" : " (partial CPU fallback)"}
              </Badge>
            )}
            {loadState.phase === "error" && <Badge variant="destructive">failed to load</Badge>}
          </div>

          {loadState.phase === "ready" && (
            <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1">
              <div>embedding dimensionality: {loadState.info.embeddingDim}</div>
              <div>model input tensor names: {loadState.info.inputNames.join(", ")}</div>
              <div>sequence length used: {loadState.info.maxSeqLen}</div>
              <div>wasm load: {loadState.info.timings.wasmLoadMs} ms</div>
              <div>model fetch + compile: {loadState.info.timings.modelCompileMs} ms</div>
              <div>vocab fetch: {loadState.info.timings.vocabFetchMs} ms</div>
              <div>total cold load: {loadState.info.timings.totalColdLoadMs} ms</div>
            </div>
          )}

          {loadState.phase === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Load failed</AlertTitle>
              <AlertDescription className="font-mono text-xs">{loadState.message}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1 text-sm">
            <div className="font-medium">Sample sentences:</div>
            <ol className="list-decimal list-inside text-xs font-mono space-y-0.5">
              {SAMPLE_SENTENCES.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>

          {runState.phase === "running" && <Badge variant="secondary">embedding sample sentences...</Badge>}

          {runState.phase === "done" && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1">
                {runState.result.sentences.map((s, i) => (
                  <div key={i}>
                    [{i}] {s.tokenCount} tokens, {s.inferenceMs} ms inference
                  </div>
                ))}
                <div>total inference (all sentences): {runState.result.totalInferenceMs} ms</div>
                <div>client round-trip (incl. postMessage): {runState.clientRoundTripMs} ms</div>
              </div>

              <div className="space-y-2">
                <div className="font-medium text-sm">Pairwise cosine similarity (sanity check)</div>
                {runState.result.similarities.map((sim, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono">
                    <Badge variant={sim.expectedMostSimilar ? "default" : "secondary"}>
                      [{sim.aIndex}] vs [{sim.bIndex}]
                    </Badge>
                    <span>{sim.cosine.toFixed(4)}</span>
                    {sim.expectedMostSimilar && (
                      <span className="text-muted-foreground">(expected highest -- paraphrase pair)</span>
                    )}
                  </div>
                ))}
                {(() => {
                  const paraphrasePair = runState.result.similarities.find((s) => s.expectedMostSimilar);
                  const others = runState.result.similarities.filter((s) => !s.expectedMostSimilar);
                  const maxOther = others.length ? Math.max(...others.map((s) => s.cosine)) : null;
                  if (!paraphrasePair || maxOther === null) return null;
                  const pass = paraphrasePair.cosine > maxOther;
                  return (
                    <Badge className={pass ? "bg-emerald-600" : "bg-red-600"}>
                      sanity check: {pass ? "PASS" : "FAIL"} (paraphrase similarity{" "}
                      {pass ? ">" : "<="} every other pair)
                    </Badge>
                  );
                })()}
              </div>
            </div>
          )}

          {runState.phase === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Inference failed</AlertTitle>
              <AlertDescription className="font-mono text-xs">{runState.message}</AlertDescription>
            </Alert>
          )}

          <Button variant="outline" size="sm" onClick={rerun} disabled={loadState.phase !== "ready"}>
            Re-run
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
