/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc), OWNERSHIP BYPASS fix: startEnrollment()
// (src/lib/services/training-service.ts) previously never checked who was
// calling -- any authenticated org member (any role, including admin) could
// flip ANY employee's enrollment to in_progress just by guessing/
// enumerating its id. Same real ownership bypass as the sibling complete/
// route.test.ts (see its header for the full reasoning) -- a role check
// alone would not fix this, since it would still let e.g. an admin act on
// someone else's enrollment. Matches submitAttempt()'s own established
// convention in the same file: only the enrolled employee, no manager/
// admin override.
//
// Proves BOTH directions against the ACTUAL service function
// (training-service.ts is NOT mocked): a non-owner is rejected with 403
// before the enrollment is ever mutated (proven with an ADMIN-role
// non-owner specifically, to show role rank does not substitute for
// ownership), and the real owner succeeds. @/lib/db/tenant-scoped is mocked
// with a fake tx standing in for withTenantContext's real transaction --
// matching src/app/api/me/route.test.ts's own established convention.
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

function fakeTx(enrollment: Enrollment | null) {
  const updated = enrollment ? { ...enrollment, status: "in_progress" } : null
  return {
    query: {
      trainingEnrollments: { findFirst: async () => enrollment },
    },
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [updated] }) }) }),
  }
}

function mockAuthAndDb(dbUser: { id: string; role: string } | null, enrollment: Enrollment | null) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser, orgId: ORG_ID })),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeTx(enrollment))),
  }))
}

function makeRequest(): Request {
  return new Request(`http://localhost/api/training/enrollments/${ENROLLMENT_ID}/start`, { method: "POST" })
}

describe("POST /api/training/enrollments/[id]/start (ownership gate)", () => {
  test("a non-owner org member -- even an admin -- is rejected with 403 and the enrollment is never mutated", async () => {
    mockAuthAndDb({ id: "someone-else", role: "admin" }, makeEnrollment())
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: ENROLLMENT_ID }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Only the enrolled employee can start this course")
  })

  test("the enrolled employee (the real owner) succeeds and the enrollment is marked in_progress", async () => {
    mockAuthAndDb({ id: OWNER_ID, role: "member" }, makeEnrollment())
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: ENROLLMENT_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("in_progress")
  })
})
