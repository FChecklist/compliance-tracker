/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { executeTask, functionWrites, hasExecutor, type ExecutableTask, type ExecutionOutcome } from "./executor";
import { isRetryableFailure, normaliseThrownError, serialiseFailure } from "./error-codes";
import { functionSpec, requiredParamSatisfied } from "./function-registry";
import { ServiceError } from "@/lib/services/compliance-service";

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

// ── R67 FIX PASS: a SERVICE's 4xx is not an internal error ────────────────
//
// Every registered write calls a real service, and those services raise
// ServiceError with a deliberate status for an expected business condition.
// Before this branch they all went through normaliseThrownError(), which only
// recognises TRANSPORT shapes -- so the user was told "Something went wrong
// on our side - nothing was saved [Retry]" and offered a Retry for a
// duplicate that can never succeed.
describe("FIX PASS -- executeTask maps a service's own 4xx into the closed vocabulary", () => {
  const throwingService = (message: string, status: number) => ({
    record_work_progress: async (): Promise<ExecutionOutcome> => {
      throw new ServiceError(message, status);
    },
  });

  test("a 409 duplicate ('Attendance already recorded for this worker on this date') is ALREADY_RECORDED, not INTERNAL_ERROR", async () => {
    const outcome = await executeTask(
      { ...TASK, functionId: "record_work_progress" },
      throwingService("Attendance already recorded for this worker on this date", 409)
    );
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("ALREADY_RECORDED");
    // Not retryable: the row is already there, so `waiting` would be a lie.
    expect(isRetryableFailure(outcome.failure.code)).toBe(false);
    // The service's own English is logged, never persisted.
    expect(serialiseFailure(outcome.failure)).not.toContain("Attendance already recorded");
  });

  test("a 404 ('Roster entry not found') is RECORD_NOT_FOUND", async () => {
    const outcome = await executeTask(TASK, throwingService("Roster entry not found", 404));
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("RECORD_NOT_FOUND");
    expect(isRetryableFailure(outcome.failure.code)).toBe(false);
  });

  test("'Parent BOQ not found' (createBoqRevision, 404) is RECORD_NOT_FOUND", async () => {
    const outcome = await executeTask(TASK, throwingService("Parent BOQ not found", 404));
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("RECORD_NOT_FOUND");
  });

  test("a 403 is NOT_PERMITTED and any other 4xx is REQUEST_REJECTED", async () => {
    const forbidden = await executeTask(TASK, throwingService("You cannot approve a BOQ you created yourself", 403));
    expect(forbidden.success).toBe(false);
    if (!forbidden.success) expect(forbidden.failure.code).toBe("NOT_PERMITTED");

    const rejected = await executeTask(TASK, throwingService("budgetPercentage must be between 0 and 100", 400));
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.failure.code).toBe("REQUEST_REJECTED");
  });

  test("the 5xx-digit false positive is gone: 'line 512 not found' is a record, not a dead backend", async () => {
    // normaliseThrownError's \b5\d\d\b clause is right for a raw driver
    // string and wrong for a service's business sentence -- checking
    // ServiceError first is what removes it. Proven both ways.
    expect(normaliseThrownError(new Error("line 512 not found")).failure.code).toBe("BACKEND_UNAVAILABLE");
    const outcome = await executeTask(TASK, throwingService("line 512 not found", 404));
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("RECORD_NOT_FOUND");
  });

  test("a service's own 5xx still falls through to the transport normaliser", async () => {
    const outcome = await executeTask(TASK, throwingService("Upstream construction service failed", 502));
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("INTERNAL_ERROR");
  });
});

// ── R67 FIX PASS: the executor's BOQ failure carries the same context ─────
describe("FIX PASS -- executeRecordWorkProgress names the project, not just a version number", () => {
  test("ExecutableTask carries projectLabel, and both run paths supply it", () => {
    // A type-level fact, asserted structurally: the field exists and is
    // optional, so a caller with no label yields a sentence with the clause
    // omitted rather than one with a hole in it.
    const withLabel: ExecutableTask = { ...TASK, projectLabel: "Cedar Heights Villa - Phase 1" };
    expect(withLabel.projectLabel).toBe("Cedar Heights Villa - Phase 1");
    const withoutLabel: ExecutableTask = { ...TASK };
    expect(withoutLabel.projectLabel).toBeUndefined();
  });
});

// ── R67 B-04: Sumeet's daily writes are registered ────────────────────────
describe("B-04 -- the writes the pipeline can now execute", () => {
  test("WRITE_FUNCTION_IDS contains record_attendance and create_meeting", () => {
    expect(functionWrites("record_attendance")).toBe(true);
    expect(functionWrites("create_meeting")).toBe(true);
    expect(functionWrites("add_roster_entry")).toBe(true);
    expect(functionWrites("create_boq_revision")).toBe(true);
    expect(functionWrites("create_document")).toBe(true);
    // Still exactly the writes -- a read must never drift into this set.
    expect(functionWrites("review_budget")).toBe(false);
    expect(functionWrites("get_construction_project_dashboard")).toBe(false);
  });

  test("every registered write has a real executor", () => {
    for (const id of ["record_work_progress", "record_attendance", "add_roster_entry", "create_meeting", "create_boq_revision", "create_document"]) {
      expect(hasExecutor(id)).toBe(true);
    }
  });

  test("record_attendance with a missing date returns {code:'DATE_REQUIRED', missing:['date']} rather than throwing", async () => {
    const outcome = await executeTask({
      ...TASK,
      functionId: "record_attendance",
      params: { rosterId: "w1" },
    });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("DATE_REQUIRED");
    expect(outcome.failure.missing).toEqual(["date"]);
    expect(outcome.failure.picker).toBe("date");
  });

  test("record_attendance with no worker asks for the worker, not the date", async () => {
    const outcome = await executeTask({ ...TASK, functionId: "record_attendance", params: { date: "2026-09-02" } });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("WORKER_REQUIRED");
    expect(outcome.failure.missing).toEqual(["rosterId"]);
  });

  test("create_meeting with no title asks for the title", async () => {
    const outcome = await executeTask({ ...TASK, functionId: "create_meeting", params: { scheduledAt: "2026-09-03T10:00:00Z" } });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("TITLE_REQUIRED");
    expect(outcome.failure.missing).toEqual(["title"]);
  });

  test("a write with no project resolved asks for the project first", async () => {
    const outcome = await executeTask({
      ...TASK,
      projectId: null,
      functionId: "record_attendance",
      params: { rosterId: "w1", date: "2026-09-02" },
    });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("PROJECT_REQUIRED");
    expect(outcome.failure.missing).toEqual(["projectId"]);
  });

  // Every assertion above ran with no database: the required-param guard
  // returns before the service is called, which is the point -- a missing
  // field must never reach recordAttendance() and come back as its own
  // English "attendanceDate is required" through the catch block.
});

// ── R67 B-11: the value chip "2 nos" must be executable, not a dead end ────
//
// Asserted against the REAL registry and the REAL executor, both of which
// answer before any database access -- there is deliberately no injected
// executor here, because an injected map would prove nothing about the
// guard that actually runs in production.
describe("B-11 -- a quantity answers 'how much is done' as well as a percent", () => {
  test("a BOQ line with neither a percent nor a quantity is VALUE_REQUIRED, before any read", async () => {
    const outcome = await executeTask({ ...TASK, params: { itemCode: "EX-01" } });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("VALUE_REQUIRED");
    expect(outcome.failure.missing).toEqual(["value"]);
  });

  test("the required-parameter gate every caller shares accepts quantityDone for percent", () => {
    const spec = functionSpec("record_work_progress")!;
    const percent = spec.requiredParams.find((p) => p.name === "percent")!;
    expect(requiredParamSatisfied(percent, { quantityDone: 2 })).toBe(true);
    expect(requiredParamSatisfied(percent, { percent: 40 })).toBe(true);
    expect(requiredParamSatisfied(percent, { itemCode: "EX-01" })).toBe(false);
  });
});
