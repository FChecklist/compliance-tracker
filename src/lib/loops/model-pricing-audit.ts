import { db, orchestraExecutions } from "@/lib/db";
import { and, gte, isNotNull, sql } from "drizzle-orm";

/**
 * AI Architecture / Performance & Cost Efficiency gap-closure (2026-07-18,
 * "AI Cost Optimization" -- "Pricing table is manual, not from a live
 * billing API"). There is no live billing API for any of the providers
 * llm-client.ts's MODEL_PRICING table covers, so this can't diff against a
 * ground truth -- what it CAN do is find the concrete, checkable symptom of
 * that table drifting out of date: a model with real, recent token usage in
 * orchestra_executions whose costUsd column is still null. Per
 * recordOrchestraExecution()'s own logic, costUsd is only ever null when
 * either no usage was recorded (excluded below via the promptTokens filter)
 * or estimateCostUsd() found no MODEL_PRICING row for that model -- so a
 * real, non-empty result here is a genuine cost blind spot, not a guess.
 *
 * Deliberately NOT one of the 15 canonical loop_definitions rows (same
 * reasoning as capability-index-freshness-audit.ts / instruction-mismatch-
 * audit.ts) -- this is pricing-table hygiene, not one of the spec'd
 * platform-improvement loops, so it's piggybacked onto the existing daily
 * /api/internal/loops/run cron rather than adding a new vercel.json entry.
 *
 * Uses the raw `db` client deliberately -- this is a platform-wide sweep
 * across every org's orchestra_executions, not a single tenant's.
 */
const AUDIT_WINDOW_DAYS = 30;

export async function runModelPricingAudit(): Promise<{
  modelsWithUsageChecked: number;
  missingPricingModels: { model: string; provider: string | null; calls: number }[];
}> {
  const cutoff = new Date(Date.now() - AUDIT_WINDOW_DAYS * 86400000);

  const rows = await db
    .select({
      model: orchestraExecutions.model,
      provider: orchestraExecutions.provider,
      calls: sql<number>`count(*)`,
      missingCostCalls: sql<number>`count(*) filter (where ${orchestraExecutions.costUsd} is null)`,
    })
    .from(orchestraExecutions)
    .where(and(
      isNotNull(orchestraExecutions.model),
      isNotNull(orchestraExecutions.promptTokens),
      gte(orchestraExecutions.createdAt, cutoff)
    ))
    .groupBy(orchestraExecutions.model, orchestraExecutions.provider);

  const missingPricingModels = rows
    .filter((row) => row.model && row.missingCostCalls === row.calls)
    .map((row) => ({ model: row.model as string, provider: row.provider, calls: row.calls }));

  if (missingPricingModels.length > 0) {
    console.warn(
      `[model-pricing-audit] ${missingPricingModels.length} model(s) with real usage in the last ${AUDIT_WINDOW_DAYS} days have no MODEL_PRICING entry in llm-client.ts (cost blind spot): ` +
      missingPricingModels.map((m) => `${m.provider ?? "unknown"}/${m.model} (${m.calls} calls)`).join(", ")
    );
  }

  return { modelsWithUsageChecked: rows.length, missingPricingModels };
}
