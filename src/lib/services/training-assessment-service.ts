// VERIDIAN Review Framework remediation, Wave B: Training / LMS assessment
// engine (2026-07-17). Split out from training-service.ts by sub-concern
// (quizzes/questions/scoring/retake policy), same convention as
// hr-service.ts / hr-attendance-service.ts. See training-service.ts's own
// header comment for the module-wide design rationale.
import {
  users,
  trainingAssessments, trainingQuestions, trainingAssessmentAttempts,
  trainingEnrollments, trainingCompletions, trainingCourses,
  trainingQuestionTypeEnum,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, desc } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
import { generateCertificateCode } from "./training-service"
export { ServiceError }

export type AssessmentContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }
export type QuestionType = (typeof trainingQuestionTypeEnum.enumValues)[number]

// ─── Pure helpers (no DB access -- unit-testable directly) ─────────────

export type QuestionLike = { id: string; questionType: QuestionType; correctAnswer: unknown; points: number }
export type SubmittedAnswers = Record<string, unknown>

/**
 * True/false and multiple_choice (single or multi-select, order-insensitive)
 * require an exact match; short_answer is matched case-insensitively after
 * trimming whitespace -- forgiving enough for "Yes" vs "yes " without
 * accepting a materially different answer.
 */
export function scoreQuestion(question: QuestionLike, submitted: unknown): boolean {
  if (submitted === undefined || submitted === null) return false
  switch (question.questionType) {
    case "true_false":
      return Boolean(submitted) === Boolean(question.correctAnswer)
    case "short_answer": {
      const expected = String(question.correctAnswer ?? "").trim().toLowerCase()
      const actual = String(submitted ?? "").trim().toLowerCase()
      return expected.length > 0 && expected === actual
    }
    case "multiple_choice":
    default: {
      const expected = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer]
      const actual = Array.isArray(submitted) ? submitted : [submitted]
      if (expected.length !== actual.length) return false
      const expectedSorted = [...expected].map(String).sort()
      const actualSorted = [...actual].map(String).sort()
      return expectedSorted.every((v, i) => v === actualSorted[i])
    }
  }
}

export type ScoreResult = { score: number; maxScore: number; scorePercent: number }

export function scoreAttempt(questions: QuestionLike[], submitted: SubmittedAnswers): ScoreResult {
  let score = 0
  let maxScore = 0
  for (const q of questions) {
    maxScore += q.points
    if (scoreQuestion(q, submitted[q.id])) score += q.points
  }
  const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0
  return { score, maxScore, scorePercent }
}

export function determinePassed(scorePercent: number, thresholdPercent: number): boolean {
  return scorePercent >= thresholdPercent
}

/** Retake policy: null/undefined maxAttempts means unlimited. Throws if the employee has already exhausted their allowance. */
export function assertRetakeAllowed(priorAttemptCount: number, maxAttempts: number | null): void {
  if (maxAttempts != null && priorAttemptCount >= maxAttempts) {
    throw new ServiceError(`Maximum attempts (${maxAttempts}) reached for this assessment`, 400)
  }
}

// ─── Assessments ────────────────────────────────────────────────────────

export async function listAssessments(ctx: { orgId: string }, courseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.trainingAssessments.findMany({ where: and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, ctx.orgId)) })
  )
}

export async function getAssessmentDetail(ctx: { orgId: string }, assessmentId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!assessment) throw new ServiceError("Assessment not found", 404)
    const questions = await db.query.trainingQuestions.findMany({
      where: and(eq(trainingQuestions.assessmentId, assessmentId), eq(trainingQuestions.orgId, ctx.orgId)),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    })
    return { assessment, questions }
  })
}

/** Same shape, but strips correctAnswer -- what an employee taking the quiz is served (never the answer key). */
export async function getAssessmentForTaking(ctx: { orgId: string }, assessmentId: string) {
  const { assessment, questions } = await getAssessmentDetail(ctx, assessmentId)
  return {
    assessment,
    questions: questions.map(({ correctAnswer: _correctAnswer, ...q }) => q),
  }
}

export type CreateAssessmentInput = { courseId: string; moduleId?: string; title: string; description?: string; passingScorePercent?: number; maxAttempts?: number; timeLimitMinutes?: number }

export async function createAssessment(ctx: AssessmentContext, input: CreateAssessmentInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, input.courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const [assessment] = await db.insert(trainingAssessments).values({
      orgId: ctx.orgId, courseId: input.courseId, moduleId: input.moduleId || null, title: input.title,
      description: input.description || null, passingScorePercent: input.passingScorePercent ?? null,
      maxAttempts: input.maxAttempts ?? null, timeLimitMinutes: input.timeLimitMinutes ?? null,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_assessment.created", entityType: "training_assessment", entityId: assessment!.id })
    return assessment
  })
}

export async function updateAssessment(ctx: { orgId: string }, assessmentId: string, input: Partial<Omit<CreateAssessmentInput, "courseId">>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Assessment not found", 404)
    const [updated] = await db.update(trainingAssessments).set({
      title: input.title ?? existing.title,
      description: input.description !== undefined ? input.description : existing.description,
      passingScorePercent: input.passingScorePercent !== undefined ? input.passingScorePercent : existing.passingScorePercent,
      maxAttempts: input.maxAttempts !== undefined ? input.maxAttempts : existing.maxAttempts,
      timeLimitMinutes: input.timeLimitMinutes !== undefined ? input.timeLimitMinutes : existing.timeLimitMinutes,
      updatedAt: new Date(),
    }).where(eq(trainingAssessments.id, assessmentId)).returning()
    return updated
  })
}

export async function deleteAssessment(ctx: { orgId: string }, assessmentId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Assessment not found", 404)
    await db.delete(trainingQuestions).where(and(eq(trainingQuestions.assessmentId, assessmentId), eq(trainingQuestions.orgId, ctx.orgId)))
    await db.delete(trainingAssessments).where(eq(trainingAssessments.id, assessmentId))
    return { success: true }
  })
}

// ─── Questions (question bank) ──────────────────────────────────────────

export type AddQuestionInput = { questionText: string; questionType?: QuestionType; options?: string[]; correctAnswer: unknown; points?: number; sortOrder?: number }

export async function addQuestion(ctx: { orgId: string }, assessmentId: string, input: AddQuestionInput) {
  if (!input.questionText?.trim()) throw new ServiceError("questionText is required", 400)
  if (input.correctAnswer === undefined || input.correctAnswer === null) throw new ServiceError("correctAnswer is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!assessment) throw new ServiceError("Assessment not found", 404)
    const [question] = await db.insert(trainingQuestions).values({
      orgId: ctx.orgId, assessmentId, questionText: input.questionText,
      questionType: input.questionType ?? "multiple_choice", options: input.options ?? [],
      correctAnswer: input.correctAnswer, points: input.points ?? 1, sortOrder: input.sortOrder ?? 0,
    }).returning()
    return question
  })
}

export async function updateQuestion(ctx: { orgId: string }, questionId: string, input: Partial<AddQuestionInput>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingQuestions.findFirst({ where: and(eq(trainingQuestions.id, questionId), eq(trainingQuestions.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Question not found", 404)
    const [updated] = await db.update(trainingQuestions).set({
      questionText: input.questionText ?? existing.questionText,
      questionType: input.questionType ?? existing.questionType,
      options: input.options ?? existing.options,
      correctAnswer: input.correctAnswer !== undefined ? input.correctAnswer : existing.correctAnswer,
      points: input.points ?? existing.points,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      updatedAt: new Date(),
    }).where(eq(trainingQuestions.id, questionId)).returning()
    return updated
  })
}

export async function deleteQuestion(ctx: { orgId: string }, questionId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingQuestions.findFirst({ where: and(eq(trainingQuestions.id, questionId), eq(trainingQuestions.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Question not found", 404)
    await db.delete(trainingQuestions).where(eq(trainingQuestions.id, questionId))
    return { success: true }
  })
}

// ─── Attempts (taking the quiz) ─────────────────────────────────────────

export async function listAttempts(ctx: { orgId: string }, filters: { assessmentId?: string; employeeId?: string; enrollmentId?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(trainingAssessmentAttempts.orgId, ctx.orgId)]
    if (filters.assessmentId) conditions.push(eq(trainingAssessmentAttempts.assessmentId, filters.assessmentId))
    if (filters.employeeId) conditions.push(eq(trainingAssessmentAttempts.employeeId, filters.employeeId))
    if (filters.enrollmentId) conditions.push(eq(trainingAssessmentAttempts.enrollmentId, filters.enrollmentId))
    return db.query.trainingAssessmentAttempts.findMany({ where: and(...conditions), orderBy: (t, { desc: d }) => d(t.submittedAt) })
  })
}

/**
 * Submits and scores one attempt. Enforces the assessment's retake policy
 * (maxAttempts) and requires an existing enrollment in the assessment's
 * course -- an employee must be enrolled before they can be graded, same
 * "enroll first" precondition markLessonProgress's auto-enroll relaxes for
 * lessons but a graded, attempt-numbered quiz should not silently
 * auto-enroll someone into a course they never opted into or were assigned.
 */
export async function submitAttempt(ctx: { orgId: string; userId: string }, assessmentId: string, submittedAnswers: SubmittedAnswers) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!assessment) throw new ServiceError("Assessment not found", 404)

    const enrollment = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.orgId, ctx.orgId), eq(trainingEnrollments.employeeId, ctx.userId), eq(trainingEnrollments.courseId, assessment.courseId)) })
    if (!enrollment) throw new ServiceError("You must be enrolled in this course before taking its assessment", 400)

    const priorAttempts = await db.query.trainingAssessmentAttempts.findMany({ where: and(eq(trainingAssessmentAttempts.assessmentId, assessmentId), eq(trainingAssessmentAttempts.enrollmentId, enrollment.id)) })
    assertRetakeAllowed(priorAttempts.length, assessment.maxAttempts)

    const questions = await db.query.trainingQuestions.findMany({ where: and(eq(trainingQuestions.assessmentId, assessmentId), eq(trainingQuestions.orgId, ctx.orgId)) })
    if (questions.length === 0) throw new ServiceError("This assessment has no questions yet", 400)

    const course = await db.query.trainingCourses.findFirst({ where: eq(trainingCourses.id, assessment.courseId) })
    const threshold = assessment.passingScorePercent ?? course?.passingScorePercent ?? 70

    const { score, maxScore, scorePercent } = scoreAttempt(questions, submittedAnswers)
    const passed = determinePassed(scorePercent, threshold)

    const [attempt] = await db.insert(trainingAssessmentAttempts).values({
      orgId: ctx.orgId, assessmentId, enrollmentId: enrollment.id, employeeId: ctx.userId,
      attemptNumber: priorAttempts.length + 1, submittedAnswers, score: String(score), maxScore: String(maxScore),
      scorePercent: String(scorePercent), passed, passingThresholdApplied: threshold,
    }).returning()

    if (enrollment.status === "not_started") {
      await db.update(trainingEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollment.id))
    }

    if (passed) await maybeCompleteFromAssessment(db, ctx.orgId, enrollment.id, assessment.courseId, attempt!)
    return attempt
  })
}

/**
 * A course "completes via assessment" once every trainingAssessments row
 * attached to it has at least one passing attempt for this enrollment --
 * mirrors training-service.ts's maybeCompleteFromLessons, but gated on
 * assessments instead of lessons (a course with both lessons AND an
 * assessment requires the assessment to pass; lesson-completion alone does
 * not complete it -- see that function's own early-return when an
 * assessment exists).
 */
async function maybeCompleteFromAssessment(db: TenantDb, orgId: string, enrollmentId: string, courseId: string, latestAttempt: typeof trainingAssessmentAttempts.$inferSelect) {
  const existingCompletion = await db.query.trainingCompletions.findFirst({ where: eq(trainingCompletions.enrollmentId, enrollmentId) })
  if (existingCompletion) return

  const courseAssessments = await db.query.trainingAssessments.findMany({ where: and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, orgId)), columns: { id: true } })
  const allAttempts = await db.query.trainingAssessmentAttempts.findMany({ where: and(eq(trainingAssessmentAttempts.enrollmentId, enrollmentId), eq(trainingAssessmentAttempts.orgId, orgId)) })
  const passedAssessmentIds = new Set(allAttempts.filter((a) => a.passed).map((a) => a.assessmentId))
  const allPassed = courseAssessments.every((a) => passedAssessmentIds.has(a.id))
  if (!allPassed) return

  await db.update(trainingEnrollments).set({ status: "completed", updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollmentId))
  await db.insert(trainingCompletions).values({
    orgId, enrollmentId, certificateCode: generateCertificateCode(enrollmentId),
    score: latestAttempt.scorePercent, passed: true, bestAttemptId: latestAttempt.id,
  })
}
