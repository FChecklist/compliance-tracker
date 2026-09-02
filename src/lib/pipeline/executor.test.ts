/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { hasExecutor } from "./executor";

// executeTask() itself does real DB access via withTenantContext and is
// proven live (a real percentComplete write + RE-SELECT, and a real
// dashboard read) rather than mocked here -- see the R42 seq14 evidence
// trail for the live proof. hasExecutor() is the pure routing check and is
// fully unit-testable.
describe("hasExecutor -- the registry of functions this pipeline can actually run today", () => {
  test("record_work_progress has a real executor", () => {
    expect(hasExecutor("record_work_progress")).toBe(true);
  });

  test("get_construction_project_dashboard has a real executor", () => {
    expect(hasExecutor("get_construction_project_dashboard")).toBe(true);
  });

  test("an unregistered function_id has no executor -- fails honestly, never silently succeeds", () => {
    expect(hasExecutor("approve_variation")).toBe(false);
    expect(hasExecutor("delete_everything")).toBe(false);
    expect(hasExecutor("")).toBe(false);
  });
});

// R67 F-15 (R-232/R-251) -- the pipeline's ONE write path is no longer nested.
//
// THE FAULT. executeRecordWorkProgress() held a tenant transaction open for its
// three lookups AND for createProgressEntry(), which opens its own. That is two
// of tenant-scoped.ts's five app_runtime connections held by a single task, on
// the exact path M24's Task Master uses to record progress -- the same shape
// that self-deadlocked the dashboard in production. The D-06 guard added in
// F-12 turns it from a slow success into an error, so it had to be flattened.
//
// Only the DB layer and the progress service are mocked (the "capture the real
// modules, restore in afterEach" pattern used across this repo's service
// tests), so the real executor runs: its own lookups, its own error strings.
import { afterEach, mock } from "bun:test";

const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realProgressService = await import("@/lib/services/construction-progress-service");

type Order = string[];

function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    query: {
      constructionBoqs: { findFirst: async () => ({ id: "boq-1", version: 2 }) },
      constructionBoqLineItems: { findFirst: async () => ({ id: "li-1", itemCode: "1.01" }) },
      constructionActivities: { findFirst: async () => ({ id: "act-1" }) },
      ...overrides,
    },
  };
}

async function loadExecutor(db: unknown) {
  const order: Order = [];
  let openTransactions = 0;
  let maxOpenTransactions = 0;
  const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (tx: unknown) => Promise<unknown>) => {
    openTransactions += 1;
    maxOpenTransactions = Math.max(maxOpenTransactions, openTransactions);
    order.push("open-transaction");
    try {
      return await fn(db);
    } finally {
      openTransactions -= 1;
      order.push("close-transaction");
    }
  });
  const createProgressEntry = mock(async () => {
    order.push("create-progress-entry");
    return { id: "entry-1", percentComplete: "40" };
  });

  await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }));
  await mock.module("@/lib/services/construction-progress-service", () => ({ ...realProgressService, createProgressEntry }));

  const { executeTask } = await import("./executor");
  return { executeTask, order, withTenantContext, createProgressEntry, maxOpen: () => maxOpenTransactions };
}

const TASK = {
  orgId: "org-1",
  userId: "user-1",
  projectId: "p1",
  functionId: "record_work_progress",
  params: { itemCode: "1.01", percent: 40 },
};

describe("executeRecordWorkProgress: the lookups and the write no longer share a connection", () => {
  afterEach(async () => {
    mock.restore();
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
    await mock.module("@/lib/services/construction-progress-service", () => realProgressService);
  });

  test("the lookup transaction CLOSES before the write starts", async () => {
    const { executeTask, order, createProgressEntry, maxOpen } = await loadExecutor(fakeDb());

    const outcome = await executeTask(TASK);

    expect(outcome.success).toBe(true);
    expect(createProgressEntry.mock.calls.length).toBe(1);
    // The whole point: never two transactions open at once for one task.
    expect(maxOpen()).toBe(1);
    expect(order).toEqual(["open-transaction", "close-transaction", "create-progress-entry"]);
  });

  test("the write receives the references the lookups resolved", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(fakeDb());

    await executeTask(TASK);

    const [, input] = createProgressEntry.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.activityId).toBe("act-1");
    expect(input.boqLineItemId).toBe("li-1");
    expect(input.percentComplete).toBe(40);
    expect(input.projectId).toBe("p1");
  });

  test("a missing BOQ still fails with its own honest reason, and never reaches the write", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(
      fakeDb({ constructionBoqs: { findFirst: async () => undefined } })
    );

    const outcome = await executeTask(TASK);

    expect(outcome).toEqual({ success: false, error: 'no BOQ found for project "p1"' });
    expect(createProgressEntry.mock.calls.length).toBe(0);
  });

  test("an unknown item code still fails with its own honest reason", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(
      fakeDb({ constructionBoqLineItems: { findFirst: async () => undefined } })
    );

    const outcome = await executeTask(TASK);

    expect(outcome).toEqual({ success: false, error: 'item code "1.01" not found in this project\'s BOQ' });
    expect(createProgressEntry.mock.calls.length).toBe(0);
  });

  test("a project with no activity still fails with its own honest reason", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(
      fakeDb({ constructionActivities: { findFirst: async () => undefined } })
    );

    const outcome = await executeTask(TASK);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/no construction activity exists yet for project "p1"/);
    expect(createProgressEntry.mock.calls.length).toBe(0);
  });
});
