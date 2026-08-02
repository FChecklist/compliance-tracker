// EXPERIMENTAL SPIKE -- see page.tsx header comment for scope/removal notes.
// Shared message types between the main thread and inference-worker.ts.

export interface LoadTimings {
  wasmLoadMs: number;
  vocabFetchMs: number;
  modelCompileMs: number;
  totalColdLoadMs: number;
}

export interface ReadyMessage {
  type: "ready";
  accelerator: string;
  isFullyAccelerated: boolean;
  inputNames: string[];
  maxSeqLen: number;
  embeddingDim: number;
  timings: LoadTimings;
}

export interface ErrorMessage {
  type: "error";
  phase: "init" | "run";
  message: string;
}

export interface SentenceResult {
  text: string;
  tokenCount: number;
  inferenceMs: number;
}

export interface SimilarityPair {
  aIndex: number;
  bIndex: number;
  cosine: number;
  /** True for the pair this spike expects to be the MOST similar (a vs b, same topic). */
  expectedMostSimilar: boolean;
}

export interface ResultMessage {
  type: "result";
  accelerator: string;
  isFullyAccelerated: boolean;
  embeddingDim: number;
  sentences: SentenceResult[];
  similarities: SimilarityPair[];
  totalInferenceMs: number;
}

export type WorkerOutMessage = ReadyMessage | ErrorMessage | ResultMessage;

export interface InitMessage {
  type: "init";
}

export interface RunMessage {
  type: "run";
  sentences: string[];
}

export type WorkerInMessage = InitMessage | RunMessage;
