// VERIDIAN Review Framework remediation, Wave B: Training / LMS module
// (2026-07-17). Real gap re-confirmed via a fresh grep of src/ before
// writing this file: zero LMS/course/assessment/curriculum data model
// existed anywhere. See schema.ts's own header comment immediately above
// `trainingCourses` for the full design rationale.
//
// This file owns course/module/lesson authoring, curricula (learning
// paths), enrollment + lesson-progress tracking, completion, and the
// manager-facing roster/completion dashboard. Assessment/quiz authoring and
// scoring lives in training-assessment-service.ts (split by sub-concern,
// same convention as hr-service.ts / hr-attendance-service.ts).
import {
  users, departments, documents,
  trainingCourses, trainingModules, trainingLessons, trainingLessonProgress,
  trainingEnrollments, trainingCompletions, trainingPaths, trainingPathCourses,
  trainingPathAssignments, trainingAssessments,
  trainingCourseStatusEnum, trainingProgressStatusEnum,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, desc, asc } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type TrainingContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type CourseStatus = (typeof trainingCourseStatusEnum.enumValues)[number]
export type ProgressStatus = (typeof trainingProgressStatusEnum.enumValues)[number]

// ─── Pure helpers (no DB access -- kept separate and unit-testable, matching
// this codebase's established convention; see hr-attendance-service.ts's
// own note on not exercising withTenantContext/a live DB from a .test.ts) ──

/** Human-shareable proof-of-completion reference, e.g. "CERT-A1B2C3D4". Not a DB sequence/trigger -- generated here, deterministic-enough for a display string, not a security token. */
export function generateCertificateCode(seed: string = Date.now().toString(36)): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  const seedPart = seed.slice(-4).toUpperCase().padStart(4, "0")
  return `CERT-${seedPart}${rand}`
}

export type LessonProgressLike = { status: ProgressStatus }

/**
 * A course (with at least one lesson) is lesson-complete once every lesson
 * in it has a 'completed' trainingLessonProgress row. A course with zero
 * lessons (e.g. assessment-only) is never lesson-complete via this path --
 * completion for those is driven entirely by passing the assessment(s),
 * see training-assessment-service.ts's maybeCompleteFromAssessment.
 */
export function isAllLessonsComplete(lessonCount: number, progress: LessonProgressLike[]): boolean {
  if (lessonCount === 0) return false
  const completedCount = progress.filter((p) => p.status === "completed").length
  return completedCount >= lessonCount
}

export function computeEnrollmentStatus(lessonCount: number, progress: LessonProgressLike[]): ProgressStatus {
  if (isAllLessonsComplete(lessonCount, progress)) return "completed"
  if (progress.some((p) => p.status === "completed" || p.status === "in_progress")) return "in_progress"
  return "not_started"
}

// ─── Courses ────────────────────────────────────────────────────────────

export type ListCoursesFilters = { status?: CourseStatus; category?: string; targetRole?: string; targetDepartmentId?: string; mandatoryOnly?: boolean }

export async function listCourses(ctx: { orgId: string }, filters?: ListCoursesFilters) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(trainingCourses.orgId, ctx.orgId)]
    if (filters?.status) conditions.push(eq(trainingCourses.status, filters.status))
    if (filters?.category) conditions.push(eq(trainingCourses.category, filters.category))
    if (filters?.targetRole) conditions.push(eq(trainingCourses.targetRole, filters.targetRole))
    if (filters?.targetDepartmentId) conditions.push(eq(trainingCourses.targetDepartmentId, filters.targetDepartmentId))
    if (filters?.mandatoryOnly) conditions.push(eq(trainingCourses.isMandatory, true))
    return db.query.trainingCourses.findMany({ where: and(...conditions), orderBy: (t, { desc: d }) => d(t.createdAt) })
  })
}

export async function getCourseDetail(ctx: { orgId: string }, courseId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)

    const modules = await db.query.trainingModules.findMany({
      where: and(eq(trainingModules.courseId, courseId), eq(trainingModules.orgId, ctx.orgId)),
      orderBy: (t, { asc: a }) => a(t.sortOrder),
    })
    const lessons = modules.length
      ? await db.query.trainingLessons.findMany({
          where: and(inArray(trainingLessons.moduleId, modules.map((m) => m.id)), eq(trainingLessons.orgId, ctx.orgId)),
          orderBy: (t, { asc: a }) => a(t.sortOrder),
        })
      : []
    const assessments = await db.query.trainingAssessments.findMany({
      where: and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, ctx.orgId)),
    })
    const lessonsByModule = new Map<string, typeof lessons>()
    for (const l of lessons) {
      const list = lessonsByModule.get(l.moduleId) ?? []
      list.push(l)
      lessonsByModule.set(l.moduleId, list)
    }
    return {
      course,
      modules: modules.map((m) => ({ ...m, lessons: lessonsByModule.get(m.id) ?? [] })),
      assessments,
      totalLessons: lessons.length,
    }
  })
}

export type CreateCourseInput = {
  title: string; description?: string; category?: string; isMandatory?: boolean
  targetRole?: string; targetDepartmentId?: string; estimatedDurationMinutes?: number
  passingScorePercent?: number
}

export async function createCourse(ctx: TrainingContext, input: CreateCourseInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [course] = await db.insert(trainingCourses).values({
      orgId: ctx.orgId, title: input.title, description: input.description || null,
      category: input.category || null, isMandatory: input.isMandatory ?? false,
      targetRole: input.targetRole || null, targetDepartmentId: input.targetDepartmentId || null,
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
      passingScorePercent: input.passingScorePercent ?? 70,
      createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_course.created", entityType: "training_course", entityId: course!.id })
    return course
  })
}

export type UpdateCourseInput = Partial<CreateCourseInput> & { status?: CourseStatus }

export async function updateCourse(ctx: TrainingContext, courseId: string, input: UpdateCourseInput) {
  if (input.status && !trainingCourseStatusEnum.enumValues.includes(input.status)) {
    throw new ServiceError(`status must be one of: ${trainingCourseStatusEnum.enumValues.join(", ")}`, 400)
  }
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Course not found", 404)
    const [updated] = await db.update(trainingCourses).set({
      title: input.title ?? existing.title,
      description: input.description !== undefined ? input.description : existing.description,
      category: input.category !== undefined ? input.category : existing.category,
      isMandatory: input.isMandatory ?? existing.isMandatory,
      targetRole: input.targetRole !== undefined ? input.targetRole : existing.targetRole,
      targetDepartmentId: input.targetDepartmentId !== undefined ? input.targetDepartmentId : existing.targetDepartmentId,
      estimatedDurationMinutes: input.estimatedDurationMinutes !== undefined ? input.estimatedDurationMinutes : existing.estimatedDurationMinutes,
      passingScorePercent: input.passingScorePercent ?? existing.passingScorePercent,
      status: input.status ?? existing.status,
      updatedAt: new Date(),
    }).where(eq(trainingCourses.id, courseId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_course.updated", entityType: "training_course", entityId: courseId })
    return updated
  })
}

export async function deleteCourse(ctx: TrainingContext, courseId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Course not found", 404)
    const enrollmentCount = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.courseId, courseId), eq(trainingEnrollments.orgId, ctx.orgId)) })
    if (enrollmentCount) throw new ServiceError("Cannot delete a course with existing enrollments -- archive it instead", 400)
    await db.delete(trainingCourses).where(eq(trainingCourses.id, courseId))
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_course.deleted", entityType: "training_course", entityId: courseId })
    return { success: true }
  })
}

// ─── Modules ────────────────────────────────────────────────────────────

export async function addModule(ctx: TrainingContext, courseId: string, input: { title: string; description?: string; sortOrder?: number }) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const [module_] = await db.insert(trainingModules).values({
      orgId: ctx.orgId, courseId, title: input.title, description: input.description || null, sortOrder: input.sortOrder ?? 0,
    }).returning()
    return module_
  })
}

export async function updateModule(ctx: { orgId: string }, moduleId: string, input: { title?: string; description?: string; sortOrder?: number }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingModules.findFirst({ where: and(eq(trainingModules.id, moduleId), eq(trainingModules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Module not found", 404)
    const [updated] = await db.update(trainingModules).set({
      title: input.title ?? existing.title,
      description: input.description !== undefined ? input.description : existing.description,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      updatedAt: new Date(),
    }).where(eq(trainingModules.id, moduleId)).returning()
    return updated
  })
}

export async function deleteModule(ctx: { orgId: string }, moduleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingModules.findFirst({ where: and(eq(trainingModules.id, moduleId), eq(trainingModules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Module not found", 404)
    await db.delete(trainingLessons).where(and(eq(trainingLessons.moduleId, moduleId), eq(trainingLessons.orgId, ctx.orgId)))
    await db.delete(trainingModules).where(eq(trainingModules.id, moduleId))
    return { success: true }
  })
}

// ─── Lessons ────────────────────────────────────────────────────────────

export type AddLessonInput = {
  title: string; contentType?: "text" | "video" | "document"; content?: string; videoUrl?: string
  sortOrder?: number; estimatedDurationMinutes?: number
}

export async function addLesson(ctx: { orgId: string }, moduleId: string, input: AddLessonInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const module_ = await db.query.trainingModules.findFirst({ where: and(eq(trainingModules.id, moduleId), eq(trainingModules.orgId, ctx.orgId)) })
    if (!module_) throw new ServiceError("Module not found", 404)
    const [lesson] = await db.insert(trainingLessons).values({
      orgId: ctx.orgId, moduleId, courseId: module_.courseId, title: input.title,
      contentType: input.contentType ?? "text", content: input.content || null, videoUrl: input.videoUrl || null,
      sortOrder: input.sortOrder ?? 0, estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
    }).returning()
    return lesson
  })
}

export async function updateLesson(ctx: { orgId: string }, lessonId: string, input: Partial<AddLessonInput>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingLessons.findFirst({ where: and(eq(trainingLessons.id, lessonId), eq(trainingLessons.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lesson not found", 404)
    const [updated] = await db.update(trainingLessons).set({
      title: input.title ?? existing.title,
      contentType: input.contentType ?? existing.contentType,
      content: input.content !== undefined ? input.content : existing.content,
      videoUrl: input.videoUrl !== undefined ? input.videoUrl : existing.videoUrl,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      estimatedDurationMinutes: input.estimatedDurationMinutes !== undefined ? input.estimatedDurationMinutes : existing.estimatedDurationMinutes,
      updatedAt: new Date(),
    }).where(eq(trainingLessons.id, lessonId)).returning()
    return updated
  })
}

export async function deleteLesson(ctx: { orgId: string }, lessonId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingLessons.findFirst({ where: and(eq(trainingLessons.id, lessonId), eq(trainingLessons.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lesson not found", 404)
    await db.delete(trainingLessons).where(eq(trainingLessons.id, lessonId))
    return { success: true }
  })
}

/** Documents attached to a lesson or course, reusing the existing generic documents table (Wave 61's linkedEntityType/linkedEntityId) rather than a new attachment table. */
export async function listAttachments(ctx: { orgId: string }, entityType: "training_lesson" | "training_course", entityId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.documents.findMany({ where: and(eq(documents.orgId, ctx.orgId), eq(documents.linkedEntityType, entityType), eq(documents.linkedEntityId, entityId)) })
  )
}

// ─── Enrollment + lesson progress ──────────────────────────────────────

export async function listEnrollments(ctx: { orgId: string }, filters?: { employeeId?: string; courseId?: string; status?: ProgressStatus }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(trainingEnrollments.orgId, ctx.orgId)]
    if (filters?.employeeId) conditions.push(eq(trainingEnrollments.employeeId, filters.employeeId))
    if (filters?.courseId) conditions.push(eq(trainingEnrollments.courseId, filters.courseId))
    if (filters?.status) conditions.push(eq(trainingEnrollments.status, filters.status))
    return db.query.trainingEnrollments.findMany({ where: and(...conditions), orderBy: (t, { desc: d }) => d(t.enrolledAt) })
  })
}

async function enrollInternal(db: TenantDb, orgId: string, employeeId: string, courseId: string, opts: { assignedById?: string | null; trainingPathId?: string | null; dueDate?: string | null }) {
  const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, orgId)) })
  if (!course) throw new ServiceError("Course not found", 404)
  const existing = await db.query.trainingEnrollments.findFirst({ where: and(eq(trainingEnrollments.orgId, orgId), eq(trainingEnrollments.employeeId, employeeId), eq(trainingEnrollments.courseId, courseId)) })
  if (existing) return existing
  const [enrollment] = await db.insert(trainingEnrollments).values({
    orgId, employeeId, courseId, trainingPathId: opts.trainingPathId ?? null,
    assignedById: opts.assignedById ?? null, dueDate: opts.dueDate ?? null,
  }).returning()
  return enrollment
}

/** Self-enrollment: an employee opts into a (published) course themselves. */
export async function selfEnroll(ctx: { orgId: string; userId: string }, courseId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    if (course.status !== "published") throw new ServiceError("This course is not open for enrollment", 400)
    return enrollInternal(db, ctx.orgId, ctx.userId, courseId, {})
  })
}

/** Manager/trainer assignment: enroll a specific employee in a course, regardless of its published/draft status (a manager may assign a course before it's broadly published). */
export async function assignCourse(ctx: TrainingContext, employeeId: string, courseId: string, dueDate?: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const targetUser = await db.query.users.findFirst({ where: and(eq(users.id, employeeId), eq(users.orgId, ctx.orgId)) })
    if (!targetUser) throw new ServiceError("Employee not found", 404)
    const enrollment = await enrollInternal(db, ctx.orgId, employeeId, courseId, { assignedById: ctx.userId, dueDate: dueDate ?? null })
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_enrollment.assigned", entityType: "training_enrollment", entityId: enrollment!.id, details: JSON.stringify({ employeeId, courseId }) })
    return enrollment
  })
}

/** Mark a single lesson as started/completed for the employee's enrollment in that lesson's course. Auto-creates the enrollment if the employee hasn't formally enrolled yet (e.g. previewing before committing) -- matches checkIn's own idempotent-upsert posture. */
export async function markLessonProgress(ctx: { orgId: string; userId: string }, lessonId: string, status: ProgressStatus) {
  if (!trainingProgressStatusEnum.enumValues.includes(status)) {
    throw new ServiceError(`status must be one of: ${trainingProgressStatusEnum.enumValues.join(", ")}`, 400)
  }
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const lesson = await db.query.trainingLessons.findFirst({ where: and(eq(trainingLessons.id, lessonId), eq(trainingLessons.orgId, ctx.orgId)) })
    if (!lesson) throw new ServiceError("Lesson not found", 404)

    const enrollment = await enrollInternal(db, ctx.orgId, ctx.userId, lesson.courseId, {})
    if (enrollment.status === "not_started") {
      await db.update(trainingEnrollments).set({ status: "in_progress", startedAt: enrollment.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollment.id))
    }

    const now = new Date()
    const [progress] = await db.insert(trainingLessonProgress).values({
      orgId: ctx.orgId, enrollmentId: enrollment.id, lessonId, employeeId: ctx.userId, status,
      startedAt: now, completedAt: status === "completed" ? now : null,
    }).onConflictDoUpdate({
      target: [trainingLessonProgress.enrollmentId, trainingLessonProgress.lessonId],
      set: { status, completedAt: status === "completed" ? now : null, updatedAt: now },
    }).returning()

    await maybeCompleteFromLessons(db, ctx.orgId, enrollment.id, lesson.courseId)
    return progress
  })
}

export async function listLessonProgress(ctx: { orgId: string }, enrollmentId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.trainingLessonProgress.findMany({ where: and(eq(trainingLessonProgress.orgId, ctx.orgId), eq(trainingLessonProgress.enrollmentId, enrollmentId)) })
  )
}

/**
 * After a lesson-progress change, checks whether the enrollment's course is
 * now fully lesson-complete AND has no assessments gating it (a course with
 * one or more trainingAssessments rows requires
 * training-assessment-service.ts's own completion path instead -- lessons
 * alone are not enough to pass a course that also has a graded quiz).
 */
async function maybeCompleteFromLessons(db: TenantDb, orgId: string, enrollmentId: string, courseId: string) {
  const assessmentCount = await db.query.trainingAssessments.findFirst({ where: and(eq(trainingAssessments.courseId, courseId), eq(trainingAssessments.orgId, orgId)) })
  if (assessmentCount) return // gated by an assessment -- see training-assessment-service.ts

  const modules = await db.query.trainingModules.findMany({ where: and(eq(trainingModules.courseId, courseId), eq(trainingModules.orgId, orgId)), columns: { id: true } })
  const lessons = modules.length
    ? await db.query.trainingLessons.findMany({ where: and(inArray(trainingLessons.moduleId, modules.map((m) => m.id)), eq(trainingLessons.orgId, orgId)), columns: { id: true } })
    : []
  const progress = await db.query.trainingLessonProgress.findMany({ where: and(eq(trainingLessonProgress.enrollmentId, enrollmentId), eq(trainingLessonProgress.orgId, orgId)) })
  if (!isAllLessonsComplete(lessons.length, progress)) return

  const existingCompletion = await db.query.trainingCompletions.findFirst({ where: eq(trainingCompletions.enrollmentId, enrollmentId) })
  if (existingCompletion) return

  await db.update(trainingEnrollments).set({ status: "completed", updatedAt: new Date() }).where(eq(trainingEnrollments.id, enrollmentId))
  await db.insert(trainingCompletions).values({
    orgId, enrollmentId, certificateCode: generateCertificateCode(enrollmentId), score: null, passed: true,
  })
}

// ─── Curricula / learning paths ────────────────────────────────────────

export async function listPaths(ctx: { orgId: string }, filters?: { isActive?: boolean }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(trainingPaths.orgId, ctx.orgId)]
    if (filters?.isActive !== undefined) conditions.push(eq(trainingPaths.isActive, filters.isActive))
    return db.query.trainingPaths.findMany({ where: and(...conditions), orderBy: (t, { desc: d }) => d(t.createdAt) })
  })
}

export async function getPathDetail(ctx: { orgId: string }, pathId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const path = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!path) throw new ServiceError("Training path not found", 404)
    const pathCourses = await db.query.trainingPathCourses.findMany({
      where: and(eq(trainingPathCourses.trainingPathId, pathId), eq(trainingPathCourses.orgId, ctx.orgId)),
      orderBy: (t, { asc: a }) => a(t.sortOrder),
    })
    const courseIds = pathCourses.map((pc) => pc.courseId)
    const courses = courseIds.length ? await db.query.trainingCourses.findMany({ where: inArray(trainingCourses.id, courseIds) }) : []
    const coursesById = new Map(courses.map((c) => [c.id, c]))
    return { path, courses: pathCourses.map((pc) => ({ ...pc, course: coursesById.get(pc.courseId) ?? null })) }
  })
}

export async function createPath(ctx: TrainingContext, input: { name: string; description?: string; targetDepartmentId?: string; targetRole?: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [path] = await db.insert(trainingPaths).values({
      orgId: ctx.orgId, name: input.name, description: input.description || null,
      targetDepartmentId: input.targetDepartmentId || null, targetRole: input.targetRole || null,
      createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_path.created", entityType: "training_path", entityId: path!.id })
    return path
  })
}

export async function updatePath(ctx: { orgId: string }, pathId: string, input: { name?: string; description?: string; targetDepartmentId?: string; targetRole?: string; isActive?: boolean }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Training path not found", 404)
    const [updated] = await db.update(trainingPaths).set({
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      targetDepartmentId: input.targetDepartmentId !== undefined ? input.targetDepartmentId : existing.targetDepartmentId,
      targetRole: input.targetRole !== undefined ? input.targetRole : existing.targetRole,
      isActive: input.isActive ?? existing.isActive,
      updatedAt: new Date(),
    }).where(eq(trainingPaths.id, pathId)).returning()
    return updated
  })
}

export async function addCourseToPath(ctx: { orgId: string }, pathId: string, courseId: string, opts?: { sortOrder?: number; isRequired?: boolean }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const path = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!path) throw new ServiceError("Training path not found", 404)
    const course = await db.query.trainingCourses.findFirst({ where: and(eq(trainingCourses.id, courseId), eq(trainingCourses.orgId, ctx.orgId)) })
    if (!course) throw new ServiceError("Course not found", 404)
    const [pathCourse] = await db.insert(trainingPathCourses).values({
      orgId: ctx.orgId, trainingPathId: pathId, courseId, sortOrder: opts?.sortOrder ?? 0, isRequired: opts?.isRequired ?? true,
    }).onConflictDoNothing({ target: [trainingPathCourses.trainingPathId, trainingPathCourses.courseId] }).returning()
    return pathCourse
  })
}

/**
 * Assigns a curriculum to employees -- individually, by department, or by
 * role -- and fans out into one trainingEnrollments row per course in the
 * path for each resolved employee. This IS the "role-based training path"
 * mechanism Requirement 3 asked about: there was no pre-existing concept to
 * link into (see schema.ts's header comment), so this is it.
 */
export async function assignPath(
  ctx: TrainingContext,
  pathId: string,
  target: { employeeIds?: string[]; departmentId?: string; role?: string },
  dueDate?: string
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const path = await db.query.trainingPaths.findFirst({ where: and(eq(trainingPaths.id, pathId), eq(trainingPaths.orgId, ctx.orgId)) })
    if (!path) throw new ServiceError("Training path not found", 404)
    const pathCourses = await db.query.trainingPathCourses.findMany({ where: and(eq(trainingPathCourses.trainingPathId, pathId), eq(trainingPathCourses.orgId, ctx.orgId)) })
    if (pathCourses.length === 0) throw new ServiceError("This training path has no courses to assign", 400)

    let employeeIds: string[] = target.employeeIds ?? []
    let assignedVia: "individual" | "department" | "role" = "individual"
    if (target.departmentId) {
      assignedVia = "department"
      const rows = await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), eq(users.departmentId, target.departmentId)), columns: { id: true } })
      employeeIds = rows.map((r) => r.id)
    } else if (target.role) {
      assignedVia = "role"
      const rows = await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), eq(users.role, target.role as typeof users.$inferSelect.role)), columns: { id: true } })
      employeeIds = rows.map((r) => r.id)
    }
    if (employeeIds.length === 0) throw new ServiceError("No employees resolved for this assignment target", 400)

    const results: { assignment: typeof trainingPathAssignments.$inferSelect; enrollments: (typeof trainingEnrollments.$inferSelect)[] }[] = []
    for (const employeeId of employeeIds) {
      const [assignment] = await db.insert(trainingPathAssignments).values({
        orgId: ctx.orgId, trainingPathId: pathId, employeeId, assignedVia,
        assignedViaDepartmentId: target.departmentId ?? null, assignedViaRole: target.role ?? null,
        assignedById: ctx.userId, dueDate: dueDate ?? null,
      }).returning()
      const enrollments: (typeof trainingEnrollments.$inferSelect)[] = []
      for (const pc of pathCourses) {
        enrollments.push(await enrollInternal(db, ctx.orgId, employeeId, pc.courseId, { assignedById: ctx.userId, trainingPathId: pathId, dueDate: dueDate ?? null }))
      }
      results.push({ assignment: assignment!, enrollments })
    }
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "training_path.assigned", entityType: "training_path", entityId: pathId, details: JSON.stringify({ assignedVia, employeeCount: employeeIds.length }) })
    return results
  })
}

// ─── Manager-facing roster / completion dashboard ──────────────────────
// Matches hr-attendance-service.ts's getMonthlySummaries shape (per-employee
// rollup rows a dashboard table renders directly) -- see also
// hr-attendance/page.tsx's Summary tab for the UI convention this feeds.

export type RosterFilters = { courseId?: string; departmentId?: string; status?: ProgressStatus }

export type RosterRow = {
  employeeId: string; employeeName: string | null; courseId: string; courseTitle: string
  status: ProgressStatus; enrolledAt: Date; dueDate: string | null; completedAt: Date | null
}

export async function getRoster(ctx: { orgId: string }, filters?: RosterFilters): Promise<RosterRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    let departmentUserIds: string[] | undefined
    if (filters?.departmentId) {
      const rows = await db.query.users.findMany({ where: and(eq(users.orgId, ctx.orgId), eq(users.departmentId, filters.departmentId)), columns: { id: true } })
      departmentUserIds = rows.map((r) => r.id)
      if (departmentUserIds.length === 0) return []
    }

    const conditions = [eq(trainingEnrollments.orgId, ctx.orgId)]
    if (filters?.courseId) conditions.push(eq(trainingEnrollments.courseId, filters.courseId))
    if (filters?.status) conditions.push(eq(trainingEnrollments.status, filters.status))
    if (departmentUserIds) conditions.push(inArray(trainingEnrollments.employeeId, departmentUserIds))
    const enrollments = await db.query.trainingEnrollments.findMany({ where: and(...conditions), orderBy: (t, { desc: d }) => d(t.enrolledAt) })
    if (enrollments.length === 0) return []

    const employeeIds = [...new Set(enrollments.map((e) => e.employeeId))]
    const courseIds = [...new Set(enrollments.map((e) => e.courseId))]
    const [employees, courses, completions] = await Promise.all([
      db.query.users.findMany({ where: inArray(users.id, employeeIds), columns: { id: true, name: true } }),
      db.query.trainingCourses.findMany({ where: inArray(trainingCourses.id, courseIds), columns: { id: true, title: true } }),
      db.query.trainingCompletions.findMany({ where: inArray(trainingCompletions.enrollmentId, enrollments.map((e) => e.id)) }),
    ])
    const employeesById = new Map(employees.map((e) => [e.id, e]))
    const coursesById = new Map(courses.map((c) => [c.id, c]))
    const completionByEnrollment = new Map(completions.map((c) => [c.enrollmentId, c]))

    return enrollments.map((e) => ({
      employeeId: e.employeeId,
      employeeName: employeesById.get(e.employeeId)?.name ?? null,
      courseId: e.courseId,
      courseTitle: coursesById.get(e.courseId)?.title ?? "Course",
      status: e.status,
      enrolledAt: e.enrolledAt,
      dueDate: e.dueDate,
      completedAt: completionByEnrollment.get(e.id)?.completedAt ?? null,
    }))
  })
}

export type CourseCompletionSummary = { courseId: string; courseTitle: string; enrolled: number; inProgress: number; completed: number; completionPercent: number; overdue: number }

/** Per-course rollup (enrolled/in-progress/completed counts + overdue count) across the whole org -- the "who has/hasn't completed what, org-wide" view. */
export async function getCourseCompletionSummaries(ctx: { orgId: string }): Promise<CourseCompletionSummary[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const courses = await db.query.trainingCourses.findMany({ where: eq(trainingCourses.orgId, ctx.orgId) })
    if (courses.length === 0) return []
    const enrollments = await db.query.trainingEnrollments.findMany({ where: eq(trainingEnrollments.orgId, ctx.orgId) })
    const today = new Date().toISOString().slice(0, 10)
    const byCourse = new Map<string, typeof enrollments>()
    for (const e of enrollments) {
      const list = byCourse.get(e.courseId) ?? []
      list.push(e)
      byCourse.set(e.courseId, list)
    }
    return courses.map((c) => {
      const list = byCourse.get(c.id) ?? []
      const completed = list.filter((e) => e.status === "completed").length
      const inProgress = list.filter((e) => e.status === "in_progress").length
      const overdue = list.filter((e) => e.status !== "completed" && e.dueDate && e.dueDate < today).length
      return {
        courseId: c.id, courseTitle: c.title, enrolled: list.length, inProgress, completed,
        completionPercent: list.length > 0 ? Math.round((completed / list.length) * 10000) / 100 : 0,
        overdue,
      }
    })
  })
}
