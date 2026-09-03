/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { executeTask, functionWrites, hasExecutor, matchIssues } from "./executor";

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

  // R67 C-03 -- the second write.
  test("record_timesheet has a real executor and is registered as a WRITE", () => {
    expect(hasExecutor("record_timesheet")).toBe(true);
    expect(functionWrites("record_timesheet")).toBe(true);
  });

  test("the write allowlist stays closed -- a read is never mistaken for a write", () => {
    expect(functionWrites("record_work_progress")).toBe(true);
    expect(functionWrites("get_construction_project_dashboard")).toBe(false);
    expect(functionWrites("list_leads")).toBe(false);
    expect(functionWrites("anything_unregistered")).toBe(false);
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
// R67 C-13 -- executeTask() classifies every failure it returns.
//
// This is C-13's own acceptance, run literally. The registry is injected
// through executeTask's last parameter (a test seam with a default, so no
// production call site passes it): every real executor does real DB work, and
// what is being asserted here is what executeTask does with a THROWN driver
// error, which cannot be reached without one.
// ---------------------------------------------------------------------------

describe("executeTask -- a thrown driver error becomes a system failure, not an IP on a screen", () => {
  const task = {
    orgId: "org1",
    userId: "u1",
    projectId: "p1",
    functionId: "boom",
    params: {},
  };

  test("C-13's acceptance, verbatim", async () => {
    const outcome = await executeTask(task, {
      boom: async () => {
        throw new Error("write CONNECT_TIMEOUT 3.109.171.244:6543");
      },
    });
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    expect(outcome.status).toBe("failed_system");
    expect(outcome.code).toBe("INFRA_UNAVAILABLE");
    // "the user-facing message it returns contains no digits-and-dots IP substring"
    expect(outcome.error).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(outcome.error).not.toContain("CONNECT_TIMEOUT");
  });

  test("the raw text is kept for us, on `details`, and is not the message", async () => {
    const outcome = await executeTask(task, {
      boom: async () => {
        throw new Error("write CONNECT_TIMEOUT 3.109.171.244:6543");
      },
    });
    if (outcome.success) throw new Error("expected a failure");
    expect(outcome.details).toBe("write CONNECT_TIMEOUT 3.109.171.244:6543");
    expect(outcome.retryToken).toBeTruthy();
  });

  test("an executor's own returned failure is classified too, and keeps its slot", async () => {
    const outcome = await executeTask(task, {
      boom: async () => ({ success: false as const, error: "itemCode is required" }),
    });
    if (outcome.success) throw new Error("expected a failure");
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("BOQ_LINE_REQUIRED");
    expect(outcome.missing).toEqual(["itemCode"]);
  });

  test("an unregistered function is a gap with a code, not a mystery", async () => {
    const outcome = await executeTask({ ...task, functionId: "nope" }, {});
    if (outcome.success) throw new Error("expected a failure");
    expect(outcome.code).toBe("FUNCTION_NOT_AVAILABLE");
    expect(outcome.status).toBe("failed");
  });

  test("a success is passed straight through, untouched", async () => {
    const outcome = await executeTask(task, {
      boom: async () => ({ success: true as const, result: { id: "x" } }),
    });
    expect(outcome).toEqual({ success: true, result: { id: "x" } });
  });

  test("an executor that already knows its own code keeps it", async () => {
    const outcome = await executeTask(task, {
      boom: async () => ({ success: false as const, error: "anything", code: "PROJECT_REQUIRED" }),
    });
    if (outcome.success) throw new Error("expected a failure");
    expect(outcome.code).toBe("PROJECT_REQUIRED");
    expect(outcome.error).toBe("anything");
  });
});
