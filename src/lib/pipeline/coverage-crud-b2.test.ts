/// <reference types="bun-types" />
// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the person's AI (an outside AI through the AI work link, the internal pipeline,
// the browser AI) can UPDATE, DELETE and ARCHIVE what the person may, as per role and organisation, and nothing else.
//
// THE 24 FUNCTIONS (level, minimum rank; "money" where a money field is written or answered)
//   update_boq (1, 2)  delete_boq (2, 3, money)  update_boq_line_amounts (2, 3, money)  delete_progress_entry (2, 2)
//   archive_task (2, 2)  create_sprint (1, 2)  update_sprint (1, 2)  close_sprint (2, 2)  add_sprint_task (1, 2)  remove_sprint_task (1, 2)
//   update_time_entry (1, 2, money)  delete_time_entry (2, 2)  dispose_document (2, 3)  update_mom_details (1, 2)  delete_mom (2, 2)
//   update_meeting (1, 2)  update_material (2, 2, money)  update_room (1, 2)  remove_room (2, 2)  update_placement (1, 2)  remove_placement (2, 2)
//   update_floor_plan_status (2, 2)  update_mood_board (1, 2)  remove_mood_board_item (2, 2)
//
// WHAT IS PROVEN, for every function (coverage-suite.ts, registered once per function): the generated link policy is this table; on a manager's
// link the valid parameters are a valid check; a level-2 function (every delete, removal and archive) is refused on the direct path (403
// LEVEL_NOT_ALLOWED) and is only a proposal, a draft the person confirms; a viewer's link does not carry it (nor a member's, at rank 3); another
// project's id in projectId is 403 on the link and PROJECT_NOT_REACHABLE in the executor; a role below the rank, and no role, is NOT_PERMITTED;
// a write that names no person is refused; an id of ANOTHER PROJECT, of ANOTHER ORGANISATION (the third value of each `foreign` entry) or of no
// record reads as absent and the store is byte-identical afterwards; every free-text parameter is capped at 2,000 characters.
// AND (this file): a valid call as the right role runs the REAL service and changes exactly the tables it should, re-read from the store; a task
// of another organisation is refused for every function and writes nothing; the service rules hold (a draft BOQ only, a draft MoM only and kept,
// a document past its disposal date and not under legal hold, a person's own draft time entry only, money null below the manager rank).
//
// WHAT IS REAL: executor.ts, function-registry.ts, the executors of executors/crud-*.ts, the services they wrap, the free-text rule, the generated
// link policy and the Edge handler. WHAT IS FAKED: only @/lib/db/tenant-scoped (coverage-fixtures.ts) and the link's own database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-crud-b2.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import {
  changedTables, makeStore, MANAGER, MEMBER, ORG, OTHER_ORG, PROJECT_A, PROJECT_B, PROJECT_X, seedLabourAndMaterials, seedProgressRecords, snapshot, tableJson,
} from "./__test-helpers__/coverage-fixtures";
import { seedWave89Records, w79WithTenantContext } from "./__test-helpers__/coverage-w79";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: w79WithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

/** The records the 24 functions read: for each, one of project A, one of project B and one of another organisation. */
function seedCrudRecords(s: BoqStore): void {
  seedProgressRecords(s);
  seedLabourAndMaterials(s);
  seedWave89Records(s);
  for (const b of s.tables.construction_boqs) b.status = "draft";
  seedRows(s, "construction_boqs", [
    { id: "boq_a_sent", orgId: ORG, projectId: PROJECT_A, version: 2, status: "submitted", title: "Submitted" },
    { id: "boq_x", orgId: OTHER_ORG, projectId: PROJECT_X, version: 1, status: "draft" },
  ]);
  seedRows(s, "construction_boq_line_items", [{ id: "line_x", orgId: OTHER_ORG, boqId: "boq_x", itemCode: "EX-01", quantity: "10" }]);
  seedRows(s, "construction_work_progress_entries", [
    { id: "entry_x", orgId: OTHER_ORG, projectId: PROJECT_X, activityId: "act_x", entryDate: "2026-09-01", quantityDone: "2", percentComplete: "20", recordedById: MEMBER },
  ]);
  seedRows(s, "construction_materials", [{ id: "mat_x", orgId: OTHER_ORG, projectId: PROJECT_X, name: "Elsewhere", unit: "kg", unitCost: "1", isActive: true }]);
  seedRows(s, "pms_issues", [
    { id: "issue_a", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Joinery shop drawings", statusId: "st_a", isArchived: false, createdById: MANAGER },
    { id: "issue_a2", orgId: ORG, projectId: PROJECT_A, number: 2, title: "Pour slab", statusId: "st_a", isArchived: false, createdById: MANAGER },
    { id: "issue_b", orgId: ORG, projectId: PROJECT_B, number: 1, title: "Facade cladding", statusId: "st_b", isArchived: false },
    { id: "issue_x", orgId: OTHER_ORG, projectId: PROJECT_X, number: 1, title: "Elsewhere", statusId: "st_x", isArchived: false },
  ]);
  seedRows(s, "pms_sprints", [
    { id: "sprint_a", orgId: ORG, projectId: PROJECT_A, name: "Sprint 1", status: "active" },
    { id: "sprint_b", orgId: ORG, projectId: PROJECT_B, name: "Other sprint", status: "active" },
    { id: "sprint_x", orgId: OTHER_ORG, projectId: PROJECT_X, name: "Elsewhere", status: "active" },
  ]);
  seedRows(s, "pms_sprint_issues", [{ id: "si_1", sprintId: "sprint_a", issueId: "issue_a2" }]);
  seedRows(s, "pms_time_entries", [
    { id: "te_a", orgId: ORG, issueId: "issue_a", userId: MANAGER, hours: "2", spentOn: "2026-09-20", approvalStatus: "draft", hourlyRateSnapshot: "1500" },
    { id: "te_member", orgId: ORG, issueId: "issue_a", userId: MEMBER, hours: "4", spentOn: "2026-09-20", approvalStatus: "draft", hourlyRateSnapshot: "900" },
    { id: "te_sent", orgId: ORG, issueId: "issue_a", userId: MANAGER, hours: "1", spentOn: "2026-09-19", approvalStatus: "submitted" },
    { id: "te_b", orgId: ORG, issueId: "issue_b", userId: MANAGER, hours: "1", spentOn: "2026-09-20", approvalStatus: "draft" },
    { id: "te_x", orgId: OTHER_ORG, issueId: "issue_x", userId: MANAGER, hours: "1", spentOn: "2026-09-20", approvalStatus: "draft" },
  ]);
  seedRows(s, "documents", [
    { id: "doc_old", orgId: ORG, name: "2019 site photos", fileUrl: "https://example.com/old.zip", category: "other", linkedEntityType: "project", linkedEntityId: PROJECT_A, disposalDate: "2025-01-01", legalHold: false, isDisposed: false },
    { id: "doc_hold", orgId: ORG, name: "Dispute file", fileUrl: "https://example.com/hold.zip", category: "other", linkedEntityType: "project", linkedEntityId: PROJECT_A, disposalDate: "2025-01-01", legalHold: true, isDisposed: false },
    { id: "doc_x", orgId: OTHER_ORG, name: "Elsewhere", fileUrl: "https://example.com/x.pdf", category: "other", linkedEntityType: "project", linkedEntityId: PROJECT_X, disposalDate: "2025-01-01", legalHold: false, isDisposed: false },
  ]);
  seedRows(s, "veri_meetings", [
    { id: "mom_a", orgId: ORG, title: "Site meeting", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_A, status: "draft" },
    { id: "mom_pub", orgId: ORG, title: "Kick-off", scheduledAt: new Date("2026-09-01T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_A, status: "published" },
    { id: "mom_b", orgId: ORG, title: "Other site", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_B, status: "draft" },
    { id: "mom_x", orgId: OTHER_ORG, title: "Elsewhere", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_X, status: "draft" },
  ]);
  seedRows(s, "pms_meetings", [
    { id: "pmeet_a", orgId: ORG, projectId: PROJECT_A, title: "Coordination", scheduledAt: new Date("2026-09-24T10:00:00Z"), durationMinutes: 30 },
    { id: "pmeet_b", orgId: ORG, projectId: PROJECT_B, title: "Other coordination", scheduledAt: new Date("2026-09-24T10:00:00Z") },
    { id: "pmeet_x", orgId: OTHER_ORG, projectId: PROJECT_X, title: "Elsewhere", scheduledAt: new Date("2026-09-24T10:00:00Z") },
  ]);
  seedRows(s, "interior_floor_plans", [{ id: "fp_x", orgId: OTHER_ORG, projectId: PROJECT_X, name: "Elsewhere", status: "draft", createdById: MEMBER }]);
  seedRows(s, "interior_mood_boards", [{ id: "mb_x", orgId: OTHER_ORG, projectId: PROJECT_X, title: "Elsewhere", status: "draft", createdById: MEMBER }]);
  seedRows(s, "interior_furniture_placements", [
    { id: "pl_a", floorPlanId: "fp_a", roomId: "room_a", ffeItemId: "ffe_a", x: "100", y: "100", rotationDeg: "0" },
    { id: "pl_b", floorPlanId: "fp_b", roomId: "room_b", ffeItemId: "ffe_b", x: "0", y: "0", rotationDeg: "0" },
  ]);
  seedRows(s, "interior_mood_board_items", [
    { id: "mbi_a", moodBoardId: "mb_a", label: "Oak veneer", sortOrder: 0 },
    { id: "mbi_b", moodBoardId: "mb_b", label: "Other board item", sortOrder: 0 },
  ]);
}

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedCrudRecords(store);
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const run = (fn: string, params: Row, over: Partial<import("./executor").ExecutableTask> = {}) => executeTask(task(fn, params, over));
const row = (table: string, id: string): Row | undefined => rowsOf(store, table).find((r) => r.id === id);
const asMember = { role: "member", actorUserId: MEMBER } as const;

export const CASES: Case[] = [
  { fn: "update_boq", level: 1, minRank: 2, money: false, valid: { boqId: "boq_a", title: "Main works BOQ" }, required: [["boqId", "value"], ["title", "value"]], text: ["title"], foreign: [["boqId", "boq_b", "boq_x"]] },
  { fn: "delete_boq", level: 2, minRank: 3, money: true, valid: { boqId: "boq_a" }, required: [["boqId", "value"]], text: [], foreign: [["boqId", "boq_b", "boq_x"]] },
  {
    fn: "update_boq_line_amounts", level: 2, minRank: 3, money: true, valid: { lineItemId: "line_a", qtyProject: 12, rateProject: 450 },
    required: [["lineItemId", "boqLine"]], text: [], foreign: [["lineItemId", "line_b", "line_x"]],
  },
  { fn: "delete_progress_entry", level: 2, minRank: 2, money: false, valid: { entryId: "entry_a" }, required: [["entryId", "value"]], text: [], foreign: [["entryId", "entry_b", "entry_x"]] },
  { fn: "archive_task", level: 2, minRank: 2, money: false, valid: { issueId: "issue_a", isArchived: true }, required: [["issueId", "task"]], text: [], foreign: [["issueId", "issue_b", "issue_x"]] },
  {
    fn: "create_sprint", level: 1, minRank: 2, money: false, valid: { name: "Sprint 3", goal: "Finish the joinery", startDate: "2026-10-05", endDate: "2026-10-19" },
    required: [["name", "value"]], text: ["name", "goal"], foreign: [],
  },
  {
    fn: "update_sprint", level: 1, minRank: 2, money: false, valid: { sprintId: "sprint_a", name: "Sprint 1 (extended)", endDate: "2026-10-30" },
    required: [["sprintId", "value"]], text: ["name", "goal"], foreign: [["sprintId", "sprint_b", "sprint_x"]],
  },
  { fn: "close_sprint", level: 2, minRank: 2, money: false, valid: { sprintId: "sprint_a" }, required: [["sprintId", "value"]], text: [], foreign: [["sprintId", "sprint_b", "sprint_x"]] },
  {
    fn: "add_sprint_task", level: 1, minRank: 2, money: false, valid: { sprintId: "sprint_a", issueId: "issue_a" },
    required: [["sprintId", "value"], ["issueId", "task"]], text: [], foreign: [["sprintId", "sprint_b", "sprint_x"], ["issueId", "issue_b", "issue_x"]],
  },
  {
    fn: "remove_sprint_task", level: 1, minRank: 2, money: false, valid: { sprintId: "sprint_a", issueId: "issue_a2" },
    required: [["sprintId", "value"], ["issueId", "task"]], text: [], foreign: [["sprintId", "sprint_b", "sprint_x"], ["issueId", "issue_b", "issue_x"]],
  },
  {
    fn: "update_time_entry", level: 1, minRank: 2, money: true, valid: { entryId: "te_a", hours: 3, comments: "Shop drawing review" },
    required: [["entryId", "value"]], text: ["activityType", "comments"], foreign: [["entryId", "te_b", "te_x"], ["issueId", "issue_b", "issue_x"]],
  },
  { fn: "delete_time_entry", level: 2, minRank: 2, money: false, valid: { entryId: "te_a" }, required: [["entryId", "value"]], text: [], foreign: [["entryId", "te_b", "te_x"]] },
  { fn: "dispose_document", level: 2, minRank: 3, money: false, valid: { documentId: "doc_old" }, required: [["documentId", "value"]], text: [], foreign: [["documentId", "doc_b", "doc_x"]] },
  {
    fn: "update_mom_details", level: 1, minRank: 2, money: false, valid: { meetingId: "mom_a", title: "Site meeting 7", meetingType: "site", attendees: ["Asha", "Ravi"] },
    required: [["meetingId", "value"]], text: ["title", "meetingType"], foreign: [["meetingId", "mom_b", "mom_x"]],
  },
  { fn: "delete_mom", level: 2, minRank: 2, money: false, valid: { meetingId: "mom_a" }, required: [["meetingId", "value"]], text: [], foreign: [["meetingId", "mom_b", "mom_x"]] },
  {
    fn: "update_meeting", level: 1, minRank: 2, money: false, valid: { meetingId: "pmeet_a", title: "Coordination 2", durationMinutes: 45 },
    required: [["meetingId", "value"]], text: ["title"], foreign: [["meetingId", "pmeet_b", "pmeet_x"]],
  },
  {
    fn: "update_material", level: 2, minRank: 2, money: true, valid: { materialId: "mat_a", unitCost: 430, spec: "OPC 53, 50 kg" },
    required: [["materialId", "material"]], text: ["name", "unit", "spec"], foreign: [["materialId", "mat_b", "mat_x"]],
  },
  {
    fn: "update_room", level: 1, minRank: 2, money: false, valid: { floorPlanId: "fp_a", roomId: "room_a", name: "Lounge (large)", ceilingHeightCm: 280 },
    required: [["floorPlanId", "value"], ["roomId", "value"]], text: ["name"], foreign: [["floorPlanId", "fp_b", "fp_x"], ["roomId", "room_b"]],
  },
  {
    fn: "remove_room", level: 2, minRank: 2, money: false, valid: { floorPlanId: "fp_a", roomId: "room_a" },
    required: [["floorPlanId", "value"], ["roomId", "value"]], text: [], foreign: [["floorPlanId", "fp_b", "fp_x"], ["roomId", "room_b"]],
  },
  {
    fn: "update_placement", level: 1, minRank: 2, money: false, valid: { floorPlanId: "fp_a", placementId: "pl_a", x: 200, rotationDeg: 45 },
    required: [["floorPlanId", "value"], ["placementId", "value"]], text: [], foreign: [["floorPlanId", "fp_b", "fp_x"], ["placementId", "pl_b"], ["roomId", "room_b"]],
  },
  {
    fn: "remove_placement", level: 2, minRank: 2, money: false, valid: { floorPlanId: "fp_a", placementId: "pl_a" },
    required: [["floorPlanId", "value"], ["placementId", "value"]], text: [], foreign: [["floorPlanId", "fp_b", "fp_x"], ["placementId", "pl_b"]],
  },
  {
    fn: "update_floor_plan_status", level: 2, minRank: 2, money: false, valid: { floorPlanId: "fp_a", status: "final" },
    required: [["floorPlanId", "value"], ["status", "value"]], text: [], foreign: [["floorPlanId", "fp_b", "fp_x"]],
  },
  {
    fn: "update_mood_board", level: 1, minRank: 2, money: false, valid: { moodBoardId: "mb_a", title: "Living room, v2" },
    required: [["moodBoardId", "value"]], text: ["title", "roomOrArea", "description"], foreign: [["moodBoardId", "mb_b", "mb_x"]],
  },
  {
    fn: "remove_mood_board_item", level: 2, minRank: 2, money: false, valid: { moodBoardId: "mb_a", itemId: "mbi_a" },
    required: [["moodBoardId", "value"], ["itemId", "value"]], text: [], foreign: [["moodBoardId", "mb_b", "mb_x"], ["itemId", "mbi_b"]],
  },
];

/** What a valid call (as a manager) changes: exactly these tables, and the check that the change is there, re-read from the store. */
const EFFECT: Record<string, { tables: string[]; check: () => void }> = {
  update_boq: { tables: ["construction_boqs"], check: () => expect(row("construction_boqs", "boq_a")!.title).toBe("Main works BOQ") },
  delete_boq: {
    tables: ["construction_boq_line_items", "construction_boqs"],
    check: () => {
      expect(row("construction_boqs", "boq_a")).toBeUndefined();
      expect(row("construction_boq_line_items", "line_a")).toBeUndefined();
      expect(row("construction_boqs", "boq_b")).toBeDefined();
    },
  },
  update_boq_line_amounts: { tables: ["construction_boq_line_items"], check: () => expect(row("construction_boq_line_items", "line_a")).toMatchObject({ qtyProject: "12", rateProject: "450" }) },
  delete_progress_entry: {
    tables: ["construction_work_progress_entries"],
    check: () => {
      expect(row("construction_work_progress_entries", "entry_a")).toBeUndefined();
      expect(row("construction_work_progress_entries", "entry_b")).toBeDefined();
    },
  },
  archive_task: { tables: ["pms_issues", "projects"], check: () => expect(row("pms_issues", "issue_a")!.isArchived).toBe(true) },
  create_sprint: {
    tables: ["pms_sprints"],
    check: () => expect(rowsOf(store, "pms_sprints").find((r) => r.name === "Sprint 3")).toMatchObject({ orgId: ORG, projectId: PROJECT_A, goal: "Finish the joinery", startDate: "2026-10-05", endDate: "2026-10-19" }),
  },
  update_sprint: { tables: ["pms_sprints"], check: () => expect(row("pms_sprints", "sprint_a")).toMatchObject({ name: "Sprint 1 (extended)", endDate: "2026-10-30", status: "active" }) },
  close_sprint: { tables: ["pms_sprints"], check: () => expect(row("pms_sprints", "sprint_a")).toMatchObject({ status: "completed", progressSnapshot: { total: 1 } }) },
  add_sprint_task: { tables: ["pms_sprint_issues"], check: () => expect(rowsOf(store, "pms_sprint_issues").some((r) => r.sprintId === "sprint_a" && r.issueId === "issue_a")).toBe(true) },
  remove_sprint_task: {
    tables: ["pms_sprint_issues"],
    check: () => {
      expect(rowsOf(store, "pms_sprint_issues").some((r) => r.issueId === "issue_a2")).toBe(false);
      expect(row("pms_issues", "issue_a2")).toBeDefined();
    },
  },
  update_time_entry: { tables: ["pms_time_entries"], check: () => expect(row("pms_time_entries", "te_a")).toMatchObject({ hours: "3", comments: "Shop drawing review", userId: MANAGER }) },
  delete_time_entry: { tables: ["pms_time_entries"], check: () => expect(row("pms_time_entries", "te_a")).toBeUndefined() },
  dispose_document: { tables: ["documents"], check: () => expect(row("documents", "doc_old")).toMatchObject({ isDisposed: true, disposedById: MANAGER }) },
  update_mom_details: {
    tables: ["audit_logs", "veri_meetings"],
    check: () => expect(row("veri_meetings", "mom_a")).toMatchObject({ title: "Site meeting 7", meetingType: "site", attendees: ["Asha", "Ravi"] }),
  },
  delete_mom: { tables: ["audit_logs", "veri_meetings"], check: () => expect(row("veri_meetings", "mom_a")!.status).toBe("deleted") },
  update_meeting: { tables: ["pms_meetings"], check: () => expect(row("pms_meetings", "pmeet_a")).toMatchObject({ title: "Coordination 2", durationMinutes: 45 }) },
  update_material: { tables: ["construction_materials"], check: () => expect(row("construction_materials", "mat_a")).toMatchObject({ unitCost: "430", spec: "OPC 53, 50 kg", name: "Cement OPC 53" }) },
  update_room: { tables: ["interior_floor_plan_rooms"], check: () => expect(row("interior_floor_plan_rooms", "room_a")).toMatchObject({ name: "Lounge (large)", ceilingHeightCm: "280" }) },
  remove_room: {
    tables: ["interior_floor_plan_rooms"],
    check: () => {
      expect(row("interior_floor_plan_rooms", "room_a")).toBeUndefined();
      expect(row("interior_floor_plan_rooms", "room_b")).toBeDefined();
    },
  },
  update_placement: { tables: ["interior_furniture_placements"], check: () => expect(row("interior_furniture_placements", "pl_a")).toMatchObject({ x: "200", y: "100", rotationDeg: "45" }) },
  remove_placement: { tables: ["interior_furniture_placements"], check: () => expect(row("interior_furniture_placements", "pl_a")).toBeUndefined() },
  update_floor_plan_status: { tables: ["interior_floor_plans"], check: () => expect(row("interior_floor_plans", "fp_a")!.status).toBe("final") },
  update_mood_board: { tables: ["interior_mood_boards"], check: () => expect(row("interior_mood_boards", "mb_a")!.title).toBe("Living room, v2") },
  remove_mood_board_item: { tables: ["interior_mood_board_items"], check: () => expect(row("interior_mood_board_items", "mbi_a")).toBeUndefined() },
};

describe("lf-b2-ai-crud: the 24 functions are registered and executable, and every one is a write", () => {
  test("every function has an executor, is a write and has a valid-call effect below", () => {
    expect(CASES).toHaveLength(24);
    for (const c of CASES) expect({ fn: c.fn, executor: hasExecutor(c.fn), write: functionWrites(c.fn), effect: c.fn in EFFECT }).toEqual({ fn: c.fn, executor: true, write: true, effect: true });
  });

  test("every delete, removal and archive is a level-2 draft the person confirms", () => {
    // remove_sprint_task deletes no record (the task stays on the schedule, only its sprint link goes), so it is a direct write like add_sprint_task
    const destructive = CASES.filter((c) => /^(delete|remove|archive|dispose)_/.test(c.fn) && c.fn !== "remove_sprint_task");
    expect(destructive.map((c) => c.fn).sort()).toEqual([
      "archive_task", "delete_boq", "delete_mom", "delete_progress_entry", "delete_time_entry", "dispose_document", "remove_mood_board_item", "remove_placement", "remove_room",
    ]);
    for (const c of destructive) expect({ fn: c.fn, level: c.level }).toEqual({ fn: c.fn, level: 2 });
    // and every money function too
    for (const c of CASES.filter((x) => x.money && x.fn !== "update_time_entry")) expect({ fn: c.fn, level: c.level }).toEqual({ fn: c.fn, level: 2 });
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

describe("a valid call runs the real service and changes exactly what it should", () => {
  for (const c of CASES) {
    test(`${c.fn}: as a manager, writes only ${EFFECT[c.fn].tables.join(", ")}, and the change reads back`, async () => {
      const before = tableJson(store);
      resultOf(await run(c.fn, c.valid));
      expect(store.unparsed).toEqual([]);
      // a table the service only read for the first time shows up as an empty list: that is not a write
      const written = changedTables(before, store).filter((t) => !(before[t] === undefined && JSON.stringify(store.tables[t]) === "[]"));
      expect(written).toEqual(EFFECT[c.fn].tables);
      EFFECT[c.fn].check();
    });
  }
});

describe("a task of another organisation reaches nothing of this one", () => {
  for (const c of CASES) {
    test(`${c.fn}: orgId of another organisation with this project's ids is refused, and nothing is written`, async () => {
      const before = snapshot(store);
      const failure = failureOf(await run(c.fn, c.valid, { orgId: OTHER_ORG }));
      expect(failure.code).toBe("RECORD_NOT_FOUND");
      expect(snapshot(store)).toBe(before);
    });
  }
});

describe("the services' own rules hold when the AI calls them", () => {
  test("delete_boq: a submitted BOQ is refused (only a draft can be deleted) and stays", async () => {
    const failure = failureOf(await run("delete_boq", { boqId: "boq_a_sent" }));
    expect(failure.code).toBe("REQUEST_REJECTED");
    expect(row("construction_boqs", "boq_a_sent")).toBeDefined();
  });

  test("delete_mom: a published MoM is refused (409) and stays published; a deleted one is kept, marked deleted", async () => {
    expect(failureOf(await run("delete_mom", { meetingId: "mom_pub" })).code).not.toBe(undefined);
    expect(row("veri_meetings", "mom_pub")!.status).toBe("published");
    resultOf(await run("delete_mom", { meetingId: "mom_a" }));
    expect(row("veri_meetings", "mom_a")).toBeDefined();
    // a deleted MoM reads as absent afterwards: it cannot be deleted or edited again
    expect(failureOf(await run("update_mom_details", { meetingId: "mom_a", title: "Again" })).code).toBe("RECORD_NOT_FOUND");
  });

  test("update_mom_details: a published MoM is locked (409) and unchanged", async () => {
    failureOf(await run("update_mom_details", { meetingId: "mom_pub", title: "Rewritten" }));
    expect(row("veri_meetings", "mom_pub")!.title).toBe("Kick-off");
  });

  test("dispose_document: a document under legal hold is refused and not disposed", async () => {
    failureOf(await run("dispose_document", { documentId: "doc_hold" }));
    expect(row("documents", "doc_hold")!.isDisposed).toBe(false);
  });

  test("delete_time_entry and update_time_entry: another person's entry is NOT_PERMITTED; a submitted one cannot be deleted", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("delete_time_entry", { entryId: "te_member" })).code).toBe("NOT_PERMITTED");
    expect(failureOf(await run("update_time_entry", { entryId: "te_member", hours: 1 })).code).toBe("NOT_PERMITTED");
    expect(failureOf(await run("delete_time_entry", { entryId: "te_sent" })).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
    // the member may delete their own draft
    resultOf(await run("delete_time_entry", { entryId: "te_member" }, asMember));
    expect(row("pms_time_entries", "te_member")).toBeUndefined();
  });

  test("update_time_entry: below the manager rank the billing rate in the answer is null", async () => {
    const out = resultOf<{ record: Row }>(await run("update_time_entry", { entryId: "te_member", hours: 5 }, asMember));
    expect(out.record).toMatchObject({ hourlyRateSnapshot: null, financialsRedacted: true });
    expect(row("pms_time_entries", "te_member")!.hourlyRateSnapshot).toBe("900");
  });

  test("update_material: below the manager rank the unit cost in the answer is null; the write is made", async () => {
    const out = resultOf<{ record: Row }>(await run("update_material", { materialId: "mat_a", unitCost: 440 }, asMember));
    expect(out.record).toMatchObject({ unitCost: null, financialsRedacted: true });
    expect(row("construction_materials", "mat_a")!.unitCost).toBe("440");
  });

  test("update_sprint: status completed is not an edit (close_sprint is); an end before the start is refused", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_sprint", { sprintId: "sprint_a", status: "completed" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_sprint", { name: "Backwards", startDate: "2026-10-10", endDate: "2026-10-01" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });

  test("archive_task: isArchived false restores a task", async () => {
    store.tables.pms_issues.find((r) => r.id === "issue_a")!.isArchived = true;
    resultOf(await run("archive_task", { issueId: "issue_a", isArchived: "false" }));
    expect(row("pms_issues", "issue_a")!.isArchived).toBe(false);
  });

  test("an empty patch is refused and nothing is written", async () => {
    const before = snapshot(store);
    for (const [fn, params] of [
      ["update_sprint", { sprintId: "sprint_a" }], ["update_time_entry", { entryId: "te_a" }], ["update_mom_details", { meetingId: "mom_a" }],
      ["update_meeting", { meetingId: "pmeet_a" }], ["update_material", { materialId: "mat_a" }], ["update_room", { floorPlanId: "fp_a", roomId: "room_a" }],
      ["update_placement", { floorPlanId: "fp_a", placementId: "pl_a" }], ["update_mood_board", { moodBoardId: "mb_a" }], ["update_boq_line_amounts", { lineItemId: "line_a" }],
    ] as const) {
      expect({ fn, code: failureOf(await run(fn, params)).code }).toEqual({ fn, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });
});
