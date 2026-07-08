// Wave 115 (PROJEXA foundation) service layer -- Daily Site Diary. One row
// per project per day (unique constraint enforced in
// 0101_wave115_construction_boq_progress_diary.sql). Photos attach via the
// existing documents table (linkedEntityType='site_diary'), not here.
import { constructionSiteDiaries, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type SiteDiaryInput = {
  projectId: string
  diaryDate: string
  weather?: string
  workDone?: string
  visitors?: string
  issues?: string
  instructions?: string
  materialReceived?: string
  labourCount?: number
  remarks?: string
}

export async function listSiteDiaries(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionSiteDiaries.findMany({
      where: and(eq(constructionSiteDiaries.orgId, ctx.orgId), eq(constructionSiteDiaries.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.diaryDate),
    })
  )
}

export async function createSiteDiary(ctx: { orgId: string; userId: string }, input: SiteDiaryInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.diaryDate) throw new ServiceError("diaryDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const existing = await db.query.constructionSiteDiaries.findFirst({
      where: and(eq(constructionSiteDiaries.projectId, input.projectId), eq(constructionSiteDiaries.diaryDate, input.diaryDate)),
    })
    if (existing) throw new ServiceError("A site diary entry already exists for this project and date", 409)

    const [row] = await db.insert(constructionSiteDiaries).values({
      orgId: ctx.orgId, projectId: input.projectId, diaryDate: input.diaryDate,
      weather: input.weather || null, workDone: input.workDone || null, visitors: input.visitors || null,
      issues: input.issues || null, instructions: input.instructions || null, materialReceived: input.materialReceived || null,
      labourCount: input.labourCount ?? null, remarks: input.remarks || null, recordedById: ctx.userId,
    }).returning()
    return row
  })
}
