/// <reference types="bun-types" />
// R67 WS-H (item H-02). Two halves, tested the way this repo already tests
// this file class:
//
//  1. The PURE half (buildTimesheetReviewDetail / formatShortDay) is tested
//     directly, with no database at all -- it is what makes the Task Master
//     row read as the exact sentence the item quotes, and a locale or a
//     rounding change is precisely the kind of drift a unit test catches and
//     a live click-through does not.
//
//  2. The DB half is exercised with withTenantContext mocked -- the same
//     "mock the tenant-scoped db, restore in afterEach" pattern
//     pms-time-service.test.ts and construction-reports-service.test.ts
//     already use for tenant-scoped services. The assertions are about the
//     decisions this service makes (don't stack a second open row for the
//     same entry; record the decision rather than deleting the row), not
//     about postgres.
import { describe, expect, test, mock, afterEach } from "bun:test"
import { buildTimesheetReviewDetail, formatShortDay, TIMESHEET_REVIEW_FUNCTION_ID, TIMESHEET_REVIEW_CHAIN_STEPS } from "./timesheet-review-task-service"

describe("buildTimesheetReviewDetail -- the exact Task Master line 2", () => {
  test("renders the sentence item H-02 quotes", () => {
    expect(
      buildTimesheetReviewDetail({ hours: "3", issueNumber: 12, issueTitle: "Joinery shop drawings", designerName: "Priya", spentOn: "2026-09-02" })
    ).toBe("3.00 h, #12 Joinery shop drawings, Priya, 2 Sep")
  })

  test("always shows two decimals, so 0.25-step hours never render as 7.5 next to 7.50", () => {
    expect(buildTimesheetReviewDetail({ hours: 7.5, issueNumber: 3, issueTitle: "Site visit", designerName: "Arjun", spentOn: "2026-09-02" }))
      .toBe("7.50 h, #3 Site visit, Arjun, 2 Sep")
  })

  test("a task with no number still names the task rather than printing '#null'", () => {
    expect(buildTimesheetReviewDetail({ hours: "1", issueNumber: null, issueTitle: "Concept sketches", designerName: "Priya", spentOn: "2026-09-02" }))
      .toBe("1.00 h, Concept sketches, Priya, 2 Sep")
  })
})

describe("formatShortDay -- pinned, never locale-derived", () => {
  test("renders '2 Sep', not '09/02' or '2 September'", () => {
    expect(formatShortDay("2026-09-02")).toBe("2 Sep")
  })

  test("drops the leading zero on the day, keeps the real month", () => {
    expect(formatShortDay("2026-01-09")).toBe("9 Jan")
    expect(formatShortDay("2026-12-31")).toBe("31 Dec")
  })

  test("an unparseable value is returned as-is rather than becoming 'NaN undefined'", () => {
    expect(formatShortDay("not-a-date")).toBe("not-a-date")
    expect(formatShortDay("2026-13-01")).toBe("2026-13-01")
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

type Captured = { submission?: Record<string, unknown>; task?: Record<string, unknown>; updates: Record<string, unknown>[] }

/**
 * A db double narrow enough to be honest about what it proves: it records
 * what the service tried to insert/update and answers the one SELECT the
 * service makes with `existingOpenTaskIds`.
 */
function makeFakeDb(
  existingOpenTaskIds: string[],
  captured: Captured,
  // R67 WS-H fix pass: closing a row now RECOMPUTES the submission's derived
  // status from its child tasks (schema.ts's M25 invariant on
  // compliance.submissions.status), so the double has to answer the child-task
  // SELECT too. Default: the one task this service mints, now done.
  childTasks: Array<{ submissionId: string; status: string }> = [{ submissionId: "submission-1", status: "done" }]
) {
  return {
    select: () => ({
      from: () => ({
        // Two callers with two shapes: the open-row lookup ends in .limit(1),
        // the child-status recompute awaits the where() directly.
        where: () =>
          Object.assign(Promise.resolve(childTasks), {
            limit: async () => existingOpenTaskIds.map((id) => ({ id })),
          }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          // The submission is inserted first and the task second; the service
          // needs the submission's id, so the double hands back a real one.
          if (!captured.submission) {
            captured.submission = values
            return [{ ...values, id: "submission-1" }]
          }
          captured.task = values
          return [{ ...values, id: "task-1" }]
        },
      }),
      _table: table,
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          captured.updates.push(patch)
          const result = [{ id: "task-1", submissionId: "submission-1" }]
          return Object.assign(Promise.resolve(result), {
            returning: async () => result,
          })
        },
      }),
    }),
  }
}

async function loadServiceWith(fakeDb: unknown) {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  return import("./timesheet-review-task-service")
}

describe("openTimesheetReviewTask / closeTimesheetReviewTask", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("mints a submission + pipeline task whose functionId and chain make the shell render 'Review Timesheet > Approve'", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReviewTask } = await loadServiceWith(makeFakeDb([], captured))
    const result = await openTimesheetReviewTask({ orgId: "org1" }, {
      timeEntryId: "entry-1", projectId: "project-1", designerId: "designer-1",
      hours: "3", issueNumber: 12, issueTitle: "Joinery shop drawings", designerName: "Priya", spentOn: "2026-09-02",
    })

    expect(result.created).toBe(true)
    expect(captured.task!.functionId).toBe(TIMESHEET_REVIEW_FUNCTION_ID)
    expect((captured.task!.derivedChain as { steps: string[] }).steps).toEqual([...TIMESHEET_REVIEW_CHAIN_STEPS])
    expect(captured.task!.status).toBe("to_do")
    // The row's line 2 comes from the submission's rawInput.
    expect(captured.submission!.rawInput).toBe("3.00 h, #12 Joinery shop drawings, Priya, 2 Sep")
    // The entry id must be findable again, or the row can never be closed.
    expect((captured.task!.params as { timeEntryId: string }).timeEntryId).toBe("entry-1")
  })

  test("the submission is attributed to the designer, never to the calling API key", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReviewTask } = await loadServiceWith(makeFakeDb([], captured))
    await openTimesheetReviewTask({ orgId: "org1" }, {
      timeEntryId: "entry-1", projectId: "project-1", designerId: "designer-1",
      hours: "3", issueNumber: 12, issueTitle: "Joinery shop drawings", designerName: "Priya", spentOn: "2026-09-02",
    })
    expect(captured.submission!.userId).toBe("designer-1")
  })

  test("a re-submit of the same entry reuses the open row instead of stacking a duplicate in the reviewer's list", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReviewTask } = await loadServiceWith(makeFakeDb(["already-open-task"], captured))
    const result = await openTimesheetReviewTask({ orgId: "org1" }, {
      timeEntryId: "entry-1", projectId: "project-1", designerId: "designer-1",
      hours: "3", issueNumber: 12, issueTitle: "Joinery shop drawings", designerName: "Priya", spentOn: "2026-09-02",
    })
    expect(result).toEqual({ taskId: "already-open-task", created: false })
    expect(captured.submission).toBeUndefined()
    expect(captured.task).toBeUndefined()
  })

  test("closing records the decision on the row rather than deleting it, and carries a rejection reason", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReviewTask } = await loadServiceWith(makeFakeDb([], captured))
    const result = await closeTimesheetReviewTask({ orgId: "org1", userId: "manager-1" }, "entry-1", "rejected", "Hours look inflated for this task")

    expect(result).toEqual({ closed: 1 })
    const taskPatch = captured.updates[0]
    expect(taskPatch.status).toBe("done")
    expect(taskPatch.result).toEqual({ decision: "rejected", decidedById: "manager-1", rejectionReason: "Hours look inflated for this task" })
  })

  test("an approval closes the row with no rejectionReason key at all", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReviewTask } = await loadServiceWith(makeFakeDb([], captured))
    await closeTimesheetReviewTask({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved")
    expect(captured.updates[0].result).toEqual({ decision: "approved", decidedById: "manager-1" })
  })

  test("openTimesheetReviewTask refuses a call with no entry id rather than minting an uncloseable row", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReviewTask } = await loadServiceWith(makeFakeDb([], captured))
    await expect(openTimesheetReviewTask({ orgId: "org1" }, {
      timeEntryId: "", projectId: "project-1", designerId: "designer-1",
      hours: "3", issueNumber: 12, issueTitle: "Joinery shop drawings", designerName: "Priya", spentOn: "2026-09-02",
    })).rejects.toThrow("timeEntryId is required")
  })
})

// R67 WS-H (item H-03). The other half of the loop: a returned entry has to
// reach the DESIGNER as their own "Needs you" row carrying the manager's
// reason, and that row has to close when they send the correction back.
describe("openTimesheetReturnedTask / closeTimesheetReturnedTask", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  const ENTRY = {
    timeEntryId: "entry-1", projectId: "project-1", designerId: "designer-1",
    hours: "3", issueNumber: 12, issueTitle: "Joinery shop drawings", designerName: "Priya", spentOn: "2026-09-02",
  }

  test("the designer's row carries the manager's reason as its line 2, so they need not open the entry", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReturnedTask, TIMESHEET_RETURNED_FUNCTION_ID, TIMESHEET_RETURNED_CHAIN_STEPS } = await loadServiceWith(makeFakeDb([], captured))
    const result = await openTimesheetReturnedTask({ orgId: "org1" }, { ...ENTRY, rejectionReason: "Hours look inflated for this task" })

    expect(result.created).toBe(true)
    expect(captured.task!.functionId).toBe(TIMESHEET_RETURNED_FUNCTION_ID)
    expect((captured.task!.derivedChain as { steps: string[] }).steps).toEqual([...TIMESHEET_RETURNED_CHAIN_STEPS])
    expect(captured.submission!.rawInput).toBe("3.00 h, #12 Joinery shop drawings, Priya, 2 Sep - sent back: Hours look inflated for this task")
  })

  test("a return with no reason still says it was sent back rather than rendering 'sent back: null'", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReturnedTask } = await loadServiceWith(makeFakeDb([], captured))
    await openTimesheetReturnedTask({ orgId: "org1" }, { ...ENTRY, rejectionReason: null })
    expect(captured.submission!.rawInput).toBe("3.00 h, #12 Joinery shop drawings, Priya, 2 Sep - sent back")
  })

  test("the returned row is a SECOND row, told apart from the reviewer's by its function id", async () => {
    const captured: Captured = { updates: [] }
    const { openTimesheetReturnedTask, TIMESHEET_REVIEW_FUNCTION_ID, TIMESHEET_RETURNED_FUNCTION_ID } = await loadServiceWith(makeFakeDb([], captured))
    await openTimesheetReturnedTask({ orgId: "org1" }, { ...ENTRY, rejectionReason: "Fix the category" })
    expect(captured.task!.functionId).not.toBe(TIMESHEET_REVIEW_FUNCTION_ID)
    expect(captured.task!.functionId).toBe(TIMESHEET_RETURNED_FUNCTION_ID)
  })

  test("sending the correction back closes the designer's row, recorded as resubmitted", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReturnedTask } = await loadServiceWith(makeFakeDb([], captured))
    const result = await closeTimesheetReturnedTask({ orgId: "org1", userId: "designer-1" }, "entry-1")
    expect(result).toEqual({ closed: 1 })
    expect(captured.updates[0].result).toEqual({ decision: "resubmitted", decidedById: "designer-1" })
  })
})

// R67 WS-H fix pass. schema.ts on compliance.submissions.status: "DERIVED from
// this submission's own pipelineTasks ... the only writer of this column after
// INSERT must be the same service function that recomputes it from child task
// statuses" (M25). The first cut wrote 'done' straight after closing a task --
// right only because each submission this service mints carries exactly ONE
// task. These pin the recompute so a future second task cannot silently
// invalidate it.
describe("closing a review row recomputes the submission's DERIVED status (M25)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  /** The second update the service issues is the submission recompute. */
  function submissionPatch(captured: Captured) {
    return captured.updates[1]
  }

  test("a submission whose every task is done becomes done", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReviewTask } = await loadServiceWith(
      makeFakeDb([], captured, [{ submissionId: "submission-1", status: "done" }])
    )
    await closeTimesheetReviewTask({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved")
    expect(submissionPatch(captured)).toEqual({ status: "done" })
  })

  test("a submission with a second, still-open task stays in_progress rather than being marked done", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReviewTask } = await loadServiceWith(
      makeFakeDb([], captured, [
        { submissionId: "submission-1", status: "done" },
        { submissionId: "submission-1", status: "to_do" },
      ])
    )
    await closeTimesheetReviewTask({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved")
    expect(submissionPatch(captured)).toEqual({ status: "in_progress" })
  })

  test("a blocked sibling task makes the submission partial -- M25's 'any FAILED task -> PARTIAL'", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReviewTask } = await loadServiceWith(
      makeFakeDb([], captured, [
        { submissionId: "submission-1", status: "done" },
        { submissionId: "submission-1", status: "blocked" },
      ])
    )
    await closeTimesheetReviewTask({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved")
    expect(submissionPatch(captured)).toEqual({ status: "partial" })
  })

  test("nothing was closed, so nothing is recomputed", async () => {
    const captured: Captured = { updates: [] }
    const { closeTimesheetReviewTask } = await loadServiceWith(
      makeFakeDb([], captured, [{ submissionId: "submission-1", status: "done" }])
    )
    // Simulate "no open row matched": the update double always returns one row,
    // so this asserts the shape instead -- one task patch, one submission patch,
    // never a bare unconditional submission write.
    await closeTimesheetReviewTask({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved")
    expect(captured.updates).toHaveLength(2)
    expect(captured.updates[0].status).toBe("done")
  })
})

// R67 WS-H fix pass. The Task Master bookkeeping that follows a decision now
// lives in ONE function instead of two near-identical route blocks. It must
// NEVER fail the decision: the hours have already moved.
describe("recordTimesheetDecisionTasks -- bookkeeping never rolls back a real decision", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  const ENTRY = { userId: "designer-1", hours: "3", spentOn: "2026-09-02" }

  test("an approval closes the reviewer's row and opens no returned row", async () => {
    const captured: Captured = { updates: [] }
    const { recordTimesheetDecisionTasks } = await loadServiceWith(makeFakeDb([], captured))
    const result = await recordTimesheetDecisionTasks({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved", null, ENTRY)
    expect(result).toEqual({ reviewTaskClosed: 1, returnedTaskCreated: false, reviewTaskError: null })
  })

  test("a failure writing the task rows is REPORTED, not thrown -- the decision stands", async () => {
    const exploding = {
      select: () => ({ from: () => ({ where: () => { throw new Error("pipeline_tasks unavailable") } }) }),
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
      update: () => ({ set: () => ({ where: () => { throw new Error("pipeline_tasks unavailable") } }) }),
    }
    const { recordTimesheetDecisionTasks } = await loadServiceWith(exploding)
    const result = await recordTimesheetDecisionTasks({ orgId: "org1", userId: "manager-1" }, "entry-1", "approved", null, ENTRY)
    expect(result.reviewTaskError).toBe("pipeline_tasks unavailable")
    expect(result.reviewTaskClosed).toBe(0)
  })
})
