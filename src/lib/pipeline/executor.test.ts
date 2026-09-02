/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { executeTask, functionWrites, hasExecutor, type ExecutableTask, type ExecutionOutcome } from "./executor";
import { serialiseFailure } from "./error-codes";

// The registered executors themselves do real DB access via
// withTenantContext and are proven live (a real percentComplete write +
// RE-SELECT, and a real dashboard read) rather than mocked here -- see the
// R42 seq14 evidence trail. hasExecutor() is the pure routing check, and
// R67 B-01 made executeTask()'s own error normalisation testable by letting
// a test pass in its own executor map (production callers never do).
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

  // R67 B-02 -- "Review Budget -- blocked -- no project resolved for this task"
  test("review_budget is executable and is a READ, not a write", () => {
    expect(hasExecutor("review_budget")).toBe(true);
    expect(functionWrites("review_budget")).toBe(false);
    // WRITE_FUNCTION_IDS stays exactly one entry until B-04.
    expect(functionWrites("record_work_progress")).toBe(true);
  });
});

const TASK: ExecutableTask = {
  orgId: "org_1",
  userId: "user_1",
  projectId: "project_1",
  functionId: "record_work_progress",
  params: {},
};

describe("R67 B-01 -- executeTask normalises a thrown transport error to a code", () => {
  test("'write CONNECT_TIMEOUT 3.109.171.244:6543' persists as exactly BACKEND_UNAVAILABLE", async () => {
    const throwing = {
      record_work_progress: async (): Promise<ExecutionOutcome> => {
        throw new Error("write CONNECT_TIMEOUT 3.109.171.244:6543");
      },
    };
    const outcome = await executeTask(TASK, throwing);
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("BACKEND_UNAVAILABLE");
    // THE PERSISTED VALUE -- exactly what run-submission.ts writes to
    // compliance.pipeline_tasks.error via serialiseFailure().
    expect(JSON.parse(serialiseFailure(outcome.failure)).code).toBe("BACKEND_UNAVAILABLE");
    // The address exists only in `debug`, which is logged and never stored.
    expect(outcome.debug).toContain("3.109.171.244:6543");
    expect(serialiseFailure(outcome.failure)).not.toContain("3.109.171.244");
  });

  test("an application bug becomes INTERNAL_ERROR, still with no raw text in the persisted value", async () => {
    const throwing = {
      record_work_progress: async (): Promise<ExecutionOutcome> => {
        throw new TypeError("Cannot read properties of undefined (reading 'boqId')");
      },
    };
    const outcome = await executeTask(TASK, throwing);
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("INTERNAL_ERROR");
    expect(serialiseFailure(outcome.failure)).not.toContain("boqId");
  });

  test("an unregistered function_id fails with FUNCTION_NOT_AVAILABLE, never a sentence", async () => {
    const outcome = await executeTask({ ...TASK, functionId: "not_registered" }, {});
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("FUNCTION_NOT_AVAILABLE");
    expect(outcome.failure.context).toEqual({ functionId: "not_registered" });
  });

  test("a successful executor is passed straight through", async () => {
    const ok = { record_work_progress: async (): Promise<ExecutionOutcome> => ({ success: true, result: { id: "row_1" } }) };
    const outcome = await executeTask(TASK, ok);
    expect(outcome).toEqual({ success: true, result: { id: "row_1" } });
  });
});
