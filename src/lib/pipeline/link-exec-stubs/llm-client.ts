// Stub of src/lib/llm-client.ts for the ai-work-link-exec bundle: the model client.
import { thrower } from "./unavailable"
export const callLLM = thrower("the model client (callLLM)")
export const callLLMJson = thrower("the model client (callLLMJson)")
export const callLLMVision = thrower("the model client (callLLMVision)")
export const estimateCostUsd = thrower("the model client (estimateCostUsd)")
export class LLMHttpError extends Error {}
// src/lib/ai/org-own-ai.ts reads these endpoint constants at module load (the "Connect your AI" vendors, #2133); they are plain strings, so the stub carries them
// instead of a thrower. The bundle could not be rebuilt without them (live UAT 2026-10-13: the deployed exec bundle predated the progress cap).
export const CUSTOMER_VENDOR_ENDPOINTS = {
  deepseek: "https://api.deepseek.com/chat/completions",
  zai: "https://api.z.ai/api/paas/v4/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
} as const
