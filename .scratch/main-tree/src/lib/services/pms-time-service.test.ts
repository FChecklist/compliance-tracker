// Tests the pure resolvePmsBillableRatePure() directly -- matches this
// repo's established pattern of not touching withTenantContext/a live DB
// from a .test.ts file (see erp-payment-entries-service.test.ts's header).
//
// The submit/approve/reject state-machine tests below (Design Studio
// timesheets, Owner item 12, 2026-07-28) exercise the real
// submitTimeEntry/approveTimeEntry/rejectTimeEntry functions with only the
// DB layer mocked -- same "mock withTenantContext, restore in afterEach"
// pattern construction-reports-service.test.ts's designerTimesheetReport
// describe block already uses for this same tenant-scoped-db precedent.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import { resolvePmsBillableRatePure } from "./pms-time-service"

describe("resolvePmsBillableRatePure -- 2-tier rate precedence (per-user > org default)", () => {
  test("returns null when no rates exist at all", () => {
    expect(resolvePmsBillableRatePure([], "user_1", "2026-07-27")).toBeNull()
  })

  test("returns the org default rate when no per-user rate exists", () => {
    const rates = [{ userId: null, hourlyRate: "50", validFrom: "2026-01-01" }]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBe(50)
  })

  test("prefers a per-user rate over the org default", () => {
    const rates = [
      { userId: null, hourlyRate: "50", validFrom: "2026-01-01" },
      { userId: "user_1", hourlyRate: "90", validFrom: "2026-01-01" },
    ]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBe(90)
  })

  test("ignores rates not yet valid as of the given date", () => {
    const rates = [{ userId: "user_1", hourlyRate: "90", validFrom: "2026-08-01" }]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBeNull()
  })

  test("picks the most recent validFrom among applicable per-user rates", () => {
    const rates = [
      { userId: "user_1", hourlyRate: "80", validFrom: "2026-01-01" },
      { userId: "user_1", hourlyRate: "95", validFrom: "2026-06-01" },
      { userId: "user_1", hourlyRate: "150", validFrom: "2026-09-01" }, // not yet valid
    ]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBe(95)
  })

  test("does not leak one user's rate onto another user", () => {
    const rates = [{ userId: "user_2", hourlyRate: "999", validFrom: "2026-01-01" }]
    expect(resolvePmsBillableRatePure(rates, "user_1", "2026-07-27")).toBeNull()
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

function makeFakeDb(initialEntry: Record<string, unknown>) {
  let entry = { ...initialEntry }
  return {
    query: {
      pmsTimeEntries: {
        findFirst: mock(async () => ({ ...entry })),
      },
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            entry = { ...entry, ...patch }
            return [{ ...entry }]
          },
        }),
      }),
    }),
  }
}

describe("submitTimeEntry / approveTimeEntry / rejectTimeEntry: designer-entry -> manager-validation state machine", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("the logging designer can submit their own draft entry (draft -> submitted)", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "draft" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitTimeEntry } = await import("./pms-time-service")
    const result = await submitTimeEntry({ orgId: "org1", userId: "designer1" }, "e1") as { approvalStatus: string }
    expect(result.approvalStatus).toBe("submitted")
  })

  test("a different user cannot submit someone else's draft entry", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "draft" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitTimeEntry } = await import("./pms-time-service")
    await expect(submitTimeEntry({ orgId: "org1", userId: "someoneElse" }, "e1")).rejects.toThrow("Only the logging user may submit this entry")
  })

  test("a manager (a different user than the submitter) can approve a submitted entry (submitted -> approved)", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "submitted" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { approveTimeEntry } = await import("./pms-time-service")
    const result = await approveTimeEntry({ orgId: "org1", userId: "manager1" }, "e1") as { approvalStatus: string; approvedById: string }
    expect(result.approvalStatus).toBe("approved")
    expect(result.approvedById).toBe("manager1")
  })

  // SUCCESS_CRITERIA: a member/designer role cannot self-approve. Route-layer
  // requireRole(dbUser, "manager") (see approve/route.test.ts) blocks a
  // member from reaching this function at all in production; this test
  // proves the service itself is a second, independent line of defense --
  // even a manager-ranked account cannot approve their own submitted entry,
  // mirroring construction-kpi-service.ts's approveKpiEntry self-approval
  // guard exactly.
  test("the submitter cannot self-approve their own submitted entry, even if they hold manager rank", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "submitted" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { approveTimeEntry } = await import("./pms-time-service")
    await expect(approveTimeEntry({ orgId: "org1", userId: "designer1" }, "e1")).rejects.toThrow("The submitter cannot review their own time entry")
  })

  test("a draft (not yet submitted) entry cannot be approved", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "draft" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { approveTimeEntry } = await import("./pms-time-service")
    await expect(approveTimeEntry({ orgId: "org1", userId: "manager1" }, "e1")).rejects.toThrow("Only a submitted time entry can be reviewed")
  })

  test("an already-approved entry cannot be approved again", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "approved" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { approveTimeEntry } = await import("./pms-time-service")
    await expect(approveTimeEntry({ orgId: "org1", userId: "manager1" }, "e1")).rejects.toThrow("Only a submitted time entry can be reviewed")
  })

  test("rejectTimeEntry moves a submitted entry to rejected and records the reason, by a different user than the submitter", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "submitted" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { rejectTimeEntry } = await import("./pms-time-service")
    const result = await rejectTimeEntry({ orgId: "org1", userId: "manager1" }, "e1", "Hours look inflated for this task") as { approvalStatus: string; rejectionReason: string }
    expect(result.approvalStatus).toBe("rejected")
    expect(result.rejectionReason).toBe("Hours look inflated for this task")
  })
})
