/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-07, register row AW-331 (the row is not on the plan branch's register yet; see the report): record_work_progress
// honours `remarks` and `entryDate` and works on a project that has no activity; create_activity is a level-1 link function.
//
// PROVEN HERE
//   - entryDate: the entry is stored on the date the caller names (backdating the day's work is the point); with none it is today (UTC); a date
//     that is not a real YYYY-MM-DD is DATE_REQUIRED; a date more than a day past the server's UTC date is VALUE_OUT_OF_RANGE (work that has not
//     happened); each refusal writes nothing;
//   - remarks: stored on the entry, trimmed; a non-string or one over 2,000 characters is refused with the reason;
//   - a project with no activity: record_work_progress makes ONE category "General" and ONE activity "General work" through the progress
//     service, writes the entry against it, and a second call reuses both (still one of each); an existing activity is used and none is made;
//     an existing "General" category is reused;
//   - the quantity route (quantityDone) and the percent route both still reach the entry, with the date and remarks;
//   - create_activity: with a categoryId of the project, or with none (the project's "General", made when missing); a category of another
//     project is absent, whichever id is named; a name is required; a negative planned quantity is refused; no person or a role below member is
//     refused; another org's project is absent; and on links it is level 1, rank 2, with categoryId an id parameter and remarks, entryDate declared
//     on record_work_progress.
//
// WHAT IS REAL: executor.ts, executors/activity.ts, construction-progress-service.ts (createCategory, createActivity, createProgressEntry).
// WHAT IS FAKED: only @/lib/db/tenant-scoped, by __test-helpers__/boq-store-double.ts.
//
// Run: bun test --isolate src/lib/pipeline/executor-work-progress.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PROJECT = "project_a";
const PROJECT_B = "project_b";
const PROJECT_OTHER_ORG = "project_x";
const PERSON = "person_1";
const API_KEY = "apikey_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT, orgId: ORG, name: "Zoomies Dubai", status: "active" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood", status: "active" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere", status: "active" },
  ]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  seedRows(s, "construction_boqs", [{ id: "boq_1", orgId: ORG, projectId: PROJECT, version: 1, title: "Zoomies BOQ", status: "approved", createdById: PERSON }]);
  seedRows(s, "construction_boq_line_items", [
    { id: "li_1", orgId: ORG, boqId: "boq_1", itemCode: "EX-01", description: "Excavation", unit: "cum", quantity: "100", rate: "10", amount: "1000" },
  ]);
  return s;
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let hasExecutor: typeof import("./executor").hasExecutor;
let functionWrites: typeof import("./executor").functionWrites;
beforeAll(async () => {
  ({ executeTask, hasExecutor, functionWrites } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

type Task = import("./executor").ExecutableTask;
type Outcome = Awaited<ReturnType<typeof executeTask>>;
const progress = (params: Row, overrides: Partial<Task> = {}): Promise<Outcome> =>
  executeTask({ orgId: ORG, userId: API_KEY, projectId: PROJECT, functionId: "record_work_progress", params, actorUserId: PERSON, role: "manager", ...overrides });
const activity = (params: Row, overrides: Partial<Task> = {}): Promise<Outcome> =>
  executeTask({ orgId: ORG, userId: API_KEY, projectId: PROJECT, functionId: "create_activity", params, actorUserId: PERSON, role: "manager", ...overrides });
const codeOf = (o: Outcome) => (o.success ? "OK" : o.failure.code);
const entries = () => rowsOf(store, "construction_work_progress_entries");
const categories = () => rowsOf(store, "construction_categories");
const activities = () => rowsOf(store, "construction_activities");
const snapshot = () => JSON.stringify(store.tables);
const today = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("AW-331: record_work_progress honours entryDate and remarks", () => {
  beforeEach(() => {
    seedRows(store, "construction_categories", [{ id: "cat_1", orgId: ORG, projectId: PROJECT, name: "Civil" }]);
    seedRows(store, "construction_activities", [{ id: "act_1", orgId: ORG, projectId: PROJECT, categoryId: "cat_1", name: "Earthwork" }]);
  });

  test("*** THE ROW: the entry is stored on the date named and carries the remarks, read back from the stored row ***", async () => {
    const outcome = await progress({ itemCode: "EX-01", percent: 40, entryDate: "2026-09-20", remarks: "  Excavation to formation level complete  " });
    expect(codeOf(outcome)).toBe("OK");
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      orgId: ORG, projectId: PROJECT, activityId: "act_1", boqLineItemId: "li_1", entryDate: "2026-09-20", percentComplete: "40",
      remarks: "Excavation to formation level complete",
    });
  });

  test("with no date the entry is today's (UTC), as before, and with no remarks the column is empty", async () => {
    await progress({ itemCode: "EX-01", percent: 10 });
    expect(entries()[0].entryDate).toBe(today());
    expect(entries()[0].remarks).toBeNull();
    await progress({ itemCode: "EX-01", percent: 20, entryDate: "", remarks: "   " });
    expect(entries()[1]).toMatchObject({ entryDate: today(), remarks: null });
  });

  test("the quantity route carries the date and remarks too, and the percent is converted from the line's quantity", async () => {
    await progress({ itemCode: "EX-01", quantityDone: 25, entryDate: "2026-09-18", remarks: "quantity route" });
    expect(entries()[0]).toMatchObject({ entryDate: "2026-09-18", remarks: "quantity route", percentComplete: "25", quantityDone: "25" });
  });

  test("a date that is not a real YYYY-MM-DD is DATE_REQUIRED and writes nothing", async () => {
    const before = snapshot();
    for (const entryDate of ["20/09/2026", "2026-9-2", "2026-02-30", "2026-13-01", "yesterday", "2026-09-20T10:00:00Z", 20260920, {}, true, "0000-00-00"]) {
      const outcome = await progress({ itemCode: "EX-01", percent: 40, entryDate });
      expect({ entryDate, code: codeOf(outcome) }).toEqual({ entryDate, code: "DATE_REQUIRED" });
      expect(!outcome.success && outcome.failure.missing).toEqual(["date"]);
    }
    expect(snapshot()).toBe(before);
  });

  test("a date more than a day past the UTC date is VALUE_OUT_OF_RANGE; today and tomorrow (a site ahead of UTC) are accepted", async () => {
    const before = snapshot();
    for (const entryDate of [daysFromToday(2), daysFromToday(30), "9999-12-31"]) {
      expect({ entryDate, code: codeOf(await progress({ itemCode: "EX-01", percent: 40, entryDate })) }).toEqual({ entryDate, code: "VALUE_OUT_OF_RANGE" });
    }
    expect(snapshot()).toBe(before);
    expect(codeOf(await progress({ itemCode: "EX-01", percent: 41, entryDate: today() }))).toBe("OK");
    expect(codeOf(await progress({ itemCode: "EX-01", percent: 42, entryDate: daysFromToday(1) }))).toBe("OK");
    expect(codeOf(await progress({ itemCode: "EX-01", percent: 43, entryDate: "2020-01-01" }))).toBe("OK");
  });

  test("remarks that are not text, or are over 2,000 characters, are refused with the reason; exactly 2,000 is stored", async () => {
    const before = snapshot();
    const wrong = await progress({ itemCode: "EX-01", percent: 40, remarks: 5 });
    expect(codeOf(wrong)).toBe("REQUEST_REJECTED");
    expect(!wrong.success && wrong.failure.context).toMatchObject({ reason: "remarks_type" });
    const long = await progress({ itemCode: "EX-01", percent: 40, remarks: "x".repeat(2001) });
    expect(!long.success && long.failure.context).toMatchObject({ reason: "remarks_too_long", max: 2000 });
    expect(snapshot()).toBe(before);
    expect(codeOf(await progress({ itemCode: "EX-01", percent: 40, remarks: "x".repeat(2000) }))).toBe("OK");
    expect(String(entries()[0].remarks)).toHaveLength(2000);
  });
});

describe("AW-331: a project with no activity", () => {
  test("*** THE ROW: record_work_progress makes one General category and one General work activity, and writes against it ***", async () => {
    expect(activities()).toHaveLength(0);
    const outcome = await progress({ itemCode: "EX-01", percent: 40, entryDate: "2026-09-20", remarks: "first entry on a new project" });
    expect(codeOf(outcome)).toBe("OK");
    expect(categories()).toHaveLength(1);
    expect(activities()).toHaveLength(1);
    expect(categories()[0]).toMatchObject({ orgId: ORG, projectId: PROJECT, name: "General" });
    expect(activities()[0]).toMatchObject({ orgId: ORG, projectId: PROJECT, categoryId: categories()[0].id, name: "General work" });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ activityId: activities()[0].id, boqLineItemId: "li_1", entryDate: "2026-09-20" });
    expect(store.unparsed).toEqual([]);
  });

  test("a second call reuses them: still one category and one activity, and two entries on it", async () => {
    await progress({ itemCode: "EX-01", percent: 20 });
    await progress({ itemCode: "EX-01", percent: 30 });
    expect([categories().length, activities().length, entries().length]).toEqual([1, 1, 2]);
    expect(new Set(entries().map((e) => e.activityId)).size).toBe(1);
  });

  test("an existing General category is reused; an existing activity is used and none is made; another project's activity does not count", async () => {
    seedRows(store, "construction_categories", [{ id: "cat_g", orgId: ORG, projectId: PROJECT, name: "general" }]);
    await progress({ itemCode: "EX-01", percent: 20 });
    expect(categories()).toHaveLength(1);
    expect(activities()[0].categoryId).toBe("cat_g");

    const s2 = fixtures();
    seedRows(s2, "construction_categories", [{ id: "cat_b", orgId: ORG, projectId: PROJECT_B, name: "Civil" }]);
    seedRows(s2, "construction_activities", [{ id: "act_b", orgId: ORG, projectId: PROJECT_B, categoryId: "cat_b", name: "Other project's" }]);
    seedRows(s2, "construction_categories", [{ id: "cat_a", orgId: ORG, projectId: PROJECT, name: "Civil" }]);
    seedRows(s2, "construction_activities", [{ id: "act_a", orgId: ORG, projectId: PROJECT, categoryId: "cat_a", name: "Earthwork" }]);
    store = s2;
    await progress({ itemCode: "EX-01", percent: 20 });
    expect(activities().map((a) => a.id).sort()).toEqual(["act_a", "act_b"]);
    expect(entries()[0].activityId).toBe("act_a");
  });

  test("the transactions are never nested: one open at a time across the lookup, the default activity and the write", async () => {
    await progress({ itemCode: "EX-01", percent: 40 });
    expect(store.maxOpen).toBe(1);
  });

  test("a failed lookup (an unknown line) makes no category or activity", async () => {
    const outcome = await progress({ itemCode: "NOPE", percent: 40 });
    expect(codeOf(outcome)).toBe("BOQ_LINE_NOT_FOUND");
    expect([categories().length, activities().length, entries().length]).toEqual([0, 0, 0]);
  });
});

describe("AW-331: create_activity", () => {
  beforeEach(() => {
    seedRows(store, "construction_categories", [
      { id: "cat_1", orgId: ORG, projectId: PROJECT, name: "Civil" },
      { id: "cat_b", orgId: ORG, projectId: PROJECT_B, name: "Civil B" },
    ]);
  });

  test("registry and link: a level-1 write at rank 2 with an executor; categoryId is an id parameter; record_work_progress declares entryDate and remarks", () => {
    expect(hasExecutor("create_activity")).toBe(true);
    expect(functionWrites("create_activity")).toBe(true);
    const registry = JSON.parse(readFileSync(new URL("../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")) as Array<{
      function_id: string; link_level: number | null; min_role_rank: number; money_sensitive: boolean; id_params: string[]; declared_params: string[]; text_params: string[]
    }>;
    const row = registry.find((f) => f.function_id === "create_activity")!;
    expect({ level: row.link_level, rank: row.min_role_rank, money: row.money_sensitive }).toEqual({ level: 1, rank: 2, money: false });
    expect(row.id_params).toContain("categoryId");
    expect(row.text_params).toEqual(["name", "unit"]);
    const rwp = registry.find((f) => f.function_id === "record_work_progress")!;
    expect(rwp.declared_params).toEqual(expect.arrayContaining(["entryDate", "remarks"]));
    expect(rwp.text_params).toContain("remarks");
  });

  test("*** THE ROW: an activity on the named category of the project is stored with its unit and planned quantity ***", async () => {
    const outcome = await activity({ name: "  Slab casting ", categoryId: "cat_1", unit: "cum", plannedQuantity: 120 });
    expect(codeOf(outcome)).toBe("OK");
    expect(activities()).toHaveLength(1);
    expect(activities()[0]).toMatchObject({ orgId: ORG, projectId: PROJECT, categoryId: "cat_1", name: "Slab casting", unit: "cum", plannedQuantity: "120" });
  });

  test("with no category the project's General is used, and made when it is missing; a second call reuses it", async () => {
    await activity({ name: "First" });
    await activity({ name: "Second" });
    const general = categories().filter((c) => c.projectId === PROJECT && c.name === "General");
    expect(general).toHaveLength(1);
    expect(activities().map((a) => a.categoryId)).toEqual([general[0].id, general[0].id]);
  });

  test("a category of another project is absent, and so is one that does not exist; nothing is written", async () => {
    const before = snapshot();
    for (const categoryId of ["cat_b", "no-such-category"]) {
      const outcome = await activity({ name: "Slab", categoryId });
      expect({ categoryId, code: codeOf(outcome) }).toEqual({ categoryId, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot()).toBe(before);
  });

  test("a name is required; a negative or non-numeric planned quantity is refused; nothing is written", async () => {
    const before = snapshot();
    expect(codeOf(await activity({}))).toBe("TITLE_REQUIRED");
    expect(codeOf(await activity({ name: "   " }))).toBe("TITLE_REQUIRED");
    for (const plannedQuantity of [-1, "lots", {}, true]) expect({ plannedQuantity, code: codeOf(await activity({ name: "Slab", plannedQuantity })) }).toEqual({ plannedQuantity, code: "REQUEST_REJECTED" });
    expect(snapshot()).toBe(before);
    expect(codeOf(await activity({ name: "Slab", plannedQuantity: 0 }))).toBe("OK");
  });

  test("no person, a role below member and no project are refused; another org's project is absent; a params.projectId that is not the task's is refused", async () => {
    const before = snapshot();
    expect(codeOf(await activity({ name: "x" }, { actorUserId: null }))).toBe("NOT_PERMITTED");
    for (const role of ["viewer", undefined, null]) expect(codeOf(await activity({ name: "x" }, { role }))).toBe("NOT_PERMITTED");
    expect(codeOf(await activity({ name: "x" }, { projectId: null }))).toBe("PROJECT_REQUIRED");
    expect(codeOf(await activity({ name: "x" }, { projectId: PROJECT_OTHER_ORG }))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await activity({ name: "x", projectId: PROJECT_B }))).toBe("PROJECT_NOT_REACHABLE");
    expect(snapshot()).toBe(before);
    expect(codeOf(await activity({ name: "x" }, { role: "member" }))).toBe("OK");
  });

  test("an activity made by create_activity is what record_work_progress then writes against", async () => {
    await activity({ name: "Excavation", categoryId: "cat_1" });
    await progress({ itemCode: "EX-01", percent: 30 });
    expect(activities()).toHaveLength(1);
    expect(entries()[0].activityId).toBe(activities()[0].id);
  });
});
