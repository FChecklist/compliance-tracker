/// <reference types="bun-types" />
// Wave 173 (GAP-UNIVERSAL-DASHBOARD): tests the pure categorize*() functions
// and buildWorkDashboard() -- the DB-touching getWorkDashboard() itself is
// deliberately left untested here, matching this repo's established pattern
// of not exercising withTenantContext/a live DB from a .test.ts file (see
// task-service.test.ts's own note on this).
import { describe, expect, test } from "bun:test"
import {
  categorizeTask, categorizeComplianceItem, categorizeTicket, categorizeApprovalRequest,
  buildWorkDashboard, WORK_DASHBOARD_CATEGORIES, type WorkItem,
} from "./work-dashboard-service"

const NOW = new Date("2026-07-12T12:00:00Z")
const PAST = new Date("2026-07-01T00:00:00Z")
const FUTURE = new Date("2026-08-01T00:00:00Z")

describe("categorizeTask", () => {
  test("no due date, low priority, pending: to_do", () => {
    expect(categorizeTask({ status: "pending", priority: 0, dueDate: null }, NOW)).toBe("to_do")
  })
  test("in_progress, not overdue: wip", () => {
    expect(categorizeTask({ status: "in_progress", priority: 0, dueDate: FUTURE }, NOW)).toBe("wip")
  })
  test("overdue, normal priority: overdue", () => {
    expect(categorizeTask({ status: "pending", priority: 0, dueDate: PAST }, NOW)).toBe("overdue")
  })
  test("overdue AND urgent priority (3): escalations", () => {
    expect(categorizeTask({ status: "in_progress", priority: 3, dueDate: PAST }, NOW)).toBe("escalations")
  })
  test("failed status is always an escalation regardless of due date", () => {
    expect(categorizeTask({ status: "failed", priority: 0, dueDate: null }, NOW)).toBe("escalations")
  })
  test("urgent priority, not overdue: critical", () => {
    expect(categorizeTask({ status: "pending", priority: 3, dueDate: FUTURE }, NOW)).toBe("critical")
  })
  test("completed tasks are never overdue even with a past due date", () => {
    expect(categorizeTask({ status: "completed", priority: 0, dueDate: PAST }, NOW)).toBe("to_do")
  })
})

describe("categorizeComplianceItem", () => {
  test("explicit 'overdue' status + high priority: escalations", () => {
    expect(categorizeComplianceItem({ status: "overdue", priority: "high", dueDate: PAST }, NOW)).toBe("escalations")
  })
  test("explicit 'overdue' status + medium priority: overdue", () => {
    expect(categorizeComplianceItem({ status: "overdue", priority: "medium", dueDate: PAST }, NOW)).toBe("overdue")
  })
  test("past dueDate but status not yet synced to 'overdue': still detected overdue", () => {
    expect(categorizeComplianceItem({ status: "pending", priority: "low", dueDate: PAST }, NOW)).toBe("overdue")
  })
  test("critical priority, not overdue: critical", () => {
    expect(categorizeComplianceItem({ status: "pending", priority: "critical", dueDate: FUTURE }, NOW)).toBe("critical")
  })
  test("in_progress, not overdue: wip", () => {
    expect(categorizeComplianceItem({ status: "in_progress", priority: "low", dueDate: FUTURE }, NOW)).toBe("wip")
  })
  test("draft, no due date: to_do", () => {
    expect(categorizeComplianceItem({ status: "draft", priority: "low", dueDate: null }, NOW)).toBe("to_do")
  })
})

describe("categorizeTicket", () => {
  test("SLA breached + critical priority: escalations", () => {
    expect(categorizeTicket({ status: "open", priority: "critical", slaDeadline: PAST }, NOW)).toBe("escalations")
  })
  test("SLA breached + medium priority: overdue", () => {
    expect(categorizeTicket({ status: "open", priority: "medium", slaDeadline: PAST }, NOW)).toBe("overdue")
  })
  test("resolved tickets are never overdue even past SLA", () => {
    expect(categorizeTicket({ status: "resolved", priority: "high", slaDeadline: PAST }, NOW)).toBe("to_do")
  })
  test("in_progress within SLA: wip", () => {
    expect(categorizeTicket({ status: "in_progress", priority: "low", slaDeadline: FUTURE }, NOW)).toBe("wip")
  })
})

describe("categorizeApprovalRequest", () => {
  test("always pending -- an approval_request has no priority/due-date concept", () => {
    expect(categorizeApprovalRequest()).toBe("pending")
  })
})

describe("buildWorkDashboard", () => {
  function item(overrides: Partial<WorkItem>): WorkItem {
    return { id: "1", sourceType: "task", title: "t", status: "pending", priority: null, dueDate: null, category: "to_do", url: "/tasks", ...overrides }
  }

  test("groups items into their own category bucket and counts match", () => {
    const items = [
      item({ id: "1", category: "to_do" }),
      item({ id: "2", category: "wip" }),
      item({ id: "3", category: "wip" }),
      item({ id: "4", category: "escalations" }),
    ]
    const result = buildWorkDashboard(items, NOW)
    expect(result.categories.to_do.length).toBe(1)
    expect(result.categories.wip.length).toBe(2)
    expect(result.categories.escalations.length).toBe(1)
    expect(result.categories.overdue.length).toBe(0)
    expect(result.counts.wip).toBe(2)
    expect(result.totalItems).toBe(4)
  })

  test("every one of the 6 named categories is always present, even when empty", () => {
    const result = buildWorkDashboard([], NOW)
    for (const c of WORK_DASHBOARD_CATEGORIES) {
      expect(result.categories[c]).toEqual([])
      expect(result.counts[c]).toBe(0)
    }
  })

  test("items with a real due date sort earliest-first, ahead of items with none", () => {
    const items = [
      item({ id: "no-due", category: "overdue", dueDate: null }),
      item({ id: "later", category: "overdue", dueDate: "2026-07-05T00:00:00.000Z" }),
      item({ id: "earlier", category: "overdue", dueDate: "2026-07-01T00:00:00.000Z" }),
    ]
    const result = buildWorkDashboard(items, NOW)
    expect(result.categories.overdue.map((i) => i.id)).toEqual(["earlier", "later", "no-due"])
  })

  test("generatedAt reflects the `now` passed in", () => {
    expect(buildWorkDashboard([], NOW).generatedAt).toBe(NOW.toISOString())
  })
})
