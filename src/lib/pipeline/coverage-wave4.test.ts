/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05d, register row AW-304 -- coverage wave 4: work progress, attendance, the roster and site materials are callable
// by an AI through a project link, and by the internal pipeline, as the person's role and the project allow.
//
// THE NINE FUNCTIONS OF THIS PACKAGE (create_activity, the tenth of the wave's list, is WP-07's and has its own test)
//   create_progress_category (level 1, rank 2)   update_progress_entry (level 1, rank 2)   get_daily_progress_report (level 0, rank 2)
//   record_attendance_batch (level 1, rank 2)    update_roster_entry (level 2, rank 2)
//   record_material_issue (level 1, rank 2)      create_material (level 2, rank 2)
//   void_material_receipt (level 2, rank 3)      get_material_cost_report (level 0, rank 3)
//
// WHAT IS PROVEN, for every function (coverage-suite.ts, registered once per function below): the generated link policy is this table; the
// valid parameters are a valid check on a manager's link; a level-2 function is refused on the direct path and is a proposal; a viewer's
// link does not carry it, nor a member's a manager-rank function; a missing required parameter is 422 with `missing` on the direct path and
// is named on a check; the executor names a missing parameter and writes nothing; another project in params.projectId is
// PROJECT_NOT_REACHABLE; a role below the minimum rank, and no role, is refused; a write that names no person is refused; an id of another
// project, of another organisation or of no record reads as absent and the store is byte-identical afterwards; every free-text parameter is
// capped at 2,000 characters and cleaned by the rule a link submission gets.
// AND, function by function (this file)
//   - money: a daily rate, a unit cost, a day cost and a BOQ line's contract rate are null in the answer below the manager rank, while the
//     write itself is stored in full; a manager sees them;
//   - a valid call writes exactly the rows it should and only in the tables it should, re-read from the store, recorded under the acting
//     person and never under the API key;
//   - the sheet is atomic: one worker of another project in a sheet writes nothing for the others; re-sending a sheet corrects the rows and
//     never duplicates them; the stock on hand is enforced on the real ledger (an issue above it is a 400, a voided receipt is not stock);
//   - the patch of a roster entry and of a progress entry is an allow-list: a field outside it (a vendor, an employee code, the person who
//     recorded it, the entry basis) is never passed on;
//   - a duplicate material name on the project is refused, and the project is checked (the service does not);
//   - the reads pass the project's own id and the parsed options to the service, and strip what an AI does not need (a storage path).
//
// WHAT IS REAL: executor.ts, function-registry.ts, the executors of executors/progress.ts, labour.ts and materials.ts, and the services
// createCategory, recordAttendanceBatch, updateRosterEntry, createMaterial, createMaterialIssue and voidMaterialReceipt, run against the
// store double; the free-text rule (ai-link-text.ts); the generated link policy and the Edge handler.
// WHAT IS FAKED: @/lib/db/tenant-scoped (coverage-fixtures.ts), the link's database (awl-edge-fake.ts), and three service functions that
// read with joins and grouped sums the store double does not model: updateProgressEntry (it reads back through four joins),
// getDailyProgressReport and getMaterialCostReport. For those the test asserts the exact arguments the executor passes and what it does with
// the answer; the services' own behaviour is covered by their own tests.
// WHAT IS NOT PROVEN HERE: as in wave 3, the direct path stops at 503 (the executor host is WP-09) and /drafts answers 501 until then.
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave4.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import {
  API_KEY, changedTables, coverageWithTenantContext, makeStore, MANAGER, MEMBER, ORG, PROJECT_A, PROJECT_B, PROJECT_X, seedLabourAndMaterials, seedProgressRecords, snapshot, tableJson,
} from "./__test-helpers__/coverage-fixtures";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const progressCalls = { update: [] as unknown[][], daily: [] as unknown[][] };
const materialCalls = { report: [] as unknown[][] };

const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realProgress = await import("@/lib/services/construction-progress-service");
const realMaterials = await import("@/lib/services/construction-materials-service");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: coverageWithTenantContext(() => store) }));
mock.module("@/lib/services/construction-progress-service", () => ({
  ...realProgress,
  updateProgressEntry: async (...args: unknown[]) => {
    progressCalls.update.push(args);
    return { id: args[1], projectId: PROJECT_A, activityId: "act_a", entryDate: "2026-09-02", quantityDone: "3", percentComplete: "30", remarks: "Corrected", boqLineQuantity: "10", boqLineRate: "500", boqLineAmount: "5000" };
  },
  getDailyProgressReport: async (...args: unknown[]) => {
    progressCalls.daily.push(args);
    return {
      projectId: args[1], date: args[2],
      entries: [{ id: "entry_a", activityName: "Frames", percentComplete: "20" }],
      photos: [{ id: "doc_1", name: "frames.jpg", fileType: "image/jpeg", fileUrl: "org_1/private/frames.jpg", createdAt: new Date("2026-09-01T10:00:00Z") }],
    };
  },
}));
mock.module("@/lib/services/construction-materials-service", () => ({
  ...realMaterials,
  getMaterialCostReport: async (...args: unknown[]) => {
    materialCalls.report.push(args);
    return { rows: [{ key: "mat_a", name: "Cement OPC 53", totalCost: 42000 }], totals: { quantity: 100, cost: 42000 }, params: { projectId: args[1] } };
  },
}));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedProgressRecords(store);
  seedLabourAndMaterials(store);
  progressCalls.update.length = 0;
  progressCalls.daily.length = 0;
  materialCalls.report.length = 0;
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/services/construction-progress-service", () => realProgress);
  await mock.module("@/lib/services/construction-materials-service", () => realMaterials);
});

const run = (fn: string, params: Row, over: Partial<import("./executor").ExecutableTask> = {}) => executeTask(task(fn, params, over));
const row = (table: string, id: string): Row => rowsOf(store, table).find((r) => r.id === id)!;
const asMember = { role: "member", actorUserId: MEMBER } as const;

const SHEET = [
  { rosterId: "roster_a", status: "present", hoursWorked: 8 },
  { rosterId: "roster_a2", status: "half_day" },
];

const CASES: Case[] = [
  {
    fn: "create_progress_category", level: 1, minRank: 2, money: false, valid: { name: "Ceilings", parentCategoryId: "cat_a" },
    required: [["name", "name"]], text: ["name"], foreign: [["parentCategoryId", "cat_b"]],
  },
  {
    fn: "update_progress_entry", level: 1, minRank: 2, money: true,
    valid: { entryId: "entry_a", quantityDone: 3, percentComplete: 30, entryDate: "2026-09-02", remarks: "Corrected", activityId: "act_a", boqLineItemId: "line_a" },
    required: [["entryId", "value"]], text: ["remarks"], foreign: [["entryId", "entry_b"], ["activityId", "act_b"], ["boqLineItemId", "line_b"]],
  },
  { fn: "get_daily_progress_report", level: 0, minRank: 2, money: false, valid: { date: "2026-09-01" }, required: [["date", "date"]], text: [], foreign: [] },
  {
    fn: "record_attendance_batch", level: 1, minRank: 2, money: true, valid: { date: "2026-09-20", entries: SHEET },
    required: [["date", "date"], ["entries", "worker"]], text: [],
    foreign: [["entries", [{ rosterId: "roster_b", status: "present" }], [{ rosterId: "no_such_record", status: "present" }]]],
  },
  {
    fn: "update_roster_entry", level: 2, minRank: 2, money: true,
    valid: { rosterId: "roster_a", name: "Asha K", trade: "Carpenter", dailyRate: 850, skillLevel: "skilled", isActive: true },
    required: [["rosterId", "worker"]], text: ["name", "trade", "skillLevel"], foreign: [["rosterId", "roster_b"]],
  },
  {
    fn: "record_material_issue", level: 1, minRank: 2, money: false,
    valid: { materialId: "mat_a", quantity: 10, issuedDate: "2026-09-20", boqLineItemId: "line_a", issuedTo: "Falcon gang 3", note: "Level 2 screed" },
    required: [["materialId", "material"], ["quantity", "value"], ["issuedDate", "date"]], text: ["issuedTo", "note"], foreign: [["materialId", "mat_b"], ["boqLineItemId", "line_b"]],
  },
  {
    fn: "create_material", level: 2, minRank: 2, money: true, valid: { name: "Sand, fine", unit: "cum", spec: "Zone II", unitCost: 1800, reorderLevel: 20 },
    required: [["name", "name"], ["unit", "value"]], text: ["name", "unit", "spec"], foreign: [],
  },
  {
    fn: "void_material_receipt", level: 2, minRank: 3, money: true, valid: { receiptId: "rec_a", reason: "Wrong quantity keyed" },
    required: [["receiptId", "value"], ["reason", "value"]], text: ["reason"], foreign: [["receiptId", "rec_b"]],
  },
  {
    fn: "get_material_cost_report", level: 0, minRank: 3, money: true, valid: { from: "2026-09-01", to: "2026-09-30", groupBy: "vendor" },
    required: [], text: [], foreign: [],
  },
];

describe("AW-304: the nine functions are registered and executable; the writes are proposals until a person confirms", () => {
  test("every function has an executor, and it is a write exactly when its level is not 0", () => {
    expect(CASES).toHaveLength(9);
    for (const c of CASES) expect({ fn: c.fn, executor: hasExecutor(c.fn), write: functionWrites(c.fn) }).toEqual({ fn: c.fn, executor: true, write: c.level !== 0 });
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

// ---------------------------------------------------------------------------------------------------------------------------------
describe("create_progress_category", () => {
  test("writes one category on the project, under its parent, and only in construction_categories", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_progress_category", CASES[0].valid));
    expect(out.route).toBe("/work-progress");
    expect(changedTables(before, store)).toEqual(["construction_categories"]);
    expect(row("construction_categories", out.id)).toMatchObject({ orgId: ORG, projectId: PROJECT_A, name: "Ceilings", parentCategoryId: "cat_a" });
  });

  test("a top-level category has no parent; the activity that record_work_progress needs can then be made in it (create_activity, WP-07)", async () => {
    const cat = resultOf(await run("create_progress_category", { name: "Electrical" }));
    expect(row("construction_categories", cat.id).parentCategoryId).toBeNull();
    const act = resultOf(await run("create_activity", { name: "Conduit", categoryId: cat.id }));
    expect(row("construction_activities", act.id)).toMatchObject({ projectId: PROJECT_A, categoryId: cat.id, name: "Conduit" });
  });

  test("a project of another organisation is refused by the service's own project check, and a parent of another project is not accepted", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_progress_category", { name: "X" }, { projectId: PROJECT_X })).code).toBe("RECORD_NOT_FOUND");
    expect(failureOf(await run("create_progress_category", { name: "X", parentCategoryId: "cat_b" })).context).toMatchObject({ param: "parentCategoryId" });
    expect(snapshot(store)).toBe(before);
  });
});

describe("update_progress_entry", () => {
  test("passes the entry and only the fields the card and the two ids name to the service, for the task's own organisation", async () => {
    const out = resultOf(await run("update_progress_entry", { ...CASES[1].valid, recordedById: "someone_else", entryBasis: "SNAPSHOT", projectId: PROJECT_A, employeeCode: "x" }));
    expect(out.id).toBe("entry_a");
    expect(out.route).toBe("/work-progress");
    expect(progressCalls.update).toEqual([[{ orgId: ORG }, "entry_a", { quantityDone: 3, percentComplete: 30, entryDate: "2026-09-02", remarks: "Corrected", activityId: "act_a", boqLineItemId: "line_a" }]]);
  });

  test("only the fields sent are in the patch", async () => {
    resultOf(await run("update_progress_entry", { entryId: "entry_a", percentComplete: "45" }));
    expect(progressCalls.update[0][2]).toEqual({ percentComplete: 45 });
  });

  test("the line's contract rate and amount are null below the manager rank (and the answer says so), and shown to a manager", async () => {
    const manager = resultOf(await run("update_progress_entry", { entryId: "entry_a", percentComplete: 30 })).record as Row;
    expect(manager).toMatchObject({ boqLineRate: "500", boqLineAmount: "5000", boqLineQuantity: "10" });
    expect(manager.financialsRedacted).toBeUndefined();
    const member = resultOf(await run("update_progress_entry", { entryId: "entry_a", percentComplete: 30 }, asMember)).record as Row;
    expect(member).toMatchObject({ boqLineRate: null, boqLineAmount: null, boqLineQuantity: "10", financialsRedacted: true });
  });

  test("an empty patch, a value of the wrong type and a date that is not a real day are refused before the service is reached", async () => {
    for (const bad of [{}, { percentComplete: "x" }, { quantityDone: -1 }, { entryDate: "yesterday" }, { entryDate: "2026-02-30" }, { remarks: 5 }, { activityId: 7 }]) {
      const failure = failureOf(await run("update_progress_entry", { entryId: "entry_a", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(progressCalls.update).toEqual([]);
  });

  test("an entry, an activity or a BOQ line of another project never reaches the service", async () => {
    for (const params of [{ entryId: "entry_b", percentComplete: 10 }, { entryId: "entry_a", activityId: "act_b" }, { entryId: "entry_a", boqLineItemId: "line_b" }, { entryId: "entry_a", boqLineItemId: "no_such_line" }]) {
      expect({ params, code: failureOf(await run("update_progress_entry", params)).code }).toEqual({ params, code: "RECORD_NOT_FOUND" });
    }
    expect(progressCalls.update).toEqual([]);
  });
});

describe("get_daily_progress_report", () => {
  test("asks the service for the task's own project and the day, and returns the entries and the names of the day's documents, never a storage path", async () => {
    const res = await run("get_daily_progress_report", { date: "2026-09-01" });
    expect(res.success).toBe(true);
    const result = (res as { result: Row }).result;
    expect(progressCalls.daily).toEqual([[{ orgId: ORG }, PROJECT_A, "2026-09-01"]]);
    expect(result).toMatchObject({ projectId: PROJECT_A, date: "2026-09-01", entries: [{ id: "entry_a" }], photos: [{ id: "doc_1", name: "frames.jpg", fileType: "image/jpeg" }] });
    expect(JSON.stringify(result)).not.toContain("fileUrl");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  test("a date that is not a real day is refused before the service is reached", async () => {
    for (const date of ["2026-02-30", "1 Sep", 20260901, "  "]) expect({ date, ok: (await run("get_daily_progress_report", { date })).success }).toEqual({ date, ok: false });
    expect(progressCalls.daily).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("record_attendance_batch", () => {
  test("marks the whole sheet in one call: two rows, each day cost from the worker's own rate, only in construction_attendance", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("record_attendance_batch", CASES[3].valid));
    expect(out.route).toBe("/labour?tab=attendance");
    expect(changedTables(before, store)).toEqual(["construction_attendance"]);
    const rows = rowsOf(store, "construction_attendance");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.rosterId === "roster_a")).toMatchObject({ projectId: PROJECT_A, attendanceDate: "2026-09-20", status: "present", hoursWorked: "8", dailyCost: "800" });
    expect(rows.find((r) => r.rosterId === "roster_a2")).toMatchObject({ status: "half_day", hoursWorked: null, dailyCost: "350" });
    expect((out.record as Row)).toMatchObject({ savedCount: 2, createdCount: 2, updatedCount: 0, totalCost: 1150 });
  });

  test("the day cost and the sheet total are null below the manager rank (the rows are stored in full), and shown to a manager", async () => {
    const member = resultOf(await run("record_attendance_batch", CASES[3].valid, asMember)).record as { attendance: Row[]; totalCost: unknown; financialsRedacted: boolean };
    expect(member.totalCost).toBeNull();
    expect(member.financialsRedacted).toBe(true);
    for (const a of member.attendance) expect(a.dailyCost).toBeNull();
    expect(rowsOf(store, "construction_attendance").map((r) => r.dailyCost).sort()).toEqual(["350", "800"]);
  });

  test("re-sending the sheet corrects the rows and never duplicates them", async () => {
    resultOf(await run("record_attendance_batch", CASES[3].valid));
    const again = resultOf(await run("record_attendance_batch", { date: "2026-09-20", entries: [{ rosterId: "roster_a", status: "half_day", hoursWorked: 4 }, { rosterId: "roster_a2", status: "present" }] }));
    expect(again.record).toMatchObject({ savedCount: 2, createdCount: 0, updatedCount: 2, totalCost: 1100 });
    const rows = rowsOf(store, "construction_attendance");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.rosterId === "roster_a")).toMatchObject({ status: "half_day", hoursWorked: "4", dailyCost: "400" });
  });

  test("the sheet is atomic: one worker of another project writes nothing for the others", async () => {
    const before = snapshot(store);
    const failure = failureOf(await run("record_attendance_batch", { date: "2026-09-20", entries: [{ rosterId: "roster_a", status: "present" }, { rosterId: "roster_b", status: "present" }] }));
    expect(failure).toMatchObject({ code: "RECORD_NOT_FOUND", context: { param: "rosterId" } });
    expect(snapshot(store)).toBe(before);
  });

  test("a sheet that is not a list, is empty, names a status outside the three, hours outside a day, no worker or the same worker twice is refused with nothing written", async () => {
    const before = snapshot(store);
    const many = Array.from({ length: 201 }, () => ({ rosterId: "roster_a" }));
    for (const entries of [
      "roster_a", [], many, [{ status: "present" }], [{ rosterId: "roster_a", status: "late" }], [{ rosterId: "roster_a", hoursWorked: 25 }],
      [{ rosterId: "roster_a", hoursWorked: -1 }], [{ rosterId: "roster_a", hoursWorked: "x" }], [null], [["roster_a"]],
      [{ rosterId: "roster_a" }, { rosterId: "roster_a" }],
    ]) {
      const failure = failureOf(await run("record_attendance_batch", { date: "2026-09-20", entries }));
      expect({ entries: JSON.stringify(entries).slice(0, 60), code: failure.code }).toEqual({ entries: JSON.stringify(entries).slice(0, 60), code: "REQUEST_REJECTED" });
    }
    expect(failureOf(await run("record_attendance_batch", { date: "20 Sep", entries: SHEET })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });

  test("a worker's status defaults to present", async () => {
    resultOf(await run("record_attendance_batch", { date: "2026-09-21", entries: [{ rosterId: "roster_a" }] }));
    expect(rowsOf(store, "construction_attendance")[0]).toMatchObject({ status: "present", dailyCost: "800" });
  });
});

describe("update_roster_entry", () => {
  test("changes the worker's name, trade, rate, skill and active flag, and touches no other worker", async () => {
    const before = tableJson(store);
    const others = JSON.stringify([row("construction_labour_roster", "roster_a2"), row("construction_labour_roster", "roster_b")]);
    const out = resultOf(await run("update_roster_entry", CASES[4].valid));
    expect(out.route).toBe("/labour/roster_a");
    expect(changedTables(before, store)).toEqual(["construction_labour_roster"]);
    expect(row("construction_labour_roster", "roster_a")).toMatchObject({ name: "Asha K", trade: "Carpenter", dailyRate: "850", skillLevel: "skilled", isActive: true });
    expect(JSON.stringify([row("construction_labour_roster", "roster_a2"), row("construction_labour_roster", "roster_b")])).toBe(others);
  });

  test("the patch is an allow-list: an employee code, a vendor, another project or an id in the params are never passed on", async () => {
    resultOf(await run("update_roster_entry", { rosterId: "roster_a", dailyRate: 900, employeeCode: "HACK-1", vendorId: "vendor_9", id: "roster_b", orgId: "org_2" }));
    const after = row("construction_labour_roster", "roster_a");
    expect(after).toMatchObject({ id: "roster_a", orgId: ORG, projectId: PROJECT_A, dailyRate: "900" });
    expect(after.employeeCode).toBeNull();
    expect(after.vendorId).toBeNull();
  });

  test("the daily rate is null in the answer below the manager rank, and stored in full; a manager sees it", async () => {
    const member = resultOf(await run("update_roster_entry", { rosterId: "roster_a", dailyRate: 875 }, asMember)).record as Row;
    expect(member).toMatchObject({ dailyRate: null, financialsRedacted: true, name: "Asha" });
    expect(row("construction_labour_roster", "roster_a").dailyRate).toBe("875");
    const manager = resultOf(await run("update_roster_entry", { rosterId: "roster_a", dailyRate: 880 })).record as Row;
    expect(manager.dailyRate).toBe("880");
  });

  test("an empty patch, a negative or non-numeric rate, a blank name and a flag that is not a boolean are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const bad of [{}, { dailyRate: -1 }, { dailyRate: "abc" }, { name: "   " }, { name: 5 }, { isActive: "yes" }, { trade: 3 }]) {
      const failure = failureOf(await run("update_roster_entry", { rosterId: "roster_a", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a worker can be retired (isActive false) and brought back", async () => {
    resultOf(await run("update_roster_entry", { rosterId: "roster_a", isActive: false }));
    expect(row("construction_labour_roster", "roster_a").isActive).toBe(false);
    resultOf(await run("update_roster_entry", { rosterId: "roster_a", isActive: true }));
    expect(row("construction_labour_roster", "roster_a").isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("record_material_issue", () => {
  test("takes stock out of the site store: one issue row, booked against the BOQ line, created by the acting person, only in its table", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("record_material_issue", CASES[5].valid));
    expect(out.route).toBe("/materials");
    expect(changedTables(before, store)).toEqual(["construction_material_issues"]);
    expect(row("construction_material_issues", out.id)).toMatchObject({
      orgId: ORG, projectId: PROJECT_A, materialId: "mat_a", issuedDate: "2026-09-20", quantity: "10", boqLineItemId: "line_a", issuedTo: "Falcon gang 3", note: "Level 2 screed", createdById: MANAGER,
    });
    expect(row("construction_material_issues", out.id).createdById).not.toBe(API_KEY);
  });

  test("the BOQ line, the person it was issued to and the note are optional", async () => {
    const out = resultOf(await run("record_material_issue", { materialId: "mat_a", quantity: 1, issuedDate: "2026-09-20" }));
    expect(row("construction_material_issues", out.id)).toMatchObject({ boqLineItemId: null, issuedTo: null, note: null });
  });

  test("the stock on hand is enforced on the real ledger: 100 received, so 101 is refused, and two issues add up", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("record_material_issue", { materialId: "mat_a", quantity: 101, issuedDate: "2026-09-20" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
    resultOf(await run("record_material_issue", { materialId: "mat_a", quantity: 60, issuedDate: "2026-09-20" }));
    const second = failureOf(await run("record_material_issue", { materialId: "mat_a", quantity: 41, issuedDate: "2026-09-21" }));
    expect(second.code).toBe("REQUEST_REJECTED");
    resultOf(await run("record_material_issue", { materialId: "mat_a", quantity: 40, issuedDate: "2026-09-21" }));
    expect(rowsOf(store, "construction_material_issues")).toHaveLength(2);
  });

  test("a receipt that has been voided is not stock", async () => {
    resultOf(await run("void_material_receipt", { receiptId: "rec_a", reason: "Never arrived" }));
    expect(failureOf(await run("record_material_issue", { materialId: "mat_a", quantity: 1, issuedDate: "2026-09-20" })).code).toBe("REQUEST_REJECTED");
    expect(rowsOf(store, "construction_material_issues")).toHaveLength(0);
  });

  test("a quantity that is not above zero, a date that is not a real day and a text that is not a string are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const bad of [{ quantity: 0 }, { quantity: -2 }, { quantity: "abc" }, { issuedDate: "2026-02-30" }, { note: 4 }, { issuedTo: ["a"] }, { boqLineItemId: 9 }]) {
      const failure = failureOf(await run("record_material_issue", { materialId: "mat_a", quantity: 1, issuedDate: "2026-09-20", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("the service stores a BOQ line id as it is given, so an id that is on no BOQ of the project is refused here, naming the parameter", async () => {
    const before = snapshot(store);
    for (const boqLineItemId of ["line_b", "no_such_line"]) {
      expect(failureOf(await run("record_material_issue", { ...CASES[5].valid, boqLineItemId })).context).toMatchObject({ param: "boqLineItemId" });
    }
    expect(failureOf(await run("record_material_issue", { ...CASES[5].valid, materialId: "mat_b" })).context).toMatchObject({ param: "materialId" });
    expect(snapshot(store)).toBe(before);
  });
});

describe("create_material", () => {
  test("adds a material to the project's list: every field stored, only in construction_materials", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_material", CASES[6].valid));
    expect(out.route).toBe("/materials");
    expect(changedTables(before, store)).toEqual(["construction_materials"]);
    expect(row("construction_materials", out.id)).toMatchObject({ orgId: ORG, projectId: PROJECT_A, name: "Sand, fine", unit: "cum", spec: "Zone II", unitCost: "1800", reorderLevel: "20" });
  });

  test("the unit cost, the spec and the reorder level are optional (a cost of 0, no threshold)", async () => {
    const out = resultOf(await run("create_material", { name: "Nails", unit: "kg" }));
    expect(row("construction_materials", out.id)).toMatchObject({ unitCost: "0", reorderLevel: null, spec: null });
  });

  test("a second material with the same name on the project is refused (ALREADY_RECORDED) and adds nothing, whatever its case or edge spaces", async () => {
    const before = snapshot(store);
    for (const name of ["Cement OPC 53", "  cement opc 53 ", "CEMENT OPC 53"]) {
      const failure = failureOf(await run("create_material", { name, unit: "bag" }));
      expect({ name, code: failure.code, param: failure.context?.param }).toEqual({ name, code: "ALREADY_RECORDED", param: "name" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("the same name on another project, or as a retired material, is allowed", async () => {
    resultOf(await run("create_material", { name: "Steel TMT", unit: "kg" }));
    store.tables.construction_materials.push({ id: "mat_old", orgId: ORG, projectId: PROJECT_A, name: "Old sand", unit: "cum", unitCost: "0", isActive: false });
    resultOf(await run("create_material", { name: "Old sand", unit: "cum" }));
    expect(rowsOf(store, "construction_materials").filter((r) => r.projectId === PROJECT_A && r.name === "Old sand")).toHaveLength(2);
  });

  test("the unit cost is null in the answer below the manager rank (and stored in full), and shown to a manager", async () => {
    const member = resultOf(await run("create_material", { name: "Bricks", unit: "nos", unitCost: 9 }, asMember)).record as Row;
    expect(member).toMatchObject({ unitCost: null, financialsRedacted: true, name: "Bricks" });
    expect(rowsOf(store, "construction_materials").find((r) => r.name === "Bricks")!.unitCost).toBe("9");
    expect((resultOf(await run("create_material", { name: "Blocks", unit: "nos", unitCost: 11 })).record as Row).unitCost).toBe("11");
  });

  test("a negative cost, a threshold that is not a number and a text that is not a string are refused; the project is checked because the service does not", async () => {
    const before = snapshot(store);
    for (const bad of [{ unitCost: -1 }, { unitCost: "cheap" }, { reorderLevel: "x" }, { spec: 5 }, { unit: 3 }]) {
      const failure = failureOf(await run("create_material", { name: "New thing", unit: "nos", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    for (const projectId of [PROJECT_X, "no_such_project"]) {
      expect({ projectId, param: failureOf(await run("create_material", { name: "New thing", unit: "nos" }, { projectId })).context?.param }).toEqual({ projectId, param: "projectId" });
    }
    expect(snapshot(store)).toBe(before);
  });
});

describe("void_material_receipt", () => {
  test("voids that receipt with the reason and the acting person, keeps the row, and touches no other receipt", async () => {
    const before = tableJson(store);
    const other = JSON.stringify(row("construction_material_receipts", "rec_b"));
    const out = resultOf(await run("void_material_receipt", CASES[7].valid));
    expect(out.id).toBe("rec_a");
    expect(changedTables(before, store)).toEqual(["construction_material_receipts"]);
    expect(row("construction_material_receipts", "rec_a")).toMatchObject({ voidReason: "Wrong quantity keyed", voidedBy: MANAGER, quantity: "100" });
    expect(row("construction_material_receipts", "rec_a").voidedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row("construction_material_receipts", "rec_b"))).toBe(other);
  });

  test("a receipt that is already void is refused (409) and stays as it was", async () => {
    resultOf(await run("void_material_receipt", CASES[7].valid));
    const before = snapshot(store);
    expect(failureOf(await run("void_material_receipt", { receiptId: "rec_a", reason: "Again" })).code).toBe("ALREADY_RECORDED");
    expect(snapshot(store)).toBe(before);
  });

  test("a receipt of another organisation reads as absent, and a reason that is not a string is refused", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("void_material_receipt", { receiptId: "rec_x", reason: "R" })).code).toBe("RECORD_NOT_FOUND");
    expect(failureOf(await run("void_material_receipt", { receiptId: "rec_a", reason: 5 })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });
});

describe("get_material_cost_report", () => {
  test("asks the service for the task's own project and the options as parsed, and returns its answer", async () => {
    const res = await run("get_material_cost_report", CASES[8].valid);
    expect(res.success).toBe(true);
    expect(materialCalls.report).toEqual([[{ orgId: ORG }, PROJECT_A, { from: "2026-09-01", to: "2026-09-30", groupBy: "vendor" }]]);
    expect((res as { result: Row }).result).toMatchObject({ totals: { quantity: 100, cost: 42000 } });
  });

  test("with no options the whole ledger is asked for", async () => {
    resultOf(await run("get_material_cost_report", {}));
    expect(materialCalls.report[0][2]).toEqual({ from: undefined, to: undefined, groupBy: undefined });
  });

  test("a date that is not a real day and a grouping outside the two are refused before the service is reached", async () => {
    for (const bad of [{ from: "2026-9-1" }, { to: "31 Sep" }, { groupBy: "supplier" }, { groupBy: 3 }]) {
      const failure = failureOf(await run("get_material_cost_report", bad));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(materialCalls.report).toEqual([]);
  });

  test("it states costs, so a member is refused and the service is never asked", async () => {
    expect(failureOf(await run("get_material_cost_report", {}, asMember)).code).toBe("NOT_PERMITTED");
    expect(materialCalls.report).toEqual([]);
  });
});

describe("a call refused before the service leaves the services of the wave untouched", () => {
  test("a project of another project's id never reaches the mocked services (the reads and update_progress_entry)", async () => {
    await run("update_progress_entry", { entryId: "entry_b", percentComplete: 10 });
    await run("get_daily_progress_report", { date: "2026-09-01", projectId: PROJECT_B });
    await run("get_material_cost_report", { projectId: PROJECT_B });
    expect([progressCalls.update.length, progressCalls.daily.length, materialCalls.report.length]).toEqual([0, 0, 0]);
  });
});
