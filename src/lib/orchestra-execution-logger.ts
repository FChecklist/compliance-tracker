// Wave 23 (AI Observability, Langfuse-inspired) -- generalizes
// api/ai/orchestrate/route.ts's own local logOrchestraExecution() (Wave 4)
// into a shared helper every real LLM call site uses, now populating the
// real model/provider/promptTokens/completionTokens/costUsd columns added
// in Wave 22 instead of stuffing that data into the free-form `output`
// jsonb (the pre-Wave-23 pattern). Fire-and-forget with a caught/logged
// failure, matching the original helper's own posture -- observability
// logging must never block or fail the actual AI operation it's recording.
import { orchestraLayers, orchestraExecutions } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { eq } from "drizzle-orm";
import { estimateCostUsd, type LLMUsage } from "@/lib/llm-client";

export type RecordOrchestraExecutionInput = {
  orgId: string;
  clientId?: string;
  userId?: string;
  taskId?: string;
  layerKey: string;
  eventType: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  // Wave 46 (VERIDIAN AI Constitution + Policy Enforcement Engine): "denied"
  // records a policy-engine refusal -- the request never reached an LLM at
  // all, so promptTokens/completionTokens/costUsd stay null (zero real cost).
  // Phase 3 (software-first gate, Phase3_Design_by_Claude.md): "gated"
  // records a real LLM reply that reached this helper but was blocked by
  // ai-reply-gate.ts before being shown to the user (e.g. a hallucinated
  // claim of completed action) -- distinct from "failed" (the LLM call
  // itself errored) and "denied" (never reached the LLM at all).
  status: "completed" | "failed" | "denied" | "gated";
  durationMs: number;
  provider?: string;
  model?: string;
  usage?: LLMUsage;
};

export function recordOrchestraExecution(params: RecordOrchestraExecutionInput): void {
  withTenantContext({ orgId: params.orgId, userId: params.userId }, async (db) => {
    const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, params.layerKey) });
    if (!layer) return;

    const costUsd = params.model && params.usage ? estimateCostUsd(params.model, params.usage) : null;

    await db.insert(orchestraExecutions).values({
      orchestraLayerId: layer.id,
      orgId: params.orgId,
      clientId: params.clientId ?? null,
      userId: params.userId ?? null,
      taskId: params.taskId ?? null,
      eventType: params.eventType,
      input: params.input,
      output: params.output ?? null,
      status: params.status,
      durationMs: params.durationMs,
      model: params.model ?? null,
      provider: params.provider ?? null,
      promptTokens: params.usage?.promptTokens ?? null,
      completionTokens: params.usage?.completionTokens ?? null,
      costUsd: costUsd !== null ? costUsd.toFixed(6) : null,
    });
  }).catch((err) => console.warn(`orchestra_executions logging failed for layer '${params.layerKey}' (non-fatal):`, err));
}
