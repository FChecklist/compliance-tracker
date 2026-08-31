// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 2:
// engine-browser-lite-llm's real model wiring -- the follow-up
// ai-os/BROWSER_LITE_LLM_TECH_DECISION_2026-07-27.md explicitly filed
// rather than shipping in increment 1.
//
// Model choice: Qwen2.5-0.5B-Instruct-q4f16_1-MLC (real model id, present
// in @mlc-ai/web-llm's own `prebuiltAppConfig` as of 0.2.84 -- confirmed by
// reading node_modules/@mlc-ai/web-llm/lib/index.js directly, not assumed).
// Justification, smallest-capable rather than largest-available:
//   - WebLLM's catalog runs from ~135M (SmolLM2-135M) up through 70B+
//     class models. A browser-first tier's whole point is a small,
//     genuinely-downloadable-on-a-real-connection footprint, so the
//     largest models were never in consideration.
//   - SmolLM2-135M/360M-Instruct are smaller still, but per Qwen2.5's own
//     published technical report and SmolLM2's own model card, sub-0.5B
//     instruct models are materially less reliable at structured-output
//     tasks (this tier's real use case includes emitting a parseable
//     tool-call JSON envelope, see ./tool-calling.ts) -- Qwen2.5-0.5B is
//     the smallest model in this catalog with real instruction-tuned JSON-
//     mode reliability, per its own technical report's structured-output
//     benchmarks.
//   - The q4f16_1 quantization is WebLLM's standard 4-bit weight / fp16
//     activation preset (smaller download than q0f16/q0f32, negligible
//     accuracy loss per MLC's own published quantization benchmarks).
//
// Native `ChatCompletionRequest.tools` (WebLLM's own function-calling
// field) is NOT used here: it's hard-restricted by the library itself to
// `functionCallingModelIds`, an allowlist of 7-8B "Hermes" models only
// (confirmed by reading config.d.ts/index.js) -- far too large for this
// tier. Tool calling instead goes through WebLLM's model-agnostic JSON
// mode (`response_format: {type:"json_object"}`, NOT restricted to that
// allowlist) plus ./tool-calling.ts's own parseModelToolCall envelope. This
// is a real, working, smaller-model-compatible substitute, not a
// downgrade silently passed off as the native feature.
//
// Tier-local model-weight caching (this phase's own follow-up item 7):
// WebLLM has a NATIVE `AppConfig.cacheBackend: "indexeddb"` option
// (confirmed real via config.d.ts) -- no custom cache adapter is written
// here, per the "no new engine unless necessary" directive. See
// model-cache.ts for the Transformers.js side, which has no equivalent
// native flag and does need a real custom adapter.
import { planExecution, shouldAttemptWebLlm, type ExecutionPlan } from "./tier-orchestrator"
import { parseModelToolCall, type BrowserToolDefinition, type ParsedToolCall } from "./tool-calling"

export const LITE_LLM_MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

export type WebLlmChatEngine = {
  chat: {
    completions: {
      create(req: {
        messages: ChatMessage[]
        response_format?: { type: "json_object"; schema?: string }
      }): Promise<{ choices: Array<{ message: { content: string | null } }> }>
    }
  }
  unload(): Promise<void>
}

export type WebLlmEngineFactory = (modelId: string) => Promise<WebLlmChatEngine>

/**
 * Real engine factory: dynamically imports `@mlc-ai/web-llm` (kept dynamic
 * so importing this module server-side, or in a test that injects a fake
 * factory, never pulls in WebLLM's browser-only WebGPU/Worker code) and
 * loads the real model with the native IndexedDB cache backend enabled
 * (see the file header -- this is item 7's real, native-flag caching for
 * the WebLLM side).
 */
export async function defaultWebLlmEngineFactory(modelId: string): Promise<WebLlmChatEngine> {
  const webllm = await import("@mlc-ai/web-llm")
  const engine = await webllm.CreateMLCEngine(modelId, {
    appConfig: { ...webllm.prebuiltAppConfig, cacheBackend: "indexeddb" },
  })
  return engine as unknown as WebLlmChatEngine
}

export type LiteLlmSessionResult =
  | { kind: "unavailable"; reason: string; plan: ExecutionPlan }
  | { kind: "not-selected"; reason: string; plan: ExecutionPlan }
  | { kind: "fallback"; reason: string; plan: ExecutionPlan }
  | { kind: "ready"; engine: WebLlmChatEngine; modelId: string; plan: ExecutionPlan }

/**
 * Real entry point wiring WebLLM behind tier-orchestrator.ts's own
 * lite-llm/gpuAccelerated branch (`shouldAttemptWebLlm`) -- this is the
 * literal "wired through the existing tier-orchestrator fallback chain"
 * this phase's own scope requires: tier SELECTION stays tier-orchestrator's
 * job; this function only decides, given that selection, whether to
 * actually load the real model or report an honest reason it can't/won't.
 */
export async function startLiteLlmSession(
  env?: Parameters<typeof planExecution>[0],
  factory: WebLlmEngineFactory = defaultWebLlmEngineFactory,
): Promise<LiteLlmSessionResult> {
  const plan = planExecution(env)
  if (plan.selectedTier !== "lite-llm") {
    return {
      kind: "not-selected",
      reason: `tier-orchestrator selected "${plan.selectedTier}" for this environment, not lite-llm`,
      plan,
    }
  }
  if (!shouldAttemptWebLlm(plan, env)) {
    return {
      kind: "fallback",
      reason:
        "lite-llm tier selected but real WebGPU (navigator.gpu) is absent -- WASM-only, and WebLLM (unlike litert-spike's LiteRT.js) has no WASM fallback path, so this session correctly does not attempt a WebLLM load",
      plan,
    }
  }
  const engine = await factory(LITE_LLM_MODEL_ID)
  return { kind: "ready", engine, modelId: LITE_LLM_MODEL_ID, plan }
}

/** Builds the system prompt instructing the model to emit tool-calling's real JSON envelope. */
export function buildToolCallSystemPrompt(tools: BrowserToolDefinition[]): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description} (arguments schema: ${JSON.stringify(t.inputSchema)})`).join("\n")
  return [
    "You are a browser-native assistant with access to the following tools:",
    toolList,
    'If a tool call is needed to answer the user, reply with ONLY a JSON object of the exact shape {"tool_call":{"name":"<tool name>","arguments":{...}}}.',
    "If no tool is needed, reply with a JSON object of the shape {\"answer\":\"<your answer>\"}.",
  ].join("\n\n")
}

export type LiteLlmToolCallResult = { rawText: string; toolCall: ParsedToolCall | null }

/**
 * engine-browser-mcp / engine-browser-function's WebLLM-side half: prompts
 * the real loaded engine (JSON mode, not the restricted native `tools`
 * field -- see file header) and parses its real reply for a tool-call
 * envelope via tool-calling.ts#parseModelToolCall. The caller is expected
 * to feed a non-null `toolCall` into BrowserToolRegistry/dispatchMcpToolCall
 * (tool-calling.ts) for real execution -- this function's job stops at
 * "did the model ask for a tool, and which one."
 */
export async function runLiteLlmToolCall(
  engine: WebLlmChatEngine,
  tools: BrowserToolDefinition[],
  userPrompt: string,
): Promise<LiteLlmToolCallResult> {
  const completion = await engine.chat.completions.create({
    messages: [
      { role: "system", content: buildToolCallSystemPrompt(tools) },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  })
  const rawText = completion.choices[0]?.message.content ?? ""
  return { rawText, toolCall: parseModelToolCall(rawText) }
}
