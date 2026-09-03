import { describe, expect, test } from "bun:test";
import {
  FUNCTION_SLOTS,
  SLOT_ERROR_CODES,
  firstMissingCode,
  functionSlots,
  missingSlots,
  slotCode,
} from "./function-slots";

describe("the slot table", () => {
  test("only WRITE functions declare slots", () => {
    expect(Object.keys(FUNCTION_SLOTS).sort()).toEqual(["record_timesheet", "record_work_progress"]);
  });

  test("every declared code is in the closed vocabulary", () => {
    for (const slots of Object.values(FUNCTION_SLOTS)) {
      for (const slot of slots) expect(SLOT_ERROR_CODES).toContain(slot.code);
    }
  });

  test("C-03's four timesheet slots, in the order they are asked", () => {
    expect(functionSlots("record_timesheet").map((s) => s.name)).toEqual([
      "task",
      "hours",
      "spentOn",
      "activityType",
    ]);
  });

  test("a function with no declared slots is not an error", () => {
    expect(functionSlots("get_construction_budget_status")).toEqual([]);
    expect(missingSlots("get_construction_budget_status", {})).toEqual([]);
  });
});

describe("missingSlots", () => {
  test("empty params ask for every required slot, in declaration order", () => {
    expect(missingSlots("record_work_progress", {})).toEqual(["itemCode", "percent"]);
    expect(missingSlots("record_timesheet", {})).toEqual(["task", "hours"]);
  });

  test("an optional slot is never asked for", () => {
    expect(missingSlots("record_timesheet", { task: "joinery", hours: 3 })).toEqual([]);
  });

  test("the resolved id satisfies the slot the person names", () => {
    expect(missingSlots("record_timesheet", { issueId: "abc", hours: "3" })).toEqual([]);
    expect(missingSlots("record_work_progress", { boqLineItemId: "abc", percent: 50 })).toEqual([]);
  });

  test("blank, null and NaN are missing, not present", () => {
    expect(missingSlots("record_timesheet", { task: "   ", hours: 3 })).toEqual(["task"]);
    expect(missingSlots("record_timesheet", { task: "joinery", hours: null })).toEqual(["hours"]);
    expect(missingSlots("record_work_progress", { itemCode: "PP1", percent: Number.NaN })).toEqual(["percent"]);
  });

  test("zero is a real value, not a missing one", () => {
    expect(missingSlots("record_work_progress", { itemCode: "PP1", percent: 0 })).toEqual([]);
  });
});

describe("the code for a slot", () => {
  test("each slot maps to its own D-03 code", () => {
    expect(slotCode("record_work_progress", "itemCode")).toBe("BOQ_LINE_REQUIRED");
    expect(slotCode("record_work_progress", "percent")).toBe("VALUE_REQUIRED");
    expect(slotCode("record_timesheet", "task")).toBe("TASK_REQUIRED");
    expect(slotCode("record_timesheet", "hours")).toBe("VALUE_REQUIRED");
  });

  test("an alias resolves to the same code as the slot it satisfies", () => {
    expect(slotCode("record_work_progress", "boqLineItemId")).toBe("BOQ_LINE_REQUIRED");
    expect(slotCode("record_timesheet", "issueId")).toBe("TASK_REQUIRED");
  });

  test("an unknown param has no code rather than a wrong one", () => {
    expect(slotCode("record_work_progress", "somethingElse")).toBeNull();
  });

  test("firstMissingCode names the one question to ask now", () => {
    expect(firstMissingCode("record_work_progress", {})).toBe("BOQ_LINE_REQUIRED");
    expect(firstMissingCode("record_work_progress", { itemCode: "PP1" })).toBe("VALUE_REQUIRED");
    expect(firstMissingCode("record_work_progress", { itemCode: "PP1", percent: 50 })).toBeNull();
    expect(firstMissingCode("record_timesheet", { hours: 3 })).toBe("TASK_REQUIRED");
  });
});
