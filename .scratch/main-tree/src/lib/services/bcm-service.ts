// Wave 89 (Comparison CSV 2 gap analysis: BCM Business Impact Analysis +
// Recovery Plan detail + Exercise log). bcm_plans (src/app/api/bcm/route.ts,
// pre-dating this codebase's service-layer convention) was a bare name/
// last-tested-date/status flag. This service adds the real detail --
// per-process impact/RTO/RPO, a recovery-procedure step list, and an
// exercise/drill history log -- without touching the existing plan
// list/create route.
import { bcmPlans, bcmBusinessImpactAnalyses, bcmRecoveryProcedures, bcmExercises, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type BcmContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function getPlanDetail(ctx: { orgId: string }, planId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.bcmPlans.findFirst({ where: and(eq(bcmPlans.id, planId), eq(bcmPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("BCM plan not found", 404)
    const [businessImpactAnalyses, recoveryProcedures, exercises] = await Promise.all([
      db.query.bcmBusinessImpactAnalyses.findMany({ where: eq(bcmBusinessImpactAnalyses.planId, planId), orderBy: (t, { asc }) => asc(t.createdAt) }),
      db.query.bcmRecoveryProcedures.findMany({ where: eq(bcmRecoveryProcedures.planId, planId), orderBy: (t, { asc }) => asc(t.stepNumber) }),
      db.query.bcmExercises.findMany({ where: eq(bcmExercises.planId, planId), orderBy: (t, { desc }) => desc(t.exerciseDate) }),
    ])
    return { ...plan, businessImpactAnalyses, recoveryProcedures, exercises }
  })
}

export type BiaInput = { businessProcessName: string; impactDescription?: string; rtoHours?: number; rpoHours?: number; criticalityLevel?: string; dependencies?: string }

export async function addBusinessImpactAnalysis(ctx: { orgId: string }, planId: string, input: BiaInput) {
  if (!input.businessProcessName?.trim()) throw new ServiceError("businessProcessName is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.bcmPlans.findFirst({ where: and(eq(bcmPlans.id, planId), eq(bcmPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("BCM plan not found", 404)
    const [bia] = await db.insert(bcmBusinessImpactAnalyses).values({
      planId, businessProcessName: input.businessProcessName, impactDescription: input.impactDescription,
      rtoHours: input.rtoHours !== undefined ? String(input.rtoHours) : undefined,
      rpoHours: input.rpoHours !== undefined ? String(input.rpoHours) : undefined,
      criticalityLevel: input.criticalityLevel ?? "medium", dependencies: input.dependencies,
    }).returning()
    return bia
  })
}

export type RecoveryProcedureInput = { description: string; responsibleUserId?: string; estimatedDurationMinutes?: number }

export async function addRecoveryProcedure(ctx: { orgId: string }, planId: string, input: RecoveryProcedureInput) {
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.bcmPlans.findFirst({ where: and(eq(bcmPlans.id, planId), eq(bcmPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("BCM plan not found", 404)
    const existing = await db.query.bcmRecoveryProcedures.findMany({ where: eq(bcmRecoveryProcedures.planId, planId) })
    const [step] = await db.insert(bcmRecoveryProcedures).values({
      planId, stepNumber: existing.length + 1, description: input.description,
      responsibleUserId: input.responsibleUserId,
      estimatedDurationMinutes: input.estimatedDurationMinutes !== undefined ? String(input.estimatedDurationMinutes) : undefined,
    }).returning()
    return step
  })
}

export type ExerciseInput = { exerciseDate: string; exerciseType: string; outcome: string; findings?: string }

/** Logging an exercise also rolls the plan's own lastTestedDate/status forward -- a real BIA/exercise history is only useful if the plan-level summary reflects it. */
export async function addExercise(ctx: BcmContext, planId: string, input: ExerciseInput) {
  if (!input.exerciseDate) throw new ServiceError("exerciseDate is required", 400)
  if (!input.exerciseType) throw new ServiceError("exerciseType is required", 400)
  if (!input.outcome) throw new ServiceError("outcome is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const plan = await db.query.bcmPlans.findFirst({ where: and(eq(bcmPlans.id, planId), eq(bcmPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("BCM plan not found", 404)

    const [exercise] = await db.insert(bcmExercises).values({
      planId, exerciseDate: input.exerciseDate, exerciseType: input.exerciseType, outcome: input.outcome,
      findings: input.findings, conductedById: ctx.userId,
    }).returning()

    const rolledStatus = input.outcome === "passed" ? "tested_passed" : input.outcome === "failed" ? "tested_failed" : "tested_with_findings"
    await db.update(bcmPlans).set({ lastTestedDate: new Date(input.exerciseDate), status: rolledStatus, updatedAt: new Date() }).where(eq(bcmPlans.id, planId))

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "bcm_plan.exercise_logged", entityType: "bcm_plan", entityId: planId, details: JSON.stringify({ exerciseId: exercise.id, outcome: input.outcome }) })
    return exercise
  })
}
