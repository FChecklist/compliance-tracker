// EXPERIMENTAL SPIKE -- see page.tsx header comment for scope/removal notes.
// Shared message types between the main thread and litert-worker.ts.

export type Accel = "webgpu" | "wasm";

export interface ReadyMessage {
  type: "ready";
  inputShape: number[];
  inputDtype: string;
  accelerator: string;
  isFullyAccelerated: boolean;
  timings: {
    wasmLoadMs: number;
    modelCompileMs: number;
    totalColdLoadMs: number;
  };
}

export interface ErrorMessage {
  type: "error";
  phase: string;
  message: string;
}

export interface ResultMessage {
  type: "result";
  label: "BLUR" | "SHARP";
  confidences: { BLUR: number; SHARP: number };
  accelerator: string;
  isFullyAccelerated: boolean;
  inferenceMs: number;
}

export type WorkerOutMessage = ReadyMessage | ErrorMessage | ResultMessage;

export interface RunMessage {
  type: "run";
  requestId: number;
  width: number;
  height: number;
  // Raw RGBA pixel bytes (from canvas ImageData), transferred.
  pixels: ArrayBuffer;
}

export interface InitMessage {
  type: "init";
}

export type WorkerInMessage = InitMessage | RunMessage;
