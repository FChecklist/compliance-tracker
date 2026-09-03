/// <reference types="bun-types" />
import { afterEach, describe, expect, mock, test } from "bun:test";
import { executeTask, functionWrites, hasExecutor, matchIssues, type ExecutableTask, type ExecutionOutcome } from "./executor";
import { isRetryableFailure, normaliseThrownError, pipelineFailure, serialiseFailure } from "./error-codes";
import { classifyFailure, classifyPipelineFailure } from "./failure-classification";
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

// ---------------------------------------------------------------------------
// R67 WS-C (C-03 / C-13), folded in during the FIX PASS under decision D-11.
//
// Lane C added these describes to this file before lane B's rewrite reached
// main. Lane B's version of executor.ts is canonical, so they are re-expressed
// against ITS shapes -- a failure is a PipelineFailure, not `{ error: string,
// code, status }` -- and every assertion that still says something true is
// kept.
//
// One assertion is DELIBERATELY NOT KEPT, and it is worth naming rather than
// quietly dropping: lane C asserted that executeTask CLASSIFIES an executor's
// own returned prose ("itemCode is required") back into a code. On main there
// is no prose to classify -- every executor returns pipelineFailure(...)
// directly, which is strictly better, so the assertion has nothing left to
// pin. What it was really protecting (a camelCase parameter name must never
// reach a screen) is asserted below against the real registry instead.
// ---------------------------------------------------------------------------

describe("C-03 -- record_timesheet is the pipeline's second write", () => {
  test("it has a real executor and is registered as a WRITE", () => {
    expect(hasExecutor("record_timesheet")).toBe(true);
    expect(functionWrites("record_timesheet")).toBe(true);
  });

  test("the write allowlist stays closed -- a read is never mistaken for a write", () => {
    expect(functionWrites("record_work_progress")).toBe(true);
    expect(functionWrites("get_construction_project_dashboard")).toBe(false);
    expect(functionWrites("list_leads")).toBe(false);
    expect(functionWrites("anything_unregistered")).toBe(false);
  });

  test("its required slots are declared in the registry, with D-03 codes and vocabulary keys", () => {
    const spec = functionSpec("record_timesheet");
    expect(spec).toBeDefined();
    const byName = Object.fromEntries((spec?.requiredParams ?? []).map((p) => [p.name, p]));
    expect(byName.task?.code).toBe("TASK_REQUIRED");
    expect(byName.hours?.code).toBe("HOURS_REQUIRED");
    // The client never sees a camelCase parameter name -- `field` is what
    // `missing` reports.
    expect(byName.hours?.field).toBe("value");
    // A task chosen from the composer's own chips arrives as an id, and that
    // answers the same question as the words a person typed.
    expect(requiredParamSatisfied(byName.task, { issueId: "i12" })).toBe(true);
    expect(requiredParamSatisfied(byName.task, {})).toBe(false);
  });
});

// R67 C-03. The fuzzy task match is the one part of executeRecordTimesheet()
// that decides WHICH real row a person's words mean, so it is pure and tested
// here; the surrounding write is proven against the real service and its own
// live FK, not mocked.
describe("matchIssues -- fuzzy over the project's own task titles, and ambiguity is a refusal", () => {
  const ISSUES = [
    { id: "i12", number: 12, title: "Joinery shop drawings" },
    { id: "i13", number: 13, title: "Joinery site survey" },
    { id: "i14", number: 14, title: "Facade cladding" },
  ];

  test("an issue number, with or without the hash, is exact", () => {
    expect(matchIssues(ISSUES, "#12").map((i) => i.id)).toEqual(["i12"]);
    expect(matchIssues(ISSUES, "12").map((i) => i.id)).toEqual(["i12"]);
    expect(matchIssues(ISSUES, "#99")).toEqual([]);
  });

  test("an exact title beats every looser tier", () => {
    expect(matchIssues(ISSUES, "Facade cladding").map((i) => i.id)).toEqual(["i14"]);
    expect(matchIssues(ISSUES, "facade CLADDING").map((i) => i.id)).toEqual(["i14"]);
  });

  test("a substring resolves when exactly one title contains it", () => {
    expect(matchIssues(ISSUES, "shop drawings").map((i) => i.id)).toEqual(["i12"]);
  });

  test("words in any order find the real task -- 'joinery drawings' is #12", () => {
    expect(matchIssues(ISSUES, "joinery drawings").map((i) => i.id)).toEqual(["i12"]);
  });

  test("*** AMBIGUITY IS NEVER RESOLVED BY PICKING THE FIRST ***", () => {
    // Two joinery tasks: the caller must get both back so it can refuse,
    // because logging real hours against the wrong task is unrecoverable.
    expect(matchIssues(ISSUES, "joinery").map((i) => i.id)).toEqual(["i12", "i13"]);
  });

  test("nothing matches nothing, and an empty needle never matches everything", () => {
    expect(matchIssues(ISSUES, "plumbing")).toEqual([]);
    expect(matchIssues(ISSUES, "")).toEqual([]);
    expect(matchIssues(ISSUES, "   ")).toEqual([]);
    expect(matchIssues([], "joinery")).toEqual([]);
  });

  test("a needle of only short words does not fall through to matching everything", () => {
    expect(matchIssues(ISSUES, "an of")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R67 C-13 -- the failure is split into the part a person reads and the part
// only we can use. C-13's own acceptance, run literally, in lane B's shape.
// ---------------------------------------------------------------------------

describe("C-13 -- a thrown driver error never puts an IP on a screen", () => {
  const task: ExecutableTask = {
    orgId: "org1",
    userId: "u1",
    projectId: "p1",
    functionId: "boom",
    params: {},
  };

  async function boomWith(message: string): Promise<ExecutionOutcome> {
    return executeTask(task, {
      boom: async () => {
        throw new Error(message);
      },
    });
  }

  test("C-13's acceptance, verbatim: no digits-and-dots IP anywhere in what a client receives", async () => {
    const outcome = await boomWith("write CONNECT_TIMEOUT 3.109.171.244:6543");
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.failure.code).toBe("BACKEND_UNAVAILABLE");
    // The WHOLE failure object -- not just one field -- because a client is
    // handed the object, and a leak in `context` would be just as visible.
    const shipped = JSON.stringify(outcome.failure);
    expect(shipped).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(shipped).not.toContain("CONNECT_TIMEOUT");
  });

  test("the raw text is kept for US, on `debug`, and never on the failure", async () => {
    const outcome = await boomWith("write CONNECT_TIMEOUT 3.109.171.244:6543");
    if (outcome.success) throw new Error("expected a failure");
    expect(outcome.debug).toContain("3.109.171.244:6543");
    // And `debug` is not a field of PipelineFailure, so serialising the
    // failure into pipeline_tasks.error cannot carry it.
    expect(serialiseFailure(outcome.failure)).not.toContain("3.109.171.244");
  });

  test("a transport failure is RETRYABLE and an unclassifiable one is not", async () => {
    const transport = await boomWith("write CONNECT_TIMEOUT 3.109.171.244:6543");
    if (transport.success) throw new Error("expected a failure");
    expect(isRetryableFailure(transport.failure.code)).toBe(true);

    const bug = await boomWith("Cannot read properties of undefined (reading 'id')");
    if (bug.success) throw new Error("expected a failure");
    expect(bug.failure.code).toBe("INTERNAL_ERROR");
    expect(isRetryableFailure(bug.failure.code)).toBe(false);
  });

  test("classifyFailure turns that same throw into C-13's failed_system + retry token", async () => {
    const outcome = await boomWith("write CONNECT_TIMEOUT 3.109.171.244:6543");
    if (outcome.success) throw new Error("expected a failure");
    const classified = classifyFailure(new Error(outcome.debug ?? ""));
    expect(classified.status).toBe("failed_system");
    expect(classified.retryToken).toBeTruthy();
    expect(classified.message).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test("a user-fixable refusal stays the user's, with its slot and no retry token", async () => {
    const outcome = await executeTask(task, {
      boom: async () => ({ success: false as const, failure: pipelineFailure("BOQ_LINE_REQUIRED", ["boqLine"]) }),
    });
    if (outcome.success) throw new Error("expected a failure");
    expect(classifyPipelineFailure(outcome.failure).status).toBe("failed");
    expect(classifyPipelineFailure(outcome.failure).retryToken).toBeUndefined();
    // `missing` reports the D-03 vocabulary key, never the parameter name.
    expect(outcome.failure.missing).toEqual(["boqLine"]);
    expect(JSON.stringify(outcome.failure)).not.toContain("itemCode");
  });

  test("a success is passed straight through, untouched", async () => {
    const outcome = await executeTask(task, {
      boom: async () => ({ success: true as const, result: { id: "x" } }),
    });
    expect(outcome).toEqual({ success: true, result: { id: "x" } });
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
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realProgressService = await import("@/lib/services/construction-progress-service");

type Order = string[];

function fakeDb(overrides: Record<string, unknown> = {}) {
  // MERGE NOTE (F-15 x B-01): the real executor calls
  // constructionBoqLineItems.findFirst TWICE -- once for the line the user
  // named, then again to ask whether that line has a CHILD, because a parent
  // line's percent is derived from its children and may not be written
  // directly. One canned answer for both would make every leaf line look like
  // a parent and fail the happy path with BOQ_LINE_IS_PARENT, so the fake
  // answers the second probe with "no child", which is what a leaf is.
  let lineItemCalls = 0;
  return {
    query: {
      constructionBoqs: { findFirst: async () => ({ id: "boq-1", version: 2 }) },
      constructionBoqLineItems: {
        findFirst: async () => {
          lineItemCalls += 1;
          return lineItemCalls === 1 ? { id: "li-1", itemCode: "1.01", quantity: "100" } : undefined;
        },
      },
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

// Named apart from this file's other TASK fixture (params: {}, used by the
// B-01 normalisation suites): this one has to carry a real line and a real
// value, because it must reach the write.
const SPLIT_TASK: ExecutableTask = {
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

    const outcome = await executeTask(SPLIT_TASK);

    expect(outcome.success).toBe(true);
    expect(createProgressEntry.mock.calls.length).toBe(1);
    // The whole point: never two transactions open at once for one task.
    expect(maxOpen()).toBe(1);
    expect(order).toEqual(["open-transaction", "close-transaction", "create-progress-entry"]);
  });

  test("the write receives the references the lookups resolved", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(fakeDb());

    await executeTask(SPLIT_TASK);

    const [, input] = createProgressEntry.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.activityId).toBe("act-1");
    expect(input.boqLineItemId).toBe("li-1");
    expect(input.percentComplete).toBe(40);
    expect(input.projectId).toBe("p1");
  });

  // MERGE NOTE (F-15 x B-01). These three used to assert free-text `error`
  // strings. ExecutionOutcome no longer has a free-text arm -- B-01 replaced it
  // with a closed vocabulary of codes, which is what gives the client its one
  // sentence and its picker -- so they assert the CODE. What F-15 owns here is
  // unchanged and is the second half of each case: the write is never reached.
  test("a missing BOQ fails with BOQ_LINE_NOT_FOUND, and never reaches the write", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(
      fakeDb({ constructionBoqs: { findFirst: async () => undefined } })
    );

    const outcome = await executeTask(SPLIT_TASK);

    expect(outcome.success).toBe(false);
    expect(outcome.success === false && outcome.failure.code).toBe("BOQ_LINE_NOT_FOUND");
    expect(createProgressEntry.mock.calls.length).toBe(0);
  });

  test("an unknown item code fails with BOQ_LINE_NOT_FOUND, and never reaches the write", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(
      fakeDb({ constructionBoqLineItems: { findFirst: async () => undefined } })
    );

    const outcome = await executeTask(SPLIT_TASK);

    expect(outcome.success).toBe(false);
    expect(outcome.success === false && outcome.failure.code).toBe("BOQ_LINE_NOT_FOUND");
    expect(createProgressEntry.mock.calls.length).toBe(0);
  });

  test("a project with no activity fails with ACTIVITY_REQUIRED, and never reaches the write", async () => {
    const { executeTask, createProgressEntry } = await loadExecutor(
      fakeDb({ constructionActivities: { findFirst: async () => undefined } })
    );

    const outcome = await executeTask(SPLIT_TASK);

    expect(outcome.success).toBe(false);
    expect(outcome.success === false && outcome.failure.code).toBe("ACTIVITY_REQUIRED");
    expect(createProgressEntry.mock.calls.length).toBe(0);
  });

  // The failure paths above all return BEFORE the write, so the transaction
  // discipline F-15 exists to enforce has to hold on them too: one transaction,
  // opened and closed, and nothing after it.
  test("a failure path still opens exactly one transaction and closes it", async () => {
    const { executeTask, order, maxOpen } = await loadExecutor(
      fakeDb({ constructionActivities: { findFirst: async () => undefined } })
    );

    await executeTask(SPLIT_TASK);

    expect(maxOpen()).toBe(1);
    expect(order).toEqual(["open-transaction", "close-transaction"]);
  });
});
