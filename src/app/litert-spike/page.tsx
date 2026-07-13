"use client";

// ============================================================================
// EXPERIMENTAL SPIKE -- NOT A PRODUCT PAGE. Safe to delete this whole
// directory (src/app/litert-spike/) plus public/litert-spike/ once reviewed.
//
// Purpose: prove/disprove whether Google's LiteRT.js (@litertjs/core, an
// edge-inference WASM runtime) can load a real pretrained vision model and
// run client-side inference inside this Next.js 16 App Router stack. This
// page is intentionally standalone: it lives outside src/app/(app)/ (so it
// carries no auth gate, no AppShell chrome, no nav entry) and touches no
// production file, DB table, or API route.
//
// What it does: upload an image -> resize it client-side to the model's
// expected input -> run a MobileNetV2 blur/sharp binary classifier via
// LiteRT.js in a dedicated Web Worker (public/litert-spike/wasm/inference-worker.js,
// esbuild-bundled from worker-src/inference-worker.ts -- NOT bundled by
// Turbopack; see that file's header comment for why) -> show BLURRY or SHARP
// with confidence.
//
// Setup before first use: `bun run spike:litert-setup` (copies the wasm
// runtime out of node_modules and builds the worker bundle -- both are
// gitignored, see .gitignore's "litert-spike" entry and the two scripts'
// headers for why they're regenerated rather than committed).
//
// Known limitation, stated plainly: the pretrained model this page loads
// (see worker-src/inference-worker.ts's MODEL_URL comment) comes from a
// third-party GitHub repo with no LICENSE file -- i.e. no explicit
// permission to reuse. It is fetched directly from its original public
// location at inference time (never copied into this repo) specifically to
// avoid redistributing unlicensed IP, but that is a mitigation, not a green
// light: do not point any production build at this model without resolving
// that first (train a first-party model, or find one under Apache/MIT/etc).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { WorkerOutMessage, ReadyMessage, ResultMessage } from "./types";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; info: ReadyMessage }
  | { phase: "error"; message: string };

type RunState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; result: ResultMessage; clientRoundTripMs: number }
  | { phase: "error"; message: string };

export default function LiteRtSpikePage() {
  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [runState, setRunState] = useState<RunState>({ phase: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const runStartRef = useRef<number>(0);

  useEffect(() => {
    // Served from public/litert-spike/wasm/inference-worker.js -- a classic
    // (non-module) worker, esbuild-bundled from worker-src/inference-worker.ts
    // by scripts/spike-litert-build-worker.mjs and deliberately placed in the
    // same directory as the wasm binaries. Both details are load-bearing, not
    // stylistic: see worker-src/inference-worker.ts's header comment for the
    // real errors hit trying the "obvious" Turbopack-bundled ES-module-worker
    // approach first.
    const worker = new Worker("/litert-spike/wasm/inference-worker.js");
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        setLoadState({ phase: "ready", info: msg });
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

  const handleFile = useCallback(
    async (file: File) => {
      if (loadState.phase !== "ready") return;
      setRunState({ phase: "running" });
      setPreviewUrl(URL.createObjectURL(file));

      const [, h, w] = loadState.info.inputShape; // [1, H, W, 3]
      const bitmap = await createImageBitmap(file);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = w;
      canvas.height = h;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.drawImage(bitmap, 0, 0, w, h);
      const imageData = ctx2d.getImageData(0, 0, w, h);

      runStartRef.current = performance.now();
      const pixels = imageData.data.buffer as ArrayBuffer;
      workerRef.current?.postMessage(
        { type: "run", requestId: Date.now(), width: w, height: h, pixels },
        [pixels],
      );
    },
    [loadState],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <Alert className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <AlertTitle>Experimental spike -- not a product feature</AlertTitle>
        <AlertDescription>
          Isolated prototype evaluating Google&apos;s LiteRT.js edge-inference runtime.
          Not linked from any nav, not wired into the app shell or auth. See the header
          comment in this route&apos;s page.tsx for scope and a model-licensing caveat.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>LiteRT.js blur/sharp classifier spike</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Runtime status:</span>
            {loadState.phase === "loading" && <Badge variant="secondary">loading WASM + model...</Badge>}
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
              <div>input shape: [{loadState.info.inputShape.join(", ")}] ({loadState.info.inputDtype})</div>
              <div>wasm load: {loadState.info.timings.wasmLoadMs} ms</div>
              <div>model fetch + compile: {loadState.info.timings.modelCompileMs} ms</div>
              <div>total cold load: {loadState.info.timings.totalColdLoadMs} ms</div>
            </div>
          )}

          {loadState.phase === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Load failed</AlertTitle>
              <AlertDescription className="font-mono text-xs">{loadState.message}</AlertDescription>
            </Alert>
          )}

          <div>
            <input
              type="file"
              accept="image/*"
              disabled={loadState.phase !== "ready"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground"
            />
          </div>

          {previewUrl && (
            <img src={previewUrl} alt="Uploaded preview" className="max-h-64 rounded-md border" />
          )}
          <canvas ref={canvasRef} className="hidden" />

          {runState.phase === "running" && <Badge variant="secondary">running inference...</Badge>}

          {runState.phase === "done" && (
            <div className="space-y-2">
              <Badge
                className={runState.result.label === "SHARP" ? "bg-emerald-600" : "bg-red-600"}
              >
                {runState.result.label === "SHARP" ? "SHARP (pass)" : "BLURRY (fail)"}
              </Badge>
              <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-1">
                <div>BLUR confidence: {runState.result.confidences.BLUR.toFixed(4)}</div>
                <div>SHARP confidence: {runState.result.confidences.SHARP.toFixed(4)}</div>
                <div>accelerator: {runState.result.accelerator} (fully accelerated: {String(runState.result.isFullyAccelerated)})</div>
                <div>worker-measured inference time: {runState.result.inferenceMs} ms</div>
                <div>client round-trip (incl. postMessage + preprocessing): {runState.clientRoundTripMs} ms</div>
              </div>
            </div>
          )}

          {runState.phase === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Inference failed</AlertTitle>
              <AlertDescription className="font-mono text-xs">{runState.message}</AlertDescription>
            </Alert>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRunState({ phase: "idle" });
              setPreviewUrl(null);
            }}
          >
            Reset
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
