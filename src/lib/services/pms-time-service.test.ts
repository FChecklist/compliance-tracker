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
import { resolvePmsBillableRatePure, timesheetEntryRef } from "./pms-time-service"

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

  // R67 WS-H (item H-03): a RETURNED entry must be fixable and re-sendable,
  // or the "sent back with a reason" loop has no way to close.
  test("a returned entry can be corrected and re-submitted, and re-submitting clears the stale reason", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "rejected", rejectionReason: "Hours look inflated for this task" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitTimeEntry } = await import("./pms-time-service")
    const result = await submitTimeEntry({ orgId: "org1", userId: "designer1" }, "e1") as { approvalStatus: string; rejectionReason: string | null }
    expect(result.approvalStatus).toBe("submitted")
    expect(result.rejectionReason).toBeNull()
  })

  test("an APPROVED entry still cannot be re-submitted -- it has already been counted as cost", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "approved" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitTimeEntry } = await import("./pms-time-service")
    await expect(submitTimeEntry({ orgId: "org1", userId: "designer1" }, "e1")).rejects.toThrow("Only a draft or returned time entry can be submitted")
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

// R67 WS-H (items H-01/H-03): the day grid's own two service additions.
// Same mocked-tenant-scoped-db pattern as the state-machine block above.
describe("timesheetEntryRef -- the short, stable reference the object page quotes", () => {
  test("derives a TS- reference from the row's own id, uppercased", () => {
    expect(timesheetEntryRef("clx9m2k4a000abcdef")).toBe("TS-ABCDEF")
  })

  test("is stable for the same id and different for different ids", () => {
    expect(timesheetEntryRef("entry-000123")).toBe(timesheetEntryRef("entry-000123"))
    expect(timesheetEntryRef("entry-000123")).not.toBe(timesheetEntryRef("entry-000124"))
  })

  test("a short id is not padded with anything invented", () => {
    expect(timesheetEntryRef("ab")).toBe("TS-AB")
  })
})

describe("updateTimeEntry -- Edit on the object page is draft-only and owner-only", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("the logging designer can edit their own draft entry", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "draft", hours: "2" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { updateTimeEntry } = await import("./pms-time-service")
    const result = await updateTimeEntry({ orgId: "org1", userId: "designer1" }, "e1", { hours: "3.25" }) as { hours: string }
    expect(result.hours).toBe("3.25")
  })

  test("a returned entry is editable -- that is the whole point of sending it back", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "rejected", hours: "8" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { updateTimeEntry } = await import("./pms-time-service")
    const result = await updateTimeEntry({ orgId: "org1", userId: "designer1" }, "e1", { hours: "6" }) as { hours: string }
    expect(result.hours).toBe("6")
  })

  test("a submitted entry cannot be edited underneath the manager reviewing it", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "submitted", hours: "2" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { updateTimeEntry } = await import("./pms-time-service")
    await expect(updateTimeEntry({ orgId: "org1", userId: "designer1" }, "e1", { hours: "3" })).rejects.toThrow("Only a draft or returned time entry can be edited")
  })

  test("someone else's draft entry cannot be edited", async () => {
    const fakeDb = makeFakeDb({ id: "e1", orgId: "org1", userId: "designer1", approvalStatus: "draft", hours: "2" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { updateTimeEntry } = await import("./pms-time-service")
    await expect(updateTimeEntry({ orgId: "org1", userId: "someoneElse" }, "e1", { hours: "3" })).rejects.toThrow("Only the logging user may edit this entry")
  })

  test("zero or negative hours are refused with the exact per-field sentence the grid shows", async () => {
    const { updateTimeEntry } = await import("./pms-time-service")
    await expect(updateTimeEntry({ orgId: "org1", userId: "designer1" }, "e1", { hours: "0" })).rejects.toThrow("Hours must be more than 0")
    await expect(updateTimeEntry({ orgId: "org1", userId: "designer1" }, "e1", { hours: "-2" })).rejects.toThrow("Hours must be more than 0")
  })
})

describe("submitDayForReview -- one decision over the whole day, not a loop", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  function makeDayDb(issues: Array<Record<string, unknown>>, drafts: Array<Record<string, unknown>>) {
    return {
      query: {
        pmsIssues: { findMany: mock(async () => issues) },
        pmsTimeEntries: { findMany: mock(async () => drafts) },
      },
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => drafts.map((d) => ({ ...d, ...patch })) }),
        }),
      }),
    }
  }

  test("submits every draft row of that day in one write and reports the real count and hours", async () => {
    const fakeDb = makeDayDb(
      [{ id: "issue-1", number: 12, title: "Joinery shop drawings" }],
      [
        { id: "e1", issueId: "issue-1", hours: "3", approvalStatus: "draft" },
        { id: "e2", issueId: "issue-1", hours: "4.5", approvalStatus: "draft" },
      ]
    )
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitDayForReview } = await import("./pms-time-service")
    const result = await submitDayForReview({ orgId: "org1", userId: "designer1" }, { projectId: "project-1", spentOn: "2026-09-02" })

    expect(result.submitted).toBe(2)
    expect(result.hours).toBe(7.5)
    expect(result.entries.map((e) => e.approvalStatus)).toEqual(["submitted", "submitted"])
    // The caller needs task + ref per entry to mint one review row each.
    expect(result.entries[0].ref).toBe(timesheetEntryRef("e1"))
    expect(result.entries[0].issue).toEqual({ id: "issue-1", number: 12, title: "Joinery shop drawings" })
  })

  test("a day with nothing logged is refused rather than reported as a successful empty submit", async () => {
    const fakeDb = makeDayDb([{ id: "issue-1", number: 12, title: "Joinery shop drawings" }], [])
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitDayForReview } = await import("./pms-time-service")
    await expect(submitDayForReview({ orgId: "org1", userId: "designer1" }, { projectId: "project-1", spentOn: "2026-09-02" }))
      .rejects.toThrow("No hours logged for this day")
  })

  test("projectId and spentOn are both required -- a day submit with no day is meaningless", async () => {
    const { submitDayForReview } = await import("./pms-time-service")
    await expect(submitDayForReview({ orgId: "org1", userId: "designer1" }, { projectId: "", spentOn: "2026-09-02" })).rejects.toThrow("projectId is required")
    await expect(submitDayForReview({ orgId: "org1", userId: "designer1" }, { projectId: "project-1", spentOn: "" })).rejects.toThrow("spentOn is required")
  })
})
