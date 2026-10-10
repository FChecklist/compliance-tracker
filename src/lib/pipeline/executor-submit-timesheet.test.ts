/// <reference types="bun-types" />
// PROJEXA-BUILD-002 persona-run finding 3: an entry an AI records with record_timesheet stays a DRAFT and nothing on a link submitted it. submit_timesheet
// is the missing step, as a level-2 draft: the AI proposes it and the signed-in person confirms, then the entry is submitted as that person and reaches
// the manager's queue. It approves nothing.
//
// PROVEN HERE
//   - *** a member's own draft entry is submitted: the STORED row reads "submitted" afterwards, nobody is recorded as its approver, and the manager's
//     review row is opened once, for that entry and that person ***;
//   - only the person's own entry: another person's entry is refused (403 from the service) and stays a draft; an entry of ANOTHER project and an unknown id
//     read as absent; an entry that is already submitted is refused and unchanged; a returned (rejected) entry is submitted again and the person's own
//     "Needs you" row is closed first;
//   - the rank (member), the person (no actor, an inactive or unknown one) and the id parameter are checked before anything is read or written;
//   - the review row is minted AFTER the submit and its failure does not undo the submit: the entry IS submitted and the answer says the row was not created;
//   - the link side (the real Edge handler, coverage-link-checks-w56.ts): level 2, member rank, no money, the entry id is the one id parameter, refused on
//     /actions and a valid proposal instead.
//
// WHAT IS REAL: executor.ts, executors/timesheets.ts, pms-time-service.ts (getTimeEntry, submitTimeEntry), the Edge handler, the generated policy.
// WHAT IS FAKED: @/lib/db/tenant-scoped (the store double) and the two functions of timesheet-review-task-service (recording fakes).
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. executors/timesheets.ts: drop the `detail.projectId !== projectId` check                          -> "an entry of another project ..." fails
//   2. executors/timesheets.ts: submit as the task's user id instead of the acting person (the API key)   -> "*** a member's own draft ..." fails
//   3. executors/timesheets.ts: open the review row BEFORE the submit                                      -> "the review row is minted AFTER the submit ..." fails
//
// Run: bun test --isolate src/lib/pipeline/executor-submit-timesheet.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { describeLinkContract } from "./__test-helpers__/coverage-link-checks-w56";

const ORG = "org_1";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const MEMBER = "person_member";
const OTHER = "person_other";
const VIEWER = "person_viewer";
const GONE = "person_gone";
const MANAGER = "person_manager";
const API_KEY = "apikey_1";

let store: BoqStore;
function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Zoomies Dubai", status: "active" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood", status: "active" },
  ]);
  seedRows(s, "users", [
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Ravi Member", email: "ravi@example.com" },
    { id: OTHER, orgId: ORG, isActive: true, role: "member", name: "Omar Other", email: "omar@example.com" },
    { id: VIEWER, orgId: ORG, isActive: true, role: "viewer", name: "Meera Viewer", email: "meera@example.com" },
    { id: GONE, orgId: ORG, isActive: false, role: "member", name: "Gone Member", email: "gone@example.com" },
    { id: MANAGER, orgId: ORG, isActive: true, role: "manager", name: "Asha Manager", email: "asha@example.com" },
  ]);
  seedRows(s, "pms_issues", [
    { id: "issue_a", orgId: ORG, projectId: PROJECT_A, number: 12, title: "Joinery shop drawings" },
    { id: "issue_b", orgId: ORG, projectId: PROJECT_B, number: 3, title: "Facade cladding" },
  ]);
  seedRows(s, "pms_time_entries", [
    { id: "te_draft", orgId: ORG, issueId: "issue_a", userId: MEMBER, hours: "3.5", spentOn: "2026-09-25", approvalStatus: "draft", approvedById: null },
    { id: "te_other_person", orgId: ORG, issueId: "issue_a", userId: OTHER, hours: "2", spentOn: "2026-09-25", approvalStatus: "draft", approvedById: null },
    { id: "te_project_b", orgId: ORG, issueId: "issue_b", userId: MEMBER, hours: "1", spentOn: "2026-09-25", approvalStatus: "draft", approvedById: null },
    { id: "te_submitted", orgId: ORG, issueId: "issue_a", userId: MEMBER, hours: "4", spentOn: "2026-09-24", approvalStatus: "submitted", approvedById: null },
    { id: "te_returned", orgId: ORG, issueId: "issue_a", userId: MEMBER, hours: "5", spentOn: "2026-09-23", approvalStatus: "rejected", approvedById: MANAGER, rejectionReason: "wrong task" },
  ]);
  return s;
}

// ── the reviewer's row, as recording fakes (the service opens transactions of its own) ─────────────────────────────
type Args = unknown[];
const fn = {
  openTimesheetReviewTask: mock(async (..._a: Args) => ({ created: true })),
  closeTimesheetReturnedTask: mock(async (..._a: Args) => ({ closed: 0 })),
};
const order: string[] = [];

const restores: Array<[string, unknown]> = [];
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }));
  restores.push([path, real]);
}

// LOAD ORDER: see coverage-wave1.test.ts. The real modules are loaded in executor.ts's own order, each mocked right after it is loaded.
const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));
restores.push(["@/lib/db/tenant-scoped", realTenantScoped]);

await import("@/lib/services/construction-progress-service");
await import("@/lib/services/pms-time-service");
await import("@/lib/services/construction-dashboard-service");
await import("@/lib/services/construction-labour-service");
await import("@/lib/services/construction-boq-service");
await import("@/lib/services/cost-visibility-service");
await import("@/lib/services/pms-meeting-service");
await import("@/lib/services/document-service");
await import("@/lib/services/construction-change-order-service");
await import("@/lib/services/construction-site-instruction-service");
await import("@/lib/services/construction-reports-service");
await import("@/lib/services/erp-accounting-service");
await import("@/lib/services/boq-analysis-service");
await import("@/lib/services/pms-issue-service");
await import("@/lib/services/schedule-service");
await import("@/lib/services/pms-taxonomy-service");
await import("@/lib/services/construction-billing-workflow-service");
await import("@/lib/services/veri-meeting-service");
await import("@/lib/services/construction-materials-service");
stub("@/lib/services/timesheet-review-task-service", await import("@/lib/services/timesheet-review-task-service"), {
  openTimesheetReviewTask: fn.openTimesheetReviewTask,
  closeTimesheetReturnedTask: fn.closeTimesheetReturnedTask,
});
await import("@/lib/services/memory-recall-service");
await import("@/lib/crr/capture");
await import("@/lib/services/report-share-service");
await import("@/lib/services/construction-boq-import-service");

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  order.length = 0;
  for (const m of Object.values(fn)) m.mockClear();
  fn.openTimesheetReviewTask.mockImplementation(async () => {
    order.push("open");
    return { created: true };
  });
  fn.closeTimesheetReturnedTask.mockImplementation(async () => {
    order.push("close");
    return { closed: 0 };
  });
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  for (const [path, real] of restores) await mock.module(path, () => real as object);
});

type Task = import("./executor").ExecutableTask;
const task = (params: Row, overrides: Partial<Task> = {}): Task => ({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId: "submit_timesheet", params, role: "member", actorUserId: MEMBER, ...overrides });
const submit = (timeEntryId: string, overrides: Partial<Task> = {}) => executeTask(task({ timeEntryId }, overrides));
const codeOf = (o: Awaited<ReturnType<typeof executeTask>>) => (o.success ? "OK" : o.failure.code);
const entry = (id: string) => rowsOf(store, "pms_time_entries").find((r) => r.id === id)!;
const snapshot = () => JSON.stringify(store.tables);

describe("submit_timesheet: the person's own draft entry is submitted for review", () => {
  test("it is a write with an executor", () => {
    expect(hasExecutor("submit_timesheet")).toBe(true);
    expect(functionWrites("submit_timesheet")).toBe(true);
  });

  test("*** a member's own draft entry is submitted: the stored row reads 'submitted', nobody approved it, and the review row is opened once for that entry ***", async () => {
    const outcome = await submit("te_draft");

    expect(codeOf(outcome)).toBe("OK");
    const record = (outcome as { result: { id: string; route: string; record: Row } }).result;
    expect(record).toMatchObject({ id: "te_draft", route: "/timesheets" });
    expect(record.record).toMatchObject({ approvalStatus: "submitted", reviewTaskCreated: true });
    // re-read from the store, not the answer
    expect(entry("te_draft")).toMatchObject({ approvalStatus: "submitted", approvedById: null, userId: MEMBER });
    expect(fn.openTimesheetReviewTask).toHaveBeenCalledTimes(1);
    expect(fn.openTimesheetReviewTask.mock.calls[0]).toEqual([{ orgId: ORG }, expect.objectContaining({ timeEntryId: "te_draft", projectId: PROJECT_A, designerId: MEMBER, designerName: "Ravi Member", issueNumber: 12, issueTitle: "Joinery shop drawings", spentOn: "2026-09-25" })]);
    // submitting approves nothing: every other entry is exactly as it was
    expect(entry("te_other_person")).toMatchObject({ approvalStatus: "draft" });
    expect(store.maxOpen).toBe(1);
  });

  test("a returned (rejected) entry is submitted again, and the person's own 'Needs you' row is closed before the review row opens", async () => {
    expect(codeOf(await submit("te_returned"))).toBe("OK");
    expect(entry("te_returned")).toMatchObject({ approvalStatus: "submitted", rejectionReason: null });
    expect(order).toEqual(["close", "open"]);
  });

  test("the review row is minted AFTER the submit: when it throws the entry IS submitted and the answer says the row was not created", async () => {
    fn.openTimesheetReviewTask.mockImplementation(async () => {
      order.push("open");
      expect(entry("te_draft").approvalStatus).toBe("submitted");
      throw new Error("task master down");
    });
    const outcome = await submit("te_draft");
    expect(codeOf(outcome)).toBe("OK");
    expect((outcome as { result: { record: Row } }).result.record).toMatchObject({ approvalStatus: "submitted", reviewTaskCreated: false });
    expect(entry("te_draft").approvalStatus).toBe("submitted");
    expect(order).toEqual(["close", "open"]);
  });
});

describe("submit_timesheet: whose entry, which project, what state", () => {
  test("only the person's own entry: another person's entry is refused and stays a draft", async () => {
    const before = snapshot();
    const outcome = await submit("te_other_person");
    expect(codeOf(outcome)).not.toBe("OK");
    expect(!outcome.success && outcome.failure.context).toMatchObject({ status: 403 });
    expect(snapshot()).toBe(before);
    expect(fn.openTimesheetReviewTask).toHaveBeenCalledTimes(0);
  });

  test("an entry of another project and an unknown id read as absent and nothing changes", async () => {
    const before = snapshot();
    for (const id of ["te_project_b", "te_nope"]) {
      expect({ id, code: codeOf(await submit(id)) }).toEqual({ id, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot()).toBe(before);
    expect(entry("te_project_b").approvalStatus).toBe("draft");
    expect(fn.openTimesheetReviewTask).toHaveBeenCalledTimes(0);
  });

  test("an entry that is already submitted is refused and unchanged; no second review row is opened", async () => {
    const before = snapshot();
    const outcome = await submit("te_submitted");
    expect(codeOf(outcome)).not.toBe("OK");
    expect(!outcome.success && outcome.failure.context).toMatchObject({ status: 400 });
    expect(snapshot()).toBe(before);
    expect(fn.openTimesheetReviewTask).toHaveBeenCalledTimes(0);
  });
});

describe("submit_timesheet: the rank, the person and the id are checked before anything is read", () => {
  test("a viewer is NOT_PERMITTED; no acting person, an inactive and an unknown person are refused; a missing or blank id is named", async () => {
    const before = snapshot();
    expect(codeOf(await submit("te_draft", { role: "viewer", actorUserId: VIEWER }))).toBe("NOT_PERMITTED");
    expect(codeOf(await submit("te_draft", { actorUserId: null }))).toBe("NOT_PERMITTED");
    expect(codeOf(await submit("te_draft", { actorUserId: GONE }))).toBe("NOT_PERMITTED");
    expect(codeOf(await submit("te_draft", { actorUserId: "person_nobody" }))).toBe("NOT_PERMITTED");
    const missing = await executeTask(task({}));
    expect(!missing.success && missing.failure.missing).toEqual(["value"]);
    expect(codeOf(await executeTask(task({ timeEntryId: "   " })))).toBe("VALUE_REQUIRED");
    expect(snapshot()).toBe(before);
    expect(fn.openTimesheetReviewTask).toHaveBeenCalledTimes(0);
  });

  test("the API key's id is never the person: the entry is submitted as the acting person, so a draft of the key's id is not reachable", async () => {
    const before = snapshot();
    // an entry whose owner is the key's id would be 'own' if the key were used as the person
    seedRows(store, "pms_time_entries", [{ id: "te_of_key", orgId: ORG, issueId: "issue_a", userId: API_KEY, hours: "1", spentOn: "2026-09-25", approvalStatus: "draft", approvedById: null }]);
    const withKey = snapshot();
    expect(withKey).not.toBe(before);
    expect(codeOf(await submit("te_of_key"))).not.toBe("OK");
    expect(entry("te_of_key").approvalStatus).toBe("draft");
  });
});

// The link side: level 2 (a draft the person confirms), member rank, no money, one id parameter.
describeLinkContract({ id: "submit_timesheet", kind: "write", level: 2, rank: 2, money: false, text: [], ids: ["timeEntryId"], valid: { timeEntryId: "te_draft" }, required: ["timeEntryId"] });
