// Wave 152 (VERIDIAN.docx joint implementation plan, Phase4_Implementation_Plan.md
// -- Wisdom+Innovation Engines slice). This is the narrow, deterministic v1 of
// the "Wisdom Engine" both VERIDIAN.docx studies describe: it surfaces real
// patterns from what has *already happened* in this org's orchestra
// executions, NOT fabricated AI insight. The full multi-domain vision in the
// document is out of scope for this wave -- this file does exactly one thing:
// summarize, deterministically, why gated replies have been happening.
//
// Deterministic by construction: zero LLM calls anywhere in this file. It is a
// pure SQL aggregation + in-memory group-by, mirroring the deterministic-first
// philosophy every other loop/service in this repo follows (see
// loop-improvement-proposer.ts's own header comment: "read-only, no
// autonomous writes"). Nothing here writes anything -- it only reads and
// counts, so a caller can display the summary without any approval gate.
import { orchestraExecutions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

export type WisdomContext = { orgId: string }

export type GatedReplyReasonSummary = { reason: string; count: number }

/**
 * Summarizes the reasons orchestra executions were gated for this org.
 *
 * Reads `orchestra_executions` rows where `status = 'gated'` and groups them
 * by the `reason` field on the jsonb `output` column. A malformed/missing
 * reason falls back to `"unknown"` -- this function never throws on a single
 * bad row, it just buckets it, because the whole point is a faithful summary
 * of real data, not a crash on the first row that doesn't match a shape.
 *
 * Returns `{ reason, count }[]` sorted by count descending.
 */
export async function summarizeGatedReplyReasons(
  ctx: WisdomContext
): Promise<GatedReplyReasonSummary[]> {
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.orchestraExecutions.findMany({
      where: and(
        eq(orchestraExecutions.orgId, ctx.orgId),
        eq(orchestraExecutions.status, "gated")
      ),
      columns: { output: true },
    })
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    // output is jsonb; a malformed row (null, non-object, missing reason)
    // buckets under "unknown" rather than throwing -- see header comment.
    const reason =
      typeof row.output === "object" &&
      row.output !== null &&
      typeof (row.output as Record<string, unknown>).reason === "string"
        ? ((row.output as Record<string, unknown>).reason as string)
        : "unknown"
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
}
