// Wave 127 (PROJEXA foundation) -- predicted completion date for a
// construction activity. Deliberately deterministic (simple average daily
// velocity, no regression/ML model) rather than an LLM call, matching this
// codebase's own stated preference for deterministic compute over AI
// wherever possible (see the GST reconciliation engine's header comment:
// "AI only touches the final review report -- every other table is pure
// deterministic data").
import { constructionActivities, constructionWorkProgressEntries } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type CompletionPrediction = {
  activityId: string
  plannedQuantity: number | null
  quantityDoneSoFar: number
  dailyVelocity: number | null
  predictedCompletionDate: string | null
  reason?: string
}

export async function predictActivityCompletion(ctx: { orgId: string }, activityId: string): Promise<CompletionPrediction> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const activity = await db.query.constructionActivities.findFirst({ where: and(eq(constructionActivities.id, activityId), eq(constructionActivities.orgId, ctx.orgId)) })
    if (!activity) throw new ServiceError("Activity not found", 404)

    const entries = await db.query.constructionWorkProgressEntries.findMany({
      where: eq(constructionWorkProgressEntries.activityId, activityId),
      orderBy: (t, { asc }) => asc(t.entryDate),
    })

    const plannedQuantity = activity.plannedQuantity !== null ? Number(activity.plannedQuantity) : null
    const quantityDoneSoFar = entries.reduce((sum, e) => sum + Number(e.quantityDone), 0)

    if (entries.length < 2) {
      return { activityId, plannedQuantity, quantityDoneSoFar, dailyVelocity: null, predictedCompletionDate: null, reason: "Needs at least 2 logged progress entries to compute a velocity trend" }
    }
    if (plannedQuantity === null) {
      return { activityId, plannedQuantity, quantityDoneSoFar, dailyVelocity: null, predictedCompletionDate: null, reason: "Activity has no plannedQuantity set" }
    }

    const firstDate = new Date(entries[0].entryDate)
    const lastDate = new Date(entries[entries.length - 1].entryDate)
    const daysSpanned = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / 86400000))
    const dailyVelocity = quantityDoneSoFar / daysSpanned

    const remaining = plannedQuantity - quantityDoneSoFar
    if (remaining <= 0) {
      return { activityId, plannedQuantity, quantityDoneSoFar, dailyVelocity, predictedCompletionDate: entries[entries.length - 1].entryDate, reason: "Already at or past planned quantity" }
    }
    if (dailyVelocity <= 0) {
      return { activityId, plannedQuantity, quantityDoneSoFar, dailyVelocity, predictedCompletionDate: null, reason: "No positive progress velocity to project from" }
    }

    const daysRemaining = Math.ceil(remaining / dailyVelocity)
    const predictedDate = new Date(lastDate.getTime() + daysRemaining * 86400000)
    return {
      activityId, plannedQuantity, quantityDoneSoFar, dailyVelocity,
      predictedCompletionDate: predictedDate.toISOString().slice(0, 10),
    }
  })
}
