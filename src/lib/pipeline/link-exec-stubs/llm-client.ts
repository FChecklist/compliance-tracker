// Stub of src/lib/llm-client.ts for the ai-work-link-exec bundle: the model client.
import { thrower } from "./unavailable"
export const callLLM = thrower("the model client (callLLM)")
export const callLLMJson = thrower("the model client (callLLMJson)")
export const callLLMVision = thrower("the model client (callLLMVision)")
export const estimateCostUsd = thrower("the model client (estimateCostUsd)")
export class LLMHttpError extends Error {}
// src/lib/ai/org-own-ai.ts reads these keys at module load (the "Connect your AI" vendors, #2133). The bundle never calls a model, so the VALUES stay empty here:
// the real endpoints live only in the gated transport (src/lib/projexa-internal-ai.architecture.test.ts rule 1 forbids naming a model endpoint anywhere else).
// Without the keys the exec bundle could not be rebuilt (live UAT 2026-10-13: the deployed exec bundle predated the progress cap).
export const CUSTOMER_VENDOR_ENDPOINTS = { deepseek: "", zai: "", xai: "" } as const
