/// <reference types="bun-types" />
// VERIDIAN Review Framework gap-closure ("AI Can Safely Modify Module": PRs
// touching a src/lib/services/*.ts file with zero prior test coverage must
// add at least one test) -- veri-todo-service.ts had no sibling *.test.ts
// before this PR. Same mocked-@/lib/db/tenant-scoped convention as
// crm-service.test.ts's getSalesRepPerformanceDashboard tests (see that
// file's own header note): withTenantContext is mocked to hand
// listVeriTodos() a fake `db` whose `query.<table>.findMany` calls are
// plain mocks, so no live Postgres connection is needed.
//
// GAP-VERI-TODO-STUCK-LOADING-NOT-READY (MASTER-TRACKER.yaml): the real fix
// under test here is that listVeriTodos()'s 3 independent queries (tasks,
// instructionCommitments, pmsIssueAssignees) now run concurrently via
// Promise.all instead of one sequential round-trip each. The "dispatches
// all 3 before any resolves" test below is a real regression guard for
// that specific defect -- it fails if a future edit reverts to sequential
// awaits, since a sequential implementation would not have called the
// second/third mock yet by the time the first one's promise is still
// pending.
import { describe, expect, test, mock, afterEach } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"

const ORG_ID = "org-veritodo-test"
const USER_ID = "user-veritodo-test"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

function withDb(db: unknown) {
  return mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: { orgId: string; userId: string }, fn: (db: unknown) => Promise<unknown>) =>
      fn(db)
    ),
  }))
}

describe("listVeriTodos", () => {
  test("dispatches the 3 independent queries (tasks/instructionCommitments/pmsIssueAssignees) concurrently, not sequentially", async () => {
    // Each mock's promise is held open (never resolved) until after we've
    // asserted all 3 were already called -- a sequential `await` chain
    // could not have reached the 2nd/3rd call while the 1st is still
    // pending, so this fails under the pre-fix sequential-awaits code.
    let resolveTasks!: (v: unknown[]) => void
    let resolveCommitments!: (v: unknown[]) => void
    let resolveAssignees!: (v: unknown[]) => void

    const tasksFindMany = mock(() => new Promise((res) => (resolveTasks = res)))
    const commitmentsFindMany = mock(() => new Promise((res) => (resolveCommitments = res)))
    const assigneesFindMany = mock(() => new Promise((res) => (resolveAssignees = res)))

    const db = {
      query: {
        tasks: { findMany: tasksFindMany },
        instructionCommitments: { findMany: commitmentsFindMany },
        pmsIssueAssignees: { findMany: assigneesFindMany },
        pmsIssues: { findMany: mock(async () => []) },
        pmsIssueStatuses: { findMany: mock(async () => []) },
        projects: { findMany: mock(async () => []) },
      },
    }
    await withDb(db)

    const { listVeriTodos } = await import("./veri-todo-service")
    const pending = listVeriTodos({ orgId: ORG_ID, userId: USER_ID })

    // Let the microtask queue drain once so the Promise.all's own .then
    // machinery and each findMany() call has had a chance to run, without
    // resolving any of the underlying promises yet.
    await Promise.resolve()
    await Promise.resolve()

    expect(tasksFindMany).toHaveBeenCalledTimes(1)
    expect(commitmentsFindMany).toHaveBeenCalledTimes(1)
    expect(assigneesFindMany).toHaveBeenCalledTimes(1)

    resolveTasks([])
    resolveCommitments([])
    resolveAssignees([])

    const result = await pending
    expect(result.items).toEqual([])
  })

  test("merges tasks, pending instruction commitments, and open (non-completed/cancelled) assigned pms issues, sorted by priority desc then oldest-first", async () => {
    const task = {
      id: "task-1", title: "Do the thing", description: "d", status: "pending",
      createdAt: new Date("2026-01-02T00:00:00Z"), priority: 1,
    }
    const commitment = {
      id: "commit-1", describedAction: "Follow up with vendor", status: "pending",
      dueDate: new Date("2026-01-10T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"),
    }
    const assignee = { issueId: "issue-1" }
    const openIssue = {
      id: "issue-1", title: "Fix the leak", description: "d2", statusId: "status-open",
      dueDate: "2026-01-05", createdAt: new Date("2026-01-03T00:00:00Z"), projectId: "proj-1",
    }
    const closedIssue = {
      id: "issue-2", title: "Already done", description: null, statusId: "status-done",
      dueDate: null, createdAt: new Date("2026-01-04T00:00:00Z"), projectId: "proj-1",
    }
    const openStatus = { id: "status-open", name: "In Progress", group: "active" }
    const closedStatus = { id: "status-done", name: "Done", group: "completed" }
    const project = { id: "proj-1" }

    const db = {
      query: {
        tasks: { findMany: mock(async () => [task]) },
        instructionCommitments: { findMany: mock(async () => [commitment]) },
        pmsIssueAssignees: { findMany: mock(async () => [assignee]) },
        pmsIssues: { findMany: mock(async () => [openIssue, closedIssue]) },
        pmsIssueStatuses: { findMany: mock(async () => [openStatus, closedStatus]) },
        projects: { findMany: mock(async () => [project]) },
      },
    }
    await withDb(db)

    const { listVeriTodos } = await import("./veri-todo-service")
    const { items } = await listVeriTodos({ orgId: ORG_ID, userId: USER_ID })

    // The closed pms issue is filtered out -- only 3 items, not 4.
    expect(items).toHaveLength(3)
    expect(items.find((i) => i.id === "issue-2")).toBeUndefined()

    const sources = items.map((i) => i.source)
    expect(sources).toContain("task")
    expect(sources).toContain("instruction")
    expect(sources).toContain("pms_issue")

    // priority 1 (task) sorts ahead of the two null-priority (treated as 0)
    // items regardless of createdAt.
    expect(items[0].id).toBe("task-1")
    // Among the two priority-0 items, oldest createdAt first: commitment
    // (2026-01-01) before the pms issue (2026-01-03).
    expect(items[1].id).toBe("commit-1")
    expect(items[2].id).toBe("issue-1")

    const pmsItem = items.find((i) => i.id === "issue-1")!
    expect(pmsItem.status).toBe("In Progress")
    expect(pmsItem.href).toBe("/pms/proj-1/issues")
  })

  test("short-circuits the pms-issue lookup chain (no issueRows/statusRows/projectRows query) when the user has zero assigned issues", async () => {
    const issuesFindMany = mock(async () => [])
    const statusesFindMany = mock(async () => [])
    const projectsFindMany = mock(async () => [])

    const db = {
      query: {
        tasks: { findMany: mock(async () => []) },
        instructionCommitments: { findMany: mock(async () => []) },
        pmsIssueAssignees: { findMany: mock(async () => []) },
        pmsIssues: { findMany: issuesFindMany },
        pmsIssueStatuses: { findMany: statusesFindMany },
        projects: { findMany: projectsFindMany },
      },
    }
    await withDb(db)

    const { listVeriTodos } = await import("./veri-todo-service")
    const { items } = await listVeriTodos({ orgId: ORG_ID, userId: USER_ID })

    expect(items).toEqual([])
    expect(issuesFindMany).not.toHaveBeenCalled()
    expect(statusesFindMany).not.toHaveBeenCalled()
    expect(projectsFindMany).not.toHaveBeenCalled()
  })
})
