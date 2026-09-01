// R42 seq13 -- the OpenRouter AiProvider. Deliberately thin: reuses this
// repo's existing generic multi-provider caller (callLLMJson in
// llm-client.ts, which already supports "openrouter") rather than a second
// bespoke HTTP client. Deliberately NOT wired through
// orchestra-model-resolver.ts/policy-enforcement-engine/guardrail-engine --
// those belong to the separate AI Dev Team / customer-communication systems;
// M26/M27 ask for one narrow interface here, and reusing that larger
// machinery would re-couple exactly what this pipeline exists to keep simple.
import { callLLMJson } from "@/lib/llm-client";
import { resolvePipelineModel } from "@/lib/ai/level-model-registry";
import type { AiProvider, ClassificationResult, Artifact, ClassifyContext } from "../adapter";

// M26 target models -- exact OpenRouter slugs are an ops/cost decision, not
// a code one. R63 (owner directive, 2026-08-29): resolved fresh on every
// call via resolvePipelineModel() (an owner-editable platform.
// pipeline_level_models row, hot-reloaded within 60s, no redeploy) -- these
// two constants are now ONLY the documented fallback used when no active
// override row exists, never the live value directly. Env vars still work
// as the fallback's own override, unchanged for anyone relying on them.
const L1_MODEL_FALLBACK = process.env.AI_L1_MODEL ?? "deepseek/deepseek-chat";
const L2_MODEL_FALLBACK = process.env.AI_L2_MODEL ?? "deepseek/deepseek-chat-v3.1"; // "Pro" tier per M26; falls back to the same family as L1 if unset rather than a hardcoded guess at a Pro-tier slug

function requireApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set -- required when AI_PROVIDER=openrouter.");
  return key;
}

const CLASSIFY_SYSTEM_PROMPT = `You are Level 1 of a construction ERP's deterministic task pipeline. Your ONLY job: for each input segment, either select exactly one function_id from the given candidate list with its parameters, or report that you cannot.

Rules, absolute:
- You may NEVER invent a function_id that is not in candidateFunctions.
- You may NEVER perform arithmetic yourself -- if a computed value is needed, that is a missing param, not something for you to calculate.
- You may NEVER write to any database -- you only select a function and its parameters; execution happens elsewhere.
- You may NEVER return prose. Output ONLY the JSON shape described below.
- If a segment names a valid function but is missing a required parameter, return that function_id with the params you found and list the rest in missingParams -- do not guess a missing value.
- If a segment cannot be matched to any candidate function, set functionId to null, missingParams to [], confidence to 0, and unmappedIntent to a short honest description of what the user seems to want.

Output STRICT JSON: {"results": [{"functionId": string|null, "params": object, "missingParams": string[], "confidence": number (0-1), "unmappedIntent": string|null}, ...]} with exactly one entry per input segment, in the same order.`;

const ANALYSE_SYSTEM_PROMPT = `You are Level 2 of a construction ERP's deterministic task pipeline, running as a NIGHTLY BATCH job over the last 24h of unresolved user intents (gap_log), never in response to a live user request.

Rules, absolute:
- You may NEVER merge, deploy, run a migration, or touch production data.
- You may NEVER state a figure. Any SQL you produce must be SELECT-only and scoped to a single org_id -- emit the query, not the answer.
- Only propose a phrase_map candidate for a cluster with frequency >= 3 -- a single user's one-off is not a product signal.
- Every artifact you produce must cite the real gap_log ids it is based on.

Output STRICT JSON: {"artifacts": [<Artifact>, ...]} where each Artifact is one of:
  {"kind":"phrase_map_candidate","normalisedPhrase":string,"functionId":string,"fixedParams":object|null,"frequency":number}
  {"kind":"report_definition","title":string,"definition":object}
  {"kind":"capability_gap","description":string,"frequency":number}
  {"kind":"no_action","reason":string}`;

export const openrouterProvider: AiProvider = {
  async classify(segments: string[], candidateFunctions: string[], context: ClassifyContext): Promise<ClassificationResult[]> {
    if (segments.length === 0) return [];
    const apiKey = requireApiKey();
    const model = await resolvePipelineModel("pipeline_l1", L1_MODEL_FALLBACK);
    // ONE call for ALL unresolved segments (M27) -- never one call per segment.
    const userMessage = JSON.stringify({ segments, candidateFunctions, context });
    const { data } = await callLLMJson<{ results: ClassificationResult[] }>(
      "openrouter",
      model,
      apiKey,
      CLASSIFY_SYSTEM_PROMPT,
      userMessage,
      { expectedKeys: ["results"], temperature: 0 }
    );
    if (!Array.isArray(data.results) || data.results.length !== segments.length) {
      throw new Error(`L1 returned ${data.results?.length ?? 0} result(s) for ${segments.length} segment(s) -- expected exactly one per segment.`);
    }
    // Shape-normalize only. Real semantic validation (function_id actually in
    // the candidate set, boq_line_item existence, permissions, project
    // reachability) is validate.ts's job (seq12) -- this file never
    // second-guesses the model's own answer beyond making sure it round-trips
    // as the shape the rest of the pipeline expects.
    return data.results.map((r) => ({
      functionId: r.functionId ?? null,
      params: r.params ?? {},
      missingParams: Array.isArray(r.missingParams) ? r.missingParams : [],
      confidence: typeof r.confidence === "number" ? r.confidence : 0,
      unmappedIntent: r.unmappedIntent ?? null,
    }));
  },

  async analyse(batchInput: unknown): Promise<Artifact[]> {
    const apiKey = requireApiKey();
    const model = await resolvePipelineModel("pipeline_l2", L2_MODEL_FALLBACK);
    const { data } = await callLLMJson<{ artifacts: Artifact[] }>(
      "openrouter",
      model,
      apiKey,
      ANALYSE_SYSTEM_PROMPT,
      JSON.stringify(batchInput),
      { expectedKeys: ["artifacts"], temperature: 0 }
    );
    if (!Array.isArray(data.artifacts)) throw new Error("L2 did not return an artifacts array.");
    return data.artifacts;
  },
};
