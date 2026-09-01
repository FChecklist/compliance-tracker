// R53 Phase 6 -- LEVEL 1. The only place in this pipeline that talks to a
// model, and the only place that has to be trusted least.
//
// M26: DeepSeek V4 Flash via OpenRouter, live and in-request.
//   JOB: one sentence -> one function selection with parameters. NOTHING ELSE.
//   MAY NEVER: do arithmetic, invent a function_id, write to the DB, return
//   prose, guess a missing value.
//
// *** SERVER-SIDE KEY ONLY. *** OPENROUTER_API_KEY is read inside
// providers/openrouter.ts, in a module this file only reaches through the
// adapter, and nothing here is importable from a browser bundle: this file
// imports the DB client transitively through db/schema, which cannot be
// bundled for the client. THE BROWSER PREDICTS, THE SERVER DECIDES -- a
// browser-side Level 0 may guess a pill instantly, but Level 1 never leaves
// the server and the server re-runs Level 0 before trusting anything.
//
// *** EVERY MODEL OUTPUT IS RE-VALIDATED IN CODE BEFORE IT BECOMES A
// RESOLUTION. *** A model output that fails validation is a FAIL, not a
// lower-confidence suggestion. That is what makes this pipeline
// deterministic despite containing a model.
import { and, eq, desc } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { constructionBoqLineItems, constructionBoqs } from "@/lib/db/schema";
import { getAiProvider, assertAiProviderAllowed } from "@/lib/ai/adapter";
import type { ResolvedFunction } from "./classify";

/** M26's acceptance floor. A resolution below this is a FAIL, not a maybe. */
export const MIN_CONFIDENCE = 0.8;

/**
 * The bound context M26 requires: "Pass the module's 5-15 candidate
 * functions and the valid line-item ids -- NEVER the full catalogue. That is
 * where it hallucinates."
 */
export type Level1Context = {
  orgId: string;
  userId: string;
  projectId: string | null;
  candidateFunctionIds: readonly string[];
};

export type Level1Outcome = {
  resolutions: (ResolvedFunction | null)[];
  /** honest per-segment reason when the resolution is null, for gap_log. */
  reasons: (string | null)[];
  /** how many model calls were actually made. ONE for any number of segments, ZERO for none. */
  modelCalls: number;
};

/**
 * The valid ids for THIS request -- the line-item codes of this project's
 * latest BOQ. Bounded by construction: a model that is only ever shown the
 * ids that exist cannot select one that does not, and validate() re-checks
 * the answer against the same set afterwards anyway.
 *
 * Capped. A BOQ with thousands of lines would otherwise put the entire
 * schedule of rates in a prompt, which is both the expensive failure and the
 * hallucination-prone one M26 warns about.
 */
const MAX_IDS_IN_PROMPT = 200;

export async function loadValidItemCodes(orgId: string, projectId: string | null): Promise<string[]> {
  if (!projectId) return [];
  return withTenantContext({ orgId }, async (db) => {
    // Deterministic BOQ choice -- version DESC then createdAt DESC, the same
    // tiebreaker executor.ts uses, so the ids offered to the model are the
    // ids the executor will look in.
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId)),
      orderBy: [desc(constructionBoqs.version), desc(constructionBoqs.createdAt)],
    });
    if (!boq) return [];
    const rows = await db.query.constructionBoqLineItems.findMany({
      where: eq(constructionBoqLineItems.boqId, boq.id),
      columns: { itemCode: true },
      limit: MAX_IDS_IN_PROMPT,
    });
    return rows.map((r) => r.itemCode).filter((c): c is string => typeof c === "string" && c.length > 0);
  });
}

/**
 * ONE batched call for every unresolved segment (M27: "3 segments cost the
 * same as 1 and are 3x faster than 3 calls"). Level 0 hits never reach here.
 *
 * Returns a null resolution, with an honest reason, wherever the model
 * produced nothing this code is willing to act on. It NEVER throws for a bad
 * model answer -- a bad answer is a fail, and a fail is data.
 */
export async function runLevel1(texts: string[], ctx: Level1Context): Promise<Level1Outcome> {
  if (texts.length === 0) return { resolutions: [], reasons: [], modelCalls: 0 };

  // Refuses closed. Anthropic's Claude Code policy permits OAuth/subscription
  // auth for ordinary individual use only, never to serve another person's
  // request -- so a misconfigured provider must fail, not quietly serve.
  assertAiProviderAllowed(ctx.userId);

  const validItemCodes = await loadValidItemCodes(ctx.orgId, ctx.projectId);

  let raw: Awaited<ReturnType<ReturnType<typeof getAiProvider>["classify"]>>;
  try {
    raw = await getAiProvider().classify(texts, [...ctx.candidateFunctionIds], {
      orgId: ctx.orgId,
      projectId: ctx.projectId ?? undefined,
      validIds: validItemCodes.length > 0 ? { itemCode: validItemCodes } : undefined,
    });
  } catch (error) {
    // A provider outage is a FAIL for every segment in the batch, with the
    // real reason recorded -- never a silent drop, and never a retry storm.
    const reason = `Level 1 unavailable: ${error instanceof Error ? error.message : "unknown provider error"}`;
    return { resolutions: texts.map(() => null), reasons: texts.map(() => reason), modelCalls: 1 };
  }

  const resolutions: (ResolvedFunction | null)[] = [];
  const reasons: (string | null)[] = [];

  texts.forEach((_text, i) => {
    const r = raw[i];
    if (!r) {
      resolutions.push(null);
      reasons.push("Level 1 returned no result for this segment");
      return;
    }
    if (r.functionId === null) {
      resolutions.push(null);
      reasons.push(r.unmappedIntent ? `Level 1 could not map this: ${r.unmappedIntent}` : "Level 1 could not map this to any known function");
      return;
    }
    // ---- RE-VALIDATION IN CODE. Each check is its own honest reason. ----
    if (!ctx.candidateFunctionIds.includes(r.functionId)) {
      resolutions.push(null);
      reasons.push(`Level 1 returned function_id "${r.functionId}", which is not in this module's candidate set`);
      return;
    }
    if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence < MIN_CONFIDENCE) {
      resolutions.push(null);
      reasons.push(`Level 1 confidence ${String(r.confidence)} is below the ${MIN_CONFIDENCE} floor`);
      return;
    }
    const params = (r.params ?? {}) as Record<string, unknown>;
    // An id the model invented is rejected HERE, before validate() ever sees
    // it, because the set it was given is the set it must choose from.
    const itemCode = params.itemCode;
    if (typeof itemCode === "string" && validItemCodes.length > 0 && !validItemCodes.includes(itemCode)) {
      resolutions.push(null);
      reasons.push(`Level 1 returned item code "${itemCode}", which does not exist in this project's BOQ`);
      return;
    }
    resolutions.push({
      functionId: r.functionId,
      params,
      missingParams: Array.isArray(r.missingParams) ? r.missingParams : [],
      source: "level1",
      level: 1,
    });
    reasons.push(null);
  });

  return { resolutions, reasons, modelCalls: 1 };
}
