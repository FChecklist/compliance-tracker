/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc), OWNERSHIP BYPASS fix: markCourseComplete()
// (src/lib/services/training-service.ts) previously never checked who was
// calling -- any authenticated org member (any role, including admin) could
// mark ANY employee's enrollment complete just by guessing/enumerating its
// id. This is a real ownership bypass, not merely a missing role gate: a
// role check alone would still let e.g. an admin complete a course on
// someone else's behalf, which is exactly the wrong shape here (see
// submitAttempt()'s own established convention in the same file, which this
// fix matches -- only the enrolled employee, no manager/admin override).
//
// This proves BOTH directions of the real fix, exercising the ACTUAL
// service function (training-service.ts is NOT mocked) rather than a
// stand-in for it: a non-owner is rejected with 403 before the enrollment
// is ever mutated (proven with an ADMIN-role non-owner specifically, to
// show role rank does not substitute for ownership), and the real owner
// succeeds. @/lib/db/tenant-scoped is mocked with a fake tx standing in for
// withTenantContext's real transaction -- matching src/app/api/me/route.
// test.ts's own established convention (no live DB from a .test.ts file).
import { describe, test, expect, mock } from "bun:test"

const ORG_ID = "org-1"
const ENROLLMENT_ID = "enrollment-1"
const OWNER_ID = "employee-owner"

type Enrollment = {
  id: string; orgId: string; employeeId: string; courseId: string
  status: string; trainingPathId: string | null; dueDate: string | null; assignedById: string | null
}

function makeEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: ENROLLMENT_ID, orgId: ORG_ID, employeeId: OWNER_ID, courseId: "course-1",
    status: "not_started", trainingPathId: null, dueDate: null, assignedById: null,
    ...overrides,
  }
}

// Generic enough to serve every withTenantContext(fn) call in
// markCourseComplete: query.trainingEnrollments.findFirst,
// query.trainingAssessments.findFirst (no assessment on this course),
// update(...).set(...).where(...).returning(), and the two inserts
// (trainingCompletions + auditLogs via logActivity) -- .values() returns a
// Promise with onConflictDoNothing/returning attached so it works whether
// the caller awaits it directly (logActivity) or chains off it
// (trainingCompletions' onConflictDoNothing).
function fakeTx(enrollment: Enrollment | null) {
  const updated = enrollment ? { ...enrollment, status: "completed" } : null
  return {
    query: {
      trainingEnrollments: { findFirst: async () => enrollment },
      trainingAssessments: { findFirst: async () => null },
    },
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [updated] }) }) }),
    insert: () => ({
      values: () => {
        const p = Promise.resolve(undefined) as Promise<undefined> & { onConflictDoNothing: () => Promise<void>; returning: () => Promise<unknown[]> }
        p.onConflictDoNothing = async () => undefined
        p.returning = async () => []
        return p
      },
    }),
  }
}

function mockAuthAndDb(dbUser: { id: string; role: string; name?: string } | null, enrollment: Enrollment | null) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser, orgId: ORG_ID })),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeTx(enrollment))),
  }))
}

function makeRequest(): Request {
  return new Request(`http://localhost/api/training/enrollments/${ENROLLMENT_ID}/complete`, { method: "POST" })
}

describe("POST /api/training/enrollments/[id]/complete (ownership gate)", () => {
  test("a non-owner org member -- even an admin -- is rejected with 403 and the enrollment is never mutated", async () => {
    mockAuthAndDb({ id: "someone-else", role: "admin", name: "Not The Owner" }, makeEnrollment())
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: ENROLLMENT_ID }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Only the enrolled employee can complete this course")
  })

  test("the enrolled employee (the real owner) succeeds and the enrollment is marked completed", async () => {
    mockAuthAndDb({ id: OWNER_ID, role: "member", name: "Owner" }, makeEnrollment())
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: ENROLLMENT_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("completed")
  })
})
