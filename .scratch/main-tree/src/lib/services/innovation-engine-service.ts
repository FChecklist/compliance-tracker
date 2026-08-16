// Wave 152 (VERIDIAN.docx joint implementation plan, Phase4_Implementation_Plan.md
// -- Wisdom+Innovation Engines slice). This is the narrow, deterministic v1 of
// the "Innovation Engine" both VERIDIAN.docx studies describe: it detects real
// recurring patterns in this org's tasks and proposes (does NOT deploy) an
// automation improvement for each, NOT a fabricated AI suggestion. The full
// multi-domain vision in the document is out of scope for this wave -- this
// file does exactly one thing: find task titles that recur 3+ times and record
// a human-gated improvement proposal for each via the shared
// proposeLoopImprovement() helper (Wave 146).
//
// Deterministic by construction: zero LLM calls anywhere in this file. It is a
// pure SQL read + in-memory normalization/counting, then a structured write to
// the loop_improvements audit table through the existing, human-gated helper.
//
// Human-gated by construction: proposeLoopImprovement() always sets
// isDeployed = false and exposes no parameter to override that -- so this
// engine can surface a pattern and propose an improvement, but it can never
// turn that proposal into a live automation rule on its own. That stays a
// manual/future-approval-flow decision, matching every loop's existing
// "read-only, no autonomous writes" posture (see loop-improvement-proposer.ts's
// own header comment for the precedent this follows).
//
// `afterState` is deliberately null: this engine can detect that a title
// recurs, but it cannot safely infer the specific automation_rules
// trigger/action config that should handle it -- guessing one would be
// fabricating data. This matches the exact "afterState: null" precedent
// already used in src/lib/loops/tier-integrity-audit.ts for the same reason
// (a loop that finds something concrete but cannot infer the fix).
import { tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer"

export type InnovationContext = { orgId: string }

export type RecurringTaskPattern = { normalizedTitle: string; occurrences: number }

// A title must recur this many times before it counts as a real pattern rather
// than noise. 3 is the floor named in the wave spec -- below it, a "recurring"
// label would be misleading for what is really just a couple of coincidental
// duplicates.
const MIN_OCCURRENCES = 3

/**
 * Detects task titles that recur 3+ times across this org's tasks and, for
 * each qualifying pattern, records a human-gated loop_improvements proposal
 * suggesting automation (via the shared proposeLoopImprovement() helper).
 *
 * Returns the array of `{ normalizedTitle, occurrences }` patterns found, for
 * the caller to display -- separate from the loopImprovements proposals,
 * which exist purely for the audit trail.
 */
export async function detectRecurringTaskPatterns(
  ctx: InnovationContext
): Promise<RecurringTaskPattern[]> {
  const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.tasks.findMany({
      where: eq(tasks.orgId, ctx.orgId),
      columns: { title: true },
    })
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    const normalized = (row.title ?? "").trim().toLowerCase()
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  const patterns: RecurringTaskPattern[] = []
  for (const [normalizedTitle, occurrences] of counts.entries()) {
    if (occurrences < MIN_OCCURRENCES) continue
    patterns.push({ normalizedTitle, occurrences })
    // Record a human-gated improvement proposal for the audit trail. afterState
    // is null on purpose -- see header comment: this engine detects the
    // pattern but cannot safely infer the automation config to fix it.
    await proposeLoopImprovement({
      loopId: "innovation-engine-recurring-task",
      improvementType: "suggest_automation_for_recurring_task",
      targetType: "task_pattern",
      targetId: null,
      beforeState: { normalizedTitle, occurrences },
      afterState: null,
    })
  }

  // Deterministic ordering for stable output regardless of Map iteration order.
  patterns.sort((a, b) => b.occurrences - a.occurrences || a.normalizedTitle.localeCompare(b.normalizedTitle))
  return patterns
}
