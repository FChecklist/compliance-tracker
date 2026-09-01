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
