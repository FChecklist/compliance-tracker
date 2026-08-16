// Wave 92 (Comparison CSV 3 gap analysis: GRC009 "Disaster Recovery").
// Deliberately distinct from Wave 89's bcm-service.ts: BCM models generic
// business-PROCESS recovery narrative (impact analysis/procedures/
// exercises); this models IT-SYSTEM-specific recovery -- RTO/RPO per
// system, backup verification history, and failover test history.
import { itDrPlans, itDrBackupVerifications, itDrFailoverTests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ItDrPlanInput = {
  systemName: string
  systemDescription?: string
  criticalityLevel?: string
  rtoHours: number
  rpoHours: number
  backupFrequency?: string
  ownerId?: string
}

export async function listDrPlans(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.itDrPlans.findMany({ where: eq(itDrPlans.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.systemName) })
  )
}

export async function createDrPlan(ctx: { orgId: string }, input: ItDrPlanInput) {
  if (!input.systemName?.trim()) throw new ServiceError("systemName is required", 400)
  if (input.rtoHours === undefined || input.rpoHours === undefined) throw new ServiceError("rtoHours and rpoHours are required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [plan] = await db.insert(itDrPlans).values({
      orgId: ctx.orgId, systemName: input.systemName, systemDescription: input.systemDescription,
      criticalityLevel: input.criticalityLevel ?? "medium", rtoHours: String(input.rtoHours), rpoHours: String(input.rpoHours),
      backupFrequency: input.backupFrequency ?? "daily", ownerId: input.ownerId,
    }).returning()
    return plan
  })
}

export async function getDrPlanDetail(ctx: { orgId: string }, planId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.itDrPlans.findFirst({ where: and(eq(itDrPlans.id, planId), eq(itDrPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("DR plan not found", 404)
    const [backupVerifications, failoverTests] = await Promise.all([
      db.query.itDrBackupVerifications.findMany({ where: eq(itDrBackupVerifications.drPlanId, planId), orderBy: (t, { desc }) => desc(t.verificationDate) }),
      db.query.itDrFailoverTests.findMany({ where: eq(itDrFailoverTests.drPlanId, planId), orderBy: (t, { desc }) => desc(t.testDate) }),
    ])
    return { ...plan, backupVerifications, failoverTests }
  })
}

export type BackupVerificationInput = { verificationDate: string; status?: string; notes?: string }

export async function recordBackupVerification(ctx: { orgId: string; userId: string }, planId: string, input: BackupVerificationInput) {
  if (!input.verificationDate) throw new ServiceError("verificationDate is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.itDrPlans.findFirst({ where: and(eq(itDrPlans.id, planId), eq(itDrPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("DR plan not found", 404)
    const [verification] = await db.insert(itDrBackupVerifications).values({
      drPlanId: planId, verificationDate: input.verificationDate, status: input.status ?? "success", notes: input.notes, verifiedById: ctx.userId,
    }).returning()
    return verification
  })
}

export type FailoverTestInput = { testDate: string; testType?: string; outcome?: string; findings?: string }

export async function recordFailoverTest(ctx: { orgId: string; userId: string }, planId: string, input: FailoverTestInput) {
  if (!input.testDate) throw new ServiceError("testDate is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.itDrPlans.findFirst({ where: and(eq(itDrPlans.id, planId), eq(itDrPlans.orgId, ctx.orgId)) })
    if (!plan) throw new ServiceError("DR plan not found", 404)
    const [test] = await db.insert(itDrFailoverTests).values({
      drPlanId: planId, testDate: input.testDate, testType: input.testType ?? "tabletop", outcome: input.outcome ?? "passed",
      findings: input.findings, conductedById: ctx.userId,
    }).returning()
    return test
  })
}
