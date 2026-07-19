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
import { computeClaimConfidenceScore } from "@/lib/claim-verification";

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

// GP-08/GP-09 gap-closure (2026-07-19): runs the Tier-1 claim-verification
// pass over the JSON-serialized output (so it works uniformly across every
// call site's own differently-shaped output object -- reply text, verdict
// text, action arrays, etc. -- without this shared logger needing to know
// each caller's specific field names) and returns the two fields to merge
// into the persisted `output`. Never throws -- a verification failure (e.g.
// an unreadable source tree in this environment) must never break the
// actual AI operation this logger is recording; it degrades to the neutral
// "nothing checked" result instead.
async function computeOutputConfidenceFields(output: Record<string, unknown>): Promise<{ confidenceScore: number; lowConfidenceFlagged: boolean }> {
  try {
    const { confidenceScore, lowConfidenceFlagged } = await computeClaimConfidenceScore(JSON.stringify(output));
    return { confidenceScore, lowConfidenceFlagged };
  } catch (err) {
    console.warn("claim-verification confidence scoring failed (non-fatal):", err);
    return { confidenceScore: 1, lowConfidenceFlagged: false };
  }
}

export function recordOrchestraExecution(params: RecordOrchestraExecutionInput): void {
  withTenantContext({ orgId: params.orgId, userId: params.userId }, async (db) => {
    const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, params.layerKey) });
    if (!layer) return;

    const costUsd = params.model && params.usage ? estimateCostUsd(params.model, params.usage) : null;

    // GP-08/GP-09 gap-closure (2026-07-19): a Tier-1, grep-verifiable
    // fact-check of this AI-generated output's own claims (does the file/
    // function it names actually exist in this repo?) -- see
    // claim-verification.ts's header for why this is distinct from
    // dispatch-confidence-scoring.ts's existing signal-based proxy.
    // Attached into the existing `output` jsonb rather than a new column
    // (no schema/migration change) -- only computed when there's an actual
    // output to check; a "denied"/no-output row has nothing to verify.
    // Never blocks or alters the row's `status` -- low confidence is
    // surfaced via `lowConfidenceFlagged` for review, never auto-blocked.
    const output = params.output
      ? { ...params.output, ...(await computeOutputConfidenceFields(params.output)) }
      : (params.output ?? null);

    await db.insert(orchestraExecutions).values({
      orchestraLayerId: layer.id,
      orgId: params.orgId,
      clientId: params.clientId ?? null,
      userId: params.userId ?? null,
      taskId: params.taskId ?? null,
      eventType: params.eventType,
      input: params.input,
      output,
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
