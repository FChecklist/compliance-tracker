// R39/R-C14: Architect/Site Instruction (SI) record -- SCHEMA-ASSUMED-
// INDUSTRY-STANDARD, see schema.ts's own comment on constructionSiteInstructions
// for the full explanation. Same create/list/number-sequencing pattern as
// createRfi/listRfis in construction-field-workflow-service.ts.
import { constructionSiteInstructions, projects } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, count } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type SiteInstructionInput = {
  projectId: string
  issueDate: string
  toContractor: string
  description: string
  drawingRef?: string
  costImpact?: boolean
  timeImpact?: boolean
  boqId?: string
}

async function assertProject(db: TenantDb, orgId: string, projectId: string) {
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
  if (!project) throw new ServiceError("Project not found", 404)
}

export async function createSiteInstruction(ctx: { orgId: string; userId: string }, input: SiteInstructionInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.issueDate) throw new ServiceError("issueDate is required", 400)
  if (!input.toContractor?.trim()) throw new ServiceError("toContractor is required", 400)
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await assertProject(db, ctx.orgId, input.projectId)
    const [{ value: existing }] = await db.select({ value: count() }).from(constructionSiteInstructions)
      .where(and(eq(constructionSiteInstructions.orgId, ctx.orgId), eq(constructionSiteInstructions.projectId, input.projectId)))

    const [row] = await db.insert(constructionSiteInstructions).values({
      orgId: ctx.orgId, projectId: input.projectId, siNumber: existing + 1,
      issueDate: input.issueDate, issuedBy: ctx.userId, toContractor: input.toContractor.trim(),
      description: input.description.trim(), drawingRef: input.drawingRef?.trim() || null,
      costImpact: input.costImpact ?? false, timeImpact: input.timeImpact ?? false,
      boqId: input.boqId ?? null,
    }).returning()
    return row
  })
}

export async function listSiteInstructions(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionSiteInstructions.findMany({
      where: and(eq(constructionSiteInstructions.orgId, ctx.orgId), eq(constructionSiteInstructions.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.siNumber),
    })
  )
}

export async function getSiteInstruction(ctx: { orgId: string }, id: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const row = await db.query.constructionSiteInstructions.findFirst({ where: and(eq(constructionSiteInstructions.id, id), eq(constructionSiteInstructions.orgId, ctx.orgId)) })
    if (!row) throw new ServiceError("Site instruction not found", 404)
    return row
  })
}
