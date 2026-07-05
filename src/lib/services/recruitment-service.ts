// Wave 62 (Recruitment/ATS, ERP benchmark Tier 3 #14). Candidate resumes
// deliberately get no new file column here -- a resume is just another row
// in the Wave 61 central documents repository with
// linkedEntityType='candidate'/linkedEntityId=candidate.id, proving that
// mechanism generalizes across modules rather than being ERP-only.
// Hiring an application does NOT auto-provision a users/employeeProfiles
// row -- same "no silent auto-provisioning" discipline as Wave 59's SSO --
// an admin explicitly creates the employee profile first and links it via
// hiredEmployeeProfileId.
import { jobOpenings, candidates, jobApplications, interviewFeedback, employeeProfiles } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RecruitmentContext = { orgId: string; userId: string }

export async function listJobOpenings(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.jobOpenings.findMany({ where: eq(jobOpenings.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function createJobOpening(
  ctx: RecruitmentContext,
  input: { title: string; departmentId?: string; jobDescription?: string; employmentType?: string; numPositions?: number }
) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(jobOpenings).values({
      orgId: ctx.orgId, title: input.title, departmentId: input.departmentId || null,
      jobDescription: input.jobDescription || null, employmentType: input.employmentType || "full_time",
      numPositions: input.numPositions ?? 1, postedById: ctx.userId,
    }).returning()
    return created
  })
}

export async function updateJobOpeningStatus(ctx: RecruitmentContext, openingId: string, status: "open" | "on_hold" | "closed" | "filled") {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.jobOpenings.findFirst({ where: and(eq(jobOpenings.id, openingId), eq(jobOpenings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Job opening not found", 404)
    const [updated] = await db.update(jobOpenings)
      .set({ status, closedAt: (status === "closed" || status === "filled") ? new Date() : existing.closedAt })
      .where(eq(jobOpenings.id, openingId)).returning()
    return updated
  })
}

export async function listCandidates(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.candidates.findMany({ where: eq(candidates.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function createCandidate(ctx: RecruitmentContext, input: { name: string; email: string; phone?: string; source?: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.email?.trim()) throw new ServiceError("email is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(candidates).values({
      orgId: ctx.orgId, name: input.name, email: input.email, phone: input.phone || null, source: input.source || null,
    }).returning()
    return created
  })
}

export async function listApplications(ctx: { orgId: string }, filters?: { jobOpeningId?: string; candidateId?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(jobApplications.orgId, ctx.orgId)]
    if (filters?.jobOpeningId) conditions.push(eq(jobApplications.jobOpeningId, filters.jobOpeningId))
    if (filters?.candidateId) conditions.push(eq(jobApplications.candidateId, filters.candidateId))
    return db.query.jobApplications.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function createApplication(ctx: RecruitmentContext, input: { jobOpeningId: string; candidateId: string }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const opening = await db.query.jobOpenings.findFirst({ where: and(eq(jobOpenings.id, input.jobOpeningId), eq(jobOpenings.orgId, ctx.orgId)) })
    if (!opening) throw new ServiceError("Job opening not found", 404)
    const candidate = await db.query.candidates.findFirst({ where: and(eq(candidates.id, input.candidateId), eq(candidates.orgId, ctx.orgId)) })
    if (!candidate) throw new ServiceError("Candidate not found", 404)

    const [created] = await db.insert(jobApplications).values({
      orgId: ctx.orgId, jobOpeningId: input.jobOpeningId, candidateId: input.candidateId,
    }).returning()
    return created
  })
}

const VALID_STAGE_TRANSITIONS: Record<string, string[]> = {
  applied: ["screening", "rejected"],
  screening: ["interview", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["hired", "rejected"],
  hired: [],
  rejected: [],
}

export async function moveApplicationStage(
  ctx: RecruitmentContext,
  applicationId: string,
  toStage: "screening" | "interview" | "offer" | "hired" | "rejected",
  input?: { rejectedReason?: string; offerAmount?: number }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const application = await db.query.jobApplications.findFirst({ where: and(eq(jobApplications.id, applicationId), eq(jobApplications.orgId, ctx.orgId)) })
    if (!application) throw new ServiceError("Application not found", 404)

    const allowed = VALID_STAGE_TRANSITIONS[application.stage] ?? []
    if (!allowed.includes(toStage)) {
      throw new ServiceError(`Cannot move from '${application.stage}' to '${toStage}'`, 400)
    }

    const [updated] = await db.update(jobApplications).set({
      stage: toStage,
      rejectedReason: toStage === "rejected" ? (input?.rejectedReason || null) : application.rejectedReason,
      offerAmount: toStage === "offer" && input?.offerAmount != null ? String(input.offerAmount) : application.offerAmount,
      offerAcceptedAt: toStage === "hired" ? new Date() : application.offerAcceptedAt,
      updatedAt: new Date(),
    }).where(eq(jobApplications.id, applicationId)).returning()
    return updated
  })
}

// Explicit, admin-driven link -- never auto-provisions. The employeeProfiles
// row must already exist (created via the existing HR onboarding flow).
export async function linkHiredEmployee(ctx: RecruitmentContext, applicationId: string, employeeProfileId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const application = await db.query.jobApplications.findFirst({ where: and(eq(jobApplications.id, applicationId), eq(jobApplications.orgId, ctx.orgId)) })
    if (!application) throw new ServiceError("Application not found", 404)
    if (application.stage !== "hired") throw new ServiceError("Application must be in the 'hired' stage first", 400)

    const profile = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, employeeProfileId), eq(employeeProfiles.orgId, ctx.orgId)) })
    if (!profile) throw new ServiceError("Employee profile not found", 404)

    const [updated] = await db.update(jobApplications).set({ hiredEmployeeProfileId: employeeProfileId, updatedAt: new Date() }).where(eq(jobApplications.id, applicationId)).returning()
    return updated
  })
}

export async function listInterviewFeedback(ctx: { orgId: string }, applicationId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.interviewFeedback.findMany({
      where: and(eq(interviewFeedback.orgId, ctx.orgId), eq(interviewFeedback.applicationId, applicationId)),
      orderBy: (t, { asc }) => asc(t.scheduledAt),
    })
  )
}

export async function scheduleInterview(
  ctx: RecruitmentContext,
  input: { applicationId: string; interviewerId: string; roundName: string; scheduledAt: string }
) {
  if (!input.roundName?.trim()) throw new ServiceError("roundName is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const application = await db.query.jobApplications.findFirst({ where: and(eq(jobApplications.id, input.applicationId), eq(jobApplications.orgId, ctx.orgId)) })
    if (!application) throw new ServiceError("Application not found", 404)

    const [created] = await db.insert(interviewFeedback).values({
      orgId: ctx.orgId, applicationId: input.applicationId, interviewerId: input.interviewerId,
      roundName: input.roundName, scheduledAt: new Date(input.scheduledAt),
    }).returning()
    return created
  })
}

export async function submitInterviewFeedback(
  ctx: RecruitmentContext,
  feedbackId: string,
  input: { rating: number; recommendation: "strong_yes" | "yes" | "no" | "strong_no"; feedback?: string }
) {
  if (input.rating < 1 || input.rating > 5) throw new ServiceError("rating must be between 1 and 5", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.interviewFeedback.findFirst({ where: and(eq(interviewFeedback.id, feedbackId), eq(interviewFeedback.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Interview round not found", 404)

    const [updated] = await db.update(interviewFeedback).set({
      rating: input.rating, recommendation: input.recommendation, feedback: input.feedback || null, completedAt: new Date(),
    }).where(eq(interviewFeedback.id, feedbackId)).returning()
    return updated
  })
}
