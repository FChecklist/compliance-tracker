// Wave 23 (AI Observability, Langfuse-inspired) -- generalizes
// api/ai/orchestrate/route.ts's own local logOrchestraExecution() (Wave 4)
// into a shared helper every real LLM call site uses, now populating the
// real model/provider/promptTokens/completionTokens/costUsd columns added
// in Wave 22 instead of stuffing that data into the free-form `output`
// jsonb (the pre-Wave-23 pattern). Fire-and-forget with a caught/logged
// failure, matching the original helper's own posture -- observability
// logging must never block or fail the actual AI operation it's recording.
import { db, orchestraLayers, orchestraExecutions } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
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
  // AI Architecture / Explainability & Transparency gap-closure
  // (2026-07-18): "Explains Workflow Decisions" -- plain-language reason
  // this call routed to `model`/`provider` (e.g. "escalated off the floor
  // tier: high-impact action detected" or "using org's own configured
  // model"). Optional -- only call sites that actually made a routing
  // decision (as opposed to always using the one model an org has
  // configured) have anything real to say here.
  routingRationale?: string;
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
      routingRationale: params.routingRationale ?? null,
    });
  }).catch((err) => console.warn(`orchestra_executions logging failed for layer '${params.layerKey}' (non-fatal):`, err));
}

// VERIDIAN Review Framework gap-closure (2026-07-18), "Audit Trail" finding
// (VERIDIAN_AI_CONSTITUTION.md #19 / SEC-03): TTL-based purge of the full
// prompt/response text this module persists. Cross-org by nature (a purge
// sweep has no single org to scope to) -- uses the direct `db` import
// (DATABASE_URL, bypasses RLS) rather than withTenantContext, matching
// every existing cross-org loop's own convention (see
// instruction-mismatch-audit.ts). Only `input`/`output` are cleared; every
// other column (status/model/tokens/cost/duration/timestamps) is left
// untouched and permanent, so the audit trail (who/when/what model/what it
// cost) survives purge even after the raw text itself expires.
export const DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS = 90;

export type PurgeExpiredOrchestraPayloadsResult = { purgedCount: number; retentionDays: number };

export async function purgeExpiredOrchestraPayloads(
  retentionDays: number = DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS
): Promise<PurgeExpiredOrchestraPayloadsResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const purged = await db
    .update(orchestraExecutions)
    .set({ input: {}, output: null, payloadPurgedAt: sql`now()` })
    .where(and(isNull(orchestraExecutions.payloadPurgedAt), lt(orchestraExecutions.createdAt, cutoff)))
    .returning({ id: orchestraExecutions.id });
  return { purgedCount: purged.length, retentionDays };
}

/** Read-back helper for the admin/audit surface: has this row's payload already expired? Distinct from "does not exist" -- payloadPurgedAt null + row present means the payload is still live. */
export function hasPayloadExpired(payloadPurgedAt: Date | null): boolean {
  return payloadPurgedAt !== null;
}
