/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { functionWrites, hasExecutor, matchIssues } from "./executor";

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
