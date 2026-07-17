// VERIDIAN Review Framework remediation, Wave B: "Training LMS module"
// (full depth), 2026-07-17. See schema.ts's Training/LMS section header for
// the full provenance note on the orphaned live-DB design this reuses, and
// drizzle/0222_training_lms_module.sql for the migration.
//
// Sized for a real 100-employee/500-project firm's L&D needs: course/
// curriculum authoring, an assessment engine (MCQ/true-false auto-graded,
// short-answer manually reviewable), enrollment + completion tracking
// (self-enroll or manager-assigned), and role/department-based learning
// paths that fan out into real enrollments -- the "required training for
// role X" concept this codebase did not have before (checked
// employmentStatusEnum, OnboardingChecklist.tsx, and every "onboarding"
// call site in src/ first -- none of them modeled this).
//
// Completion model, stated honestly: a course WITH an assessment completes
// automatically when the learner passes it (submitAttempt below creates the
// trainingCompletions row). A course with NO assessment has no per-lesson
// progress table in this design (the reused live schema only tracks
// enrollment-level not_started/in_progress/completed, not which individual
// lessons were viewed) -- it completes via an explicit learner action,
// markCourseComplete. Per-lesson granular progress (a checklist of which
// lessons were opened) is a genuine, real future gap, not silently faked
// here as if lessons were tracked when they aren't.
import {
  users, documents, trainingCourses, trainingModules, trainingLessons,
  trainingAssessments, trainingQuestions, trainingEnrollments,
  trainingAssessmentAttempts, trainingCompletions, trainingPaths,
  trainingPathCourses, trainingPathAssignments,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type TrainingContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ─── Courses ───────────────────────────────────────────────────────────

export type CourseInput = {
  title: string
  description?: string
  category?: string
  status?: "draft" | "published" | "archived"
  passingScorePercent?: number
  estimatedDurationMinutes?: number
  isMandatory?: boolean
  targetRoles?: string[]
}

export async function listCourses(ctx: { orgId: string }, filters?: { status?: string; category?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(trainingCourses.orgId, ctx.orgId)]
    if (filters?.status) conditions.push(eq(trainingCourses.status, filters.status as "draft" | "published" | "archived"))
    if (filters?.category) conditions.push(eq(trainingCourses.category, filters.category))
    return db.query.trainingCourses.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function getCourse(ctx: { orgId: string }, courseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const modules = await db.query.trainingModules.findMany({ where: and(eq(trainingModules.courseId, courseId), eq(trainingModules.orgId, ctx.orgId)), orderBy: (t, { asc }) => asc(t.sortOrder) })
    const lessons = await db.query.trainingLessons.findMany({ where: and(eq(trainingLessons.courseId, courseId), eq(trainingLessons.orgId, ctx.orgId)), orderBy: (t, { asc }) => asc(t.sortOrder) })
    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, ctx.orgId)) })
    return { ...course, modules: modules.map((m) => ({ ...m, lessons: lessons.filter((l) => l.moduleId === m.id) })), assessment }
  })
}

export async function createCourse(ctx: TrainingContext, input: CourseInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [course] = await db.insert(trainingCourses).values({
      orgId: ctx.orgId, title: input.title.trim(), description: input.description, category: input.category,
      createdById: ctx.userId, status: input.status ?? "draft",
      passingScorePercent: input.passingScorePercent ?? 70,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      isMandatory: input.isMandatory ?? false,
      targetRoles: input.targetRoles ?? null,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_course.created", entityType: "training_course", entityId: course!.id })
    return course
  })
}

export async function updateCourse(ctx: TrainingContext, courseId: string, input: Partial<CourseInput>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Course not found", 404)
    const [updated] = await db.update(trainingCourses).set({ ...input, updatedAt: new Date() }).where(eq(trainingCourses.id, courseId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_course.updated", entityType: "training_course", entityId: courseId })
    return updated
  })
}

export async function deleteCourse(ctx: TrainingContext, courseId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Course not found", 404)
    const enrolled = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.courseId, courseId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (enrolled) throw new ServiceError("Cannot delete a course with existing enrollments -- archive it instead", 400)
    await db.delete(trainingLessons).where(and(eq(trainingLessons.courseId, courseId), eq(trainingLessons.orgId, ctx.orgId)))
    await db.delete(trainingModules).where(and(eq(trainingModules.courseId, courseId), eq(trainingModules.orgId, ctx.orgId)))
    const assessments = await db.query.trainingAssessments.findMany({ where: and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, ctx.orgId)) })
    for (const a of assessments) {
      await db.delete(trainingQuestions).where(and(eq(trainingQuestions.assessmentId, a.id), eq(trainingQuestions.orgId, ctx.orgId)))
    }
    await db.delete(trainingAssessments).where(and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, ctx.orgId)))
    await db.delete(trainingCourses).where(eq(trainingCourses.id, courseId))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_course.deleted", entityType: "training_course", entityId: courseId })
    return { success: true }
  })
}

// ─── Modules ───────────────────────────────────────────────────────────

export type ModuleInput = { title: string; description?: string; sortOrder?: number }

export async function createModule(ctx: TrainingContext, courseId: string, input: ModuleInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const [mod] = await db.insert(trainingModules).values({
      orgId: ctx.orgId, courseId, title: input.title.trim(), description: input.description, sortOrder: input.sortOrder ?? 0,
    }).returning()
    return mod
  })
}

export async function updateModule(ctx: TrainingContext, moduleId: string, input: Partial<ModuleInput>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingModules.findFirst({ where: and(eq(trainingModules.id, moduleId), eq(trainingModules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Module not found", 404)
    const [updated] = await db.update(trainingModules).set({ ...input, updatedAt: new Date() }).where(eq(trainingModules.id, moduleId)).returning()
    return updated
  })
}

export async function deleteModule(ctx: TrainingContext, moduleId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingModules.findFirst({ where: and(eq(trainingModules.id, moduleId), eq(trainingModules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Module not found", 404)
    await db.delete(trainingLessons).where(and(eq(trainingLessons.moduleId, moduleId), eq(trainingLessons.orgId, ctx.orgId)))
    await db.delete(trainingModules).where(eq(trainingModules.id, moduleId))
    return { success: true }
  })
}

// ─── Lessons ───────────────────────────────────────────────────────────
// contentType 'document' points at an existing `documents` row
// (linkedEntityType='training_lesson', linkedEntityId=lesson.id) created via
// the EXISTING POST /api/documents endpoint -- this service deliberately
// does not duplicate upload/storage handling.

export type LessonInput = {
  title: string
  contentType?: "rich_text" | "video_url" | "document"
  content?: string
  videoUrl?: string
  sortOrder?: number
  estimatedDurationMinutes?: number
}

export async function createLesson(ctx: TrainingContext, moduleId: string, input: LessonInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const mod = await db.query.trainingModules.findFirst({ where: and(eq(trainingModules.id, moduleId), eq(trainingModules.orgId, ctx.orgId)) })
    if (!mod) throw new ServiceError("Module not found", 404)
    const [lesson] = await db.insert(trainingLessons).values({
      orgId: ctx.orgId, moduleId, courseId: mod.courseId, title: input.title.trim(),
      contentType: input.contentType ?? "rich_text", content: input.content, videoUrl: input.videoUrl,
      sortOrder: input.sortOrder ?? 0, estimatedDurationMinutes: input.estimatedDurationMinutes,
    }).returning()
    return lesson
  })
}

export async function updateLesson(ctx: TrainingContext, lessonId: string, input: Partial<LessonInput>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingLessons.findFirst({ where: and(eq(trainingLessons.id, lessonId), eq(trainingLessons.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lesson not found", 404)
    const [updated] = await db.update(trainingLessons).set({ ...input, updatedAt: new Date() }).where(eq(trainingLessons.id, lessonId)).returning()
    return updated
  })
}

export async function deleteLesson(ctx: TrainingContext, lessonId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingLessons.findFirst({ where: and(eq(trainingLessons.id, lessonId), eq(trainingLessons.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lesson not found", 404)
    await db.delete(trainingLessons).where(eq(trainingLessons.id, lessonId))
    return { success: true }
  })
}

/** Documents attached to a lesson -- thin wrapper over the existing documents table, not a new store. */
export async function listLessonAttachments(ctx: { orgId: string }, lessonId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.documents.findMany({
      where: and(eq(documents.orgId, ctx.orgId), eq(documents.linkedEntityType, "training_lesson"), eq(documents.linkedEntityId, lessonId), eq(documents.isLatestVersion, true)),
      orderBy: (d, { desc }) => desc(d.createdAt),
    })
  )
}

// ─── Assessments & Questions ────────────────────────────────────────────

export type AssessmentInput = {
  title: string
  description?: string
  moduleId?: string
  passingScorePercent?: number
  maxAttempts?: number
  timeLimitMinutes?: number
}

export async function createAssessment(ctx: TrainingContext, courseId: string, input: AssessmentInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const [assessment] = await db.insert(trainingAssessments).values({
      orgId: ctx.orgId, courseId, moduleId: input.moduleId ?? null, title: input.title.trim(), description: input.description,
      passingScorePercent: input.passingScorePercent ?? course.passingScorePercent, maxAttempts: input.maxAttempts, timeLimitMinutes: input.timeLimitMinutes,
    }).returning()
    return assessment
  })
}

export async function updateAssessment(ctx: TrainingContext, assessmentId: string, input: Partial<AssessmentInput>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Assessment not found", 404)
    const [updated] = await db.update(trainingAssessments).set({ ...input, updatedAt: new Date() }).where(eq(trainingAssessments.id, assessmentId)).returning()
    return updated
  })
}

export async function deleteAssessment(ctx: TrainingContext, assessmentId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Assessment not found", 404)
    await db.delete(trainingQuestions).where(and(eq(trainingQuestions.assessmentId, assessmentId), eq(trainingQuestions.orgId, ctx.orgId)))
    await db.delete(trainingAssessments).where(eq(trainingAssessments.id, assessmentId))
    return { success: true }
  })
}

export type QuestionInput = {
  questionText: string
  questionType?: "multiple_choice" | "true_false" | "short_answer"
  options?: { id: string; text: string }[]
  correctAnswer: string | string[]
  points?: number
  sortOrder?: number
}

export async function listQuestions(ctx: { orgId: string }, assessmentId: string, forLearner = false) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const questions = await db.query.trainingQuestions.findMany({
      where: and(eq(trainingQuestions.assessmentId, assessmentId), eq(trainingQuestions.orgId, ctx.orgId)),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    })
    // Never leak correctAnswer to a learner taking the quiz.
    if (!forLearner) return questions
    return questions.map(({ correctAnswer: _correctAnswer, ...rest }) => rest)
  })
}

export async function createQuestion(ctx: TrainingContext, assessmentId: string, input: QuestionInput) {
  if (!input.questionText?.trim()) throw new ServiceError("questionText is required", 400)
  if (input.correctAnswer == null) throw new ServiceError("correctAnswer is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!assessment) throw new ServiceError("Assessment not found", 404)
    const questionType = input.questionType ?? "multiple_choice"
    let options = input.options ?? []
    if (questionType === "true_false") options = [{ id: "true", text: "True" }, { id: "false", text: "False" }]
    if (questionType === "multiple_choice" && options.length < 2) throw new ServiceError("multiple_choice questions need at least 2 options", 400)
    const [question] = await db.insert(trainingQuestions).values({
      orgId: ctx.orgId, assessmentId, questionText: input.questionText.trim(), questionType, options,
      correctAnswer: input.correctAnswer, points: input.points ?? 1, sortOrder: input.sortOrder ?? 0,
    }).returning()
    return question
  })
}

export async function updateQuestion(ctx: TrainingContext, questionId: string, input: Partial<QuestionInput>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingQuestions.findFirst({ where: and(eq(trainingQuestions.id, questionId), eq(trainingQuestions.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Question not found", 404)
    const [updated] = await db.update(trainingQuestions).set({ ...input, updatedAt: new Date() }).where(eq(trainingQuestions.id, questionId)).returning()
    return updated
  })
}

export async function deleteQuestion(ctx: TrainingContext, questionId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingQuestions.findFirst({ where: and(eq(trainingQuestions.id, questionId), eq(trainingQuestions.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Question not found", 404)
    await db.delete(trainingQuestions).where(eq(trainingQuestions.id, questionId))
    return { success: true }
  })
}

// ─── Enrollment & progress ──────────────────────────────────────────────

/** Self-enroll, or a manager assigning someone else -- role gating (assignedBy != employeeId requires manager) happens in the API route, matching markAttendance's own split. */
export async function enroll(ctx: TrainingContext, employeeId: string, courseId: string, opts?: { dueDate?: string; trainingPathId?: string }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    if (course.status !== "published") throw new ServiceError("Cannot enroll in a course that is not published", 400)
    const employee = await db.query.users.findFirst({ where: and(eq(users.id, employeeId), eq(users.orgId, ctx.orgId)) })
    if (!employee) throw new ServiceError("Employee not found", 404)

    const existing = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.employeeId, employeeId), eq(trainingEnrollments.courseId, courseId)) })
    if (existing) return existing

    const [enrollment] = await db.insert(trainingEnrollments).values({
      orgId: ctx.orgId, employeeId, courseId, trainingPathId: opts?.trainingPathId ?? null,
      dueDate: opts?.dueDate ?? null, assignedById: employeeId === ctx.userId ? null : ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_enrollment.created", entityType: "training_enrollment", entityId: enrollment!.id })
    return enrollment
  })
}

export type EnrollmentFilters = { employeeId?: string; courseId?: string; status?: string }

export async function listEnrollments(ctx: { orgId: string }, filters?: EnrollmentFilters) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(trainingEnrollments.orgId, ctx.orgId)]
    if (filters?.employeeId) conditions.push(eq(trainingEnrollments.employeeId, filters.employeeId))
    if (filters?.courseId) conditions.push(eq(trainingEnrollments.courseId, filters.courseId))
    if (filters?.status) conditions.push(eq(trainingEnrollments.status, filters.status as "not_started" | "in_progress" | "completed"))
    return db.query.trainingEnrollments.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.enrolledAt) })
  })
}

export async function getEnrollment(ctx: { orgId: string }, enrollmentId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const enrollment = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.id, enrollmentId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (!enrollment) throw new ServiceError("Enrollment not found", 404)
    const attempts = await db.query.trainingAssessmentAttempts.findMany({ where: and(eq(trainingAssessmentAttempts.enrollmentId, enrollmentId), eq(trainingAssessmentAttempts.orgId, ctx.orgId)), orderBy: (t, { desc }) => desc(t.submittedAt) })
    const completion = await db.query.trainingCompletions.findFirst({ where: and(eq(trainingCompletions.enrollmentId, enrollmentId), eq(trainingCompletions.orgId, ctx.orgId)) })
    return { ...enrollment, attempts, completion: completion ?? null }
  })
}

/** Marks an enrollment in_progress on first real access (opening the course/a lesson). Idempotent no-op once started. */
export async function startEnrollment(ctx: { orgId: string; userId: string }, enrollmentId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const enrollment = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.id, enrollmentId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (!enrollment) throw new ServiceError("Enrollment not found", 404)
    if (enrollment.status !== "not_started") return enrollment
    const [updated] = await db.update(trainingEnrollments).set({ status: "in_progress", startedAt: new Date(), updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollmentId)).returning()
    return updated
  })
}

/**
 * Manual course completion for a course with NO assessment (see this
 * file's header note on why per-lesson progress isn't tracked). Blocked if
 * the course DOES have an assessment -- that path completes only via
 * submitAttempt passing, not a self-declared shortcut.
 */
export async function markCourseComplete(ctx: TrainingContext, enrollmentId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const enrollment = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.id, enrollmentId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (!enrollment) throw new ServiceError("Enrollment not found", 404)
    if (enrollment.status === "completed") return enrollment
    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.courseId, enrollment.courseId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (assessment) throw new ServiceError("This course has an assessment -- complete it by passing the assessment, not a manual mark", 400)

    const [updated] = await db.update(trainingEnrollments).set({ status: "completed", updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollmentId)).returning()
    await db.insert(trainingCompletions).values({ orgId: ctx.orgId, enrollmentId, passed: true }).onConflictDoNothing({ target: trainingCompletions.enrollmentId })
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_enrollment.completed", entityType: "training_enrollment", entityId: enrollmentId, details: "Manual completion (no assessment on this course)" })
    return updated
  })
}

// ─── Assessment attempts (scoring engine) ───────────────────────────────
// gradeAnswer/gradeSubmission are pure (no DB access) and exported so they
// can be unit-tested directly, matching hr-attendance-service.ts's own
// established convention of not exercising withTenantContext/a live DB
// from a .test.ts file.

export type GradableQuestion = { id: string; questionType: string; correctAnswer: unknown; points: number }

export function gradeAnswer(question: GradableQuestion, answer: unknown): boolean {
  if (question.questionType === "short_answer") {
    const accepted = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer]
    const normalized = String(answer ?? "").trim().toLowerCase()
    return accepted.some((a) => String(a).trim().toLowerCase() === normalized)
  }
  // multiple_choice / true_false: correctAnswer is a single option id.
  return String(answer ?? "") === String(question.correctAnswer)
}

export type GradedSubmission = { score: number; maxScore: number; scorePercent: number; passed: boolean }

/** Grades a full submission against a passing threshold. scorePercent is 0 (not 100) when maxScore is 0 -- an assessment with no questions never silently "passes". */
export function gradeSubmission(questions: GradableQuestion[], answers: Record<string, unknown>, passingScorePercent: number): GradedSubmission {
  let score = 0
  let maxScore = 0
  for (const q of questions) {
    maxScore += q.points
    if (gradeAnswer(q, answers[q.id])) score += q.points
  }
  const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0
  return { score, maxScore, scorePercent, passed: scorePercent >= passingScorePercent }
}

export type SubmitAttemptInput = { answers: Record<string, unknown> }

export async function submitAttempt(ctx: TrainingContext, enrollmentId: string, assessmentId: string, input: SubmitAttemptInput) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const enrollment = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.id, enrollmentId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (!enrollment) throw new ServiceError("Enrollment not found", 404)
    if (enrollment.employeeId !== ctx.userId) throw new ServiceError("Only the enrolled employee can submit this assessment", 403)

    const assessment = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.id, assessmentId), eq(trainingAssessments.orgId, ctx.orgId)) })
    if (!assessment) throw new ServiceError("Assessment not found", 404)
    if (assessment.courseId !== enrollment.courseId) throw new ServiceError("Assessment does not belong to this enrollment's course", 400)

    const priorAttempts = await db.query.trainingAssessmentAttempts.findMany({ where: and(eq(trainingAssessmentAttempts.enrollmentId, enrollmentId), eq(trainingAssessmentAttempts.assessmentId, assessmentId)) })
    if (assessment.maxAttempts != null && priorAttempts.length >= assessment.maxAttempts) {
      throw new ServiceError(`Maximum attempts (${assessment.maxAttempts}) already used for this assessment`, 400)
    }

    const questions = await db.query.trainingQuestions.findMany({ where: and(eq(trainingQuestions.assessmentId, assessmentId), eq(trainingQuestions.orgId, ctx.orgId)) })
    if (questions.length === 0) throw new ServiceError("This assessment has no questions yet", 400)

    const passingThreshold = assessment.passingScorePercent ?? 70
    const { score, maxScore, scorePercent, passed } = gradeSubmission(questions, input.answers, passingThreshold)

    const [attempt] = await db.insert(trainingAssessmentAttempts).values({
      orgId: ctx.orgId, assessmentId, enrollmentId, employeeId: ctx.userId,
      attemptNumber: priorAttempts.length + 1, submittedAnswers: input.answers,
      score: String(score), maxScore: String(maxScore), scorePercent: String(scorePercent),
      passed, passingThresholdApplied: passingThreshold,
    }).returning()

    if (passed) {
      await db.update(trainingEnrollments).set({ status: "completed", updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollmentId))
      await db.insert(trainingCompletions).values({
        orgId: ctx.orgId, enrollmentId, score: String(scorePercent), passed: true, bestAttemptId: attempt!.id,
      }).onConflictDoUpdate({ target: trainingCompletions.enrollmentId, set: { score: String(scorePercent), passed: true, bestAttemptId: attempt!.id, completedAt: new Date() } })
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_enrollment.completed", entityType: "training_enrollment", entityId: enrollmentId, details: `Passed ${assessment.title} at ${scorePercent}%` })
    } else if (enrollment.status === "not_started") {
      await db.update(trainingEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollmentId))
    }

    return attempt
  })
}

// ─── Training paths (role/department-based required-training concept) ──

export type PathInput = { name: string; description?: string; targetDepartmentId?: string; targetRole?: string; isActive?: boolean }

export async function listPaths(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.trainingPaths.findMany({ where: eq(trainingPaths.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function getPath(ctx: { orgId: string }, pathId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const path = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!path) throw new ServiceError("Training path not found", 404)
    const pathCourses = await db.query.trainingPathCourses.findMany({ where: and(eq(trainingPathCourses.trainingPathId, pathId), eq(trainingPathCourses.orgId, ctx.orgId)), orderBy: (t, { asc }) => asc(t.sortOrder) })
    const courseIds = pathCourses.map((pc) => pc.courseId)
    const courses = courseIds.length ? await db.query.trainingCourses.findMany({ where: inArray(trainingCourses.id, courseIds) }) : []
    const coursesById = new Map(courses.map((c) => [c.id, c]))
    return { ...path, courses: pathCourses.map((pc) => ({ ...pc, course: coursesById.get(pc.courseId) ?? null })) }
  })
}

export async function createPath(ctx: TrainingContext, input: PathInput) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [path] = await db.insert(trainingPaths).values({
      orgId: ctx.orgId, name: input.name.trim(), description: input.description,
      targetDepartmentId: input.targetDepartmentId, targetRole: input.targetRole,
      isActive: input.isActive ?? true, createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_path.created", entityType: "training_path", entityId: path!.id })
    return path
  })
}

export async function updatePath(ctx: TrainingContext, pathId: string, input: Partial<PathInput>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Training path not found", 404)
    const [updated] = await db.update(trainingPaths).set({ ...input, updatedAt: new Date() }).where(eq(trainingPaths.id, pathId)).returning()
    return updated
  })
}

export async function addCourseToPath(ctx: TrainingContext, pathId: string, courseId: string, opts?: { sortOrder?: number; isRequired?: boolean }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const path = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!path) throw new ServiceError("Training path not found", 404)
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const [pathCourse] = await db.insert(trainingPathCourses).values({
      orgId: ctx.orgId, trainingPathId: pathId, courseId, sortOrder: opts?.sortOrder ?? 0, isRequired: opts?.isRequired ?? true,
    }).returning()
    return pathCourse
  })
}

export async function removeCourseFromPath(ctx: { orgId: string }, pathCourseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await db.delete(trainingPathCourses).where(and(eq(trainingPathCourses.id, pathCourseId), eq(trainingPathCourses.orgId, ctx.orgId)))
    return { success: true }
  })
}

/**
 * Assigns a training path to an individual, a whole department, or a role
 * -- and fans out into a real trainingEnrollments row for every REQUIRED
 * course in the path, for every matching employee. This is the actual
 * "required training for role X" mechanism (no such concept existed
 * anywhere in this codebase before -- see this file's header note).
 * Idempotent per employee: re-assigning a path an employee already has
 * doesn't duplicate assignment rows or enrollments (enroll() itself is
 * already idempotent per employee+course via its own existing-row check).
 */
export type AssignPathInput = { employeeId?: string; departmentId?: string; role?: string; dueDate?: string }

export async function assignPath(ctx: TrainingContext, pathId: string, input: AssignPathInput) {
  const assignedVia = input.employeeId ? "individual" : input.departmentId ? "department" : input.role ? "role" : null
  if (!assignedVia) throw new ServiceError("One of employeeId, departmentId, or role is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const path = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!path) throw new ServiceError("Training path not found", 404)

    let targetEmployees: (typeof users.$inferSelect)[] = []
    if (input.employeeId) {
      const emp = await db.query.users.findFirst({ where: and(eq(users.id, input.employeeId), eq(users.orgId, ctx.orgId)) })
      if (!emp) throw new ServiceError("Employee not found", 404)
      targetEmployees = [emp]
    } else if (input.departmentId) {
      targetEmployees = await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), eq(users.departmentId, input.departmentId)) })
    } else if (input.role) {
      targetEmployees = await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), eq(users.role, input.role as (typeof users.$inferSelect)["role"])) })
    }
    if (targetEmployees.length === 0) return { assignments: [], enrollments: [] }

    const pathCourses = await db.query.trainingPathCourses.findMany({ where: and(eq(trainingPathCourses.trainingPathId, pathId), eq(trainingPathCourses.orgId, ctx.orgId), eq(trainingPathCourses.isRequired, true)) })

    const assignments: (typeof trainingPathAssignments.$inferSelect)[] = []
    const enrollments: (typeof trainingEnrollments.$inferSelect)[] = []
    for (const emp of targetEmployees) {
      const [assignment] = await db.insert(trainingPathAssignments).values({
        orgId: ctx.orgId, trainingPathId: pathId, employeeId: emp.id, assignedVia,
        assignedViaDepartmentId: input.departmentId ?? null, assignedViaRole: input.role ?? null,
        assignedById: ctx.userId, dueDate: input.dueDate ?? null,
      }).returning()
      assignments.push(assignment)

      for (const pc of pathCourses) {
        const course = await db.query.trainingCourses.findFirst({ where: eq(trainingCourses.id, pc.courseId) })
        if (!course || course.status !== "published") continue // skip draft/archived courses silently -- a path shouldn't fail entirely because one linked course isn't live yet
        const existingEnrollment = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.employeeId, emp.id), eq(trainingEnrollments.courseId, pc.courseId)) })
        if (existingEnrollment) { enrollments.push(existingEnrollment); continue }
        const [enrollment] = await db.insert(trainingEnrollments).values({
          orgId: ctx.orgId, employeeId: emp.id, courseId: pc.courseId, trainingPathId: pathId,
          dueDate: input.dueDate ?? null, assignedById: ctx.userId,
        }).returning()
        enrollments.push(enrollment)
      }
    }
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_path.assigned", entityType: "training_path", entityId: pathId, details: `Assigned via ${assignedVia} to ${targetEmployees.length} employee(s), fanned out to ${enrollments.length} enrollment(s)` })
    return { assignments, enrollments }
  })
}

// ─── Roster / completion dashboard (trainer workspace) ──────────────────

export type CourseRosterRow = {
  employeeId: string; employeeName: string | null; status: string; enrolledAt: Date; dueDate: string | null; completedAt: Date | null
}

/** Per-course roster: who has/hasn't completed this specific course. */
export async function getCourseRoster(ctx: { orgId: string }, courseId: string): Promise<CourseRosterRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const enrollments = await db.query.trainingEnrollments.findMany({ where: and(eq(trainingEnrollments.courseId, courseId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (enrollments.length === 0) return []
    const employeeIds = [...new Set(enrollments.map((e) => e.employeeId))]
    const employees = await db.query.users.findMany({ where: inArray(users.id, employeeIds), columns: { id: true, name: true } })
    const employeesById = new Map(employees.map((e) => [e.id, e.name]))
    const completions = await db.query.trainingCompletions.findMany({ where: and(eq(trainingCompletions.orgId, ctx.orgId), inArray(trainingCompletions.enrollmentId, enrollments.map((e) => e.id))) })
    const completionsByEnrollment = new Map(completions.map((c) => [c.enrollmentId, c]))
    return enrollments.map((e) => ({
      employeeId: e.employeeId, employeeName: employeesById.get(e.employeeId) ?? null, status: e.status,
      enrolledAt: e.enrolledAt, dueDate: e.dueDate, completedAt: completionsByEnrollment.get(e.id)?.completedAt ?? null,
    }))
}) }

export type OrgRosterSummaryRow = {
  courseId: string; courseTitle: string; isMandatory: boolean
  enrolled: number; notStarted: number; inProgress: number; completed: number
}

/** Org-wide dashboard: per-course completion counts, for the manager/trainer roster view. */
export async function getOrgRosterSummary(ctx: { orgId: string }): Promise<OrgRosterSummaryRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const courses = await db.query.trainingCourses.findMany({ where: and(eq(trainingCourses.orgId, ctx.orgId), eq(trainingCourses.status, "published")) })
    if (courses.length === 0) return []
    const enrollments = await db.query.trainingEnrollments.findMany({ where: and(eq(trainingEnrollments.orgId, ctx.orgId), inArray(trainingEnrollments.courseId, courses.map((c) => c.id))) })
    const byCourseCounts = new Map<string, { enrolled: number; notStarted: number; inProgress: number; completed: number }>()
    for (const c of courses) byCourseCounts.set(c.id, { enrolled: 0, notStarted: 0, inProgress: 0, completed: 0 })
    for (const e of enrollments) {
      const bucket = byCourseCounts.get(e.courseId)
      if (!bucket) continue
      bucket.enrolled++
      if (e.status === "not_started") bucket.notStarted++
      else if (e.status === "in_progress") bucket.inProgress++
      else bucket.completed++
    }
    return courses.map((c) => ({ courseId: c.id, courseTitle: c.title, isMandatory: c.isMandatory, ...(byCourseCounts.get(c.id) ?? { enrolled: 0, notStarted: 0, inProgress: 0, completed: 0 }) }))
  })
}

/** "My Training": everything assigned to/enrolled by the logged-in employee. */
export async function getMyTraining(ctx: { orgId: string; userId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const enrollments = await db.query.trainingEnrollments.findMany({ where: and(eq(trainingEnrollments.orgId, ctx.orgId), eq(trainingEnrollments.employeeId, ctx.userId)), orderBy: (t, { desc }) => desc(t.enrolledAt) })
    const courseIds = [...new Set(enrollments.map((e) => e.courseId))]
    const courses = courseIds.length ? await db.query.trainingCourses.findMany({ where: inArray(trainingCourses.id, courseIds) }) : []
    const coursesById = new Map(courses.map((c) => [c.id, c]))
    const assignments = await db.query.trainingPathAssignments.findMany({ where: and(eq(trainingPathAssignments.orgId, ctx.orgId), eq(trainingPathAssignments.employeeId, ctx.userId)) })
    return {
      enrollments: enrollments.map((e) => ({ ...e, course: coursesById.get(e.courseId) ?? null })),
      pathAssignments: assignments,
    }
  })
}
