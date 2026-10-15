/// <reference types="bun-types" />
// OFFLINE WRITERS 3 (PROJEXA: an action item added to a meeting that already exists, with no network): what the laptop sends is
// add_meeting_action_item on the AI work link. The laptop checks the same rules before it keeps the write; THIS file proves the server end of each
// rule through the real executor and re-reads the stored rows (never a spy), so a rule the laptop's copy got wrong is still caught on arrival.
//
// Rules, each with an accepting and a refusing case:
//   - the item becomes a task for the acting person (or for a named person the project names), linked to the meeting; nothing else is written;
//   - a due date is a real calendar day written YYYY-MM-DD: "2026-02-30" used to roll over to 2 March, "next week" used to reach the database as an
//     invalid date; both are refused now, and nothing is written;
//   - a meeting of another project, an assignee the project does not name, and a title of spaces only are refused with nothing written;
//   (A repeat of the same title within the service's window is answered with the earlier item by the service itself; the store double does not
//   model the relation that check reads, so it is not asserted here. The push ledger already makes a laptop's op run once.)
//
// WHAT IS REAL: executor.ts, function-registry.ts, executors/meetings.ts, create_mom / addMeetingActionItem. WHAT IS FAKED: only
// @/lib/db/tenant-scoped (__test-helpers__/coverage-fixtures.ts).
//
// Run: bun test --isolate src/lib/pipeline/executor.offline-mom-action-item.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { coverageWithTenantContext, makeStore, MANAGER, MEMBER, ORG, PROJECT_A, PROJECT_B, snapshot, STRANGER } from "./__test-helpers__/coverage-fixtures";
import { failureOf, resultOf, task } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: coverageWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
let meetingId = "";
let otherProjectMeetingId = "";
beforeEach(async () => {
  store = makeStore();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
  // a meeting of project A and one of project B, made the way the laptop makes them (create_mom)
  meetingId = resultOf(await executeTask(task("create_mom", { title: "Weekly site meeting", scheduledAt: "2026-10-12T10:30:00.000Z" }))).id;
  otherProjectMeetingId = resultOf(await executeTask(task("create_mom", { title: "Oakwood meeting", scheduledAt: "2026-10-12T10:30:00.000Z" }, { projectId: PROJECT_B }))).id;
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const add = (params: Row, over: Parameters<typeof task>[2] = {}) => executeTask(task("add_meeting_action_item", params, over));
const tasksOf = () => rowsOf(store, "tasks");
const linksOf = () => rowsOf(store, "veri_meeting_action_items");

describe("add_meeting_action_item on a meeting that already exists", () => {
  test("writes one task for the acting person and one link to the meeting, re-read from the store", async () => {
    const out = resultOf(await add({ meetingId, title: " Order tiles ", dueDate: "2026-10-20" }));
    expect(out.route).toBe(`/moms/${meetingId}`);
    expect(tasksOf()).toHaveLength(1);
    expect(tasksOf()[0]).toMatchObject({ orgId: ORG, title: "Order tiles", userId: MANAGER, assignedById: MANAGER });
    expect((tasksOf()[0]!.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(linksOf().map((l) => [l.meetingId, l.taskId])).toEqual([[meetingId, tasksOf()[0]!.id]]);
  });

  test("the due date is optional and is stored empty", async () => {
    resultOf(await add({ meetingId, title: "Check props" }));
    expect(tasksOf()[0]!.dueDate).toBeNull();
  });

  test("a person the project names can be given the item; a member of the organisation the project does not name cannot", async () => {
    resultOf(await add({ meetingId, title: "Lead's item", assigneeUserId: MEMBER }));
    expect(tasksOf()[0]).toMatchObject({ userId: MEMBER, assignedById: MANAGER });
    const before = snapshot(store);
    expect(failureOf(await add({ meetingId, title: "Not theirs", assigneeUserId: STRANGER })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("a due date that is not a real day is refused and nothing is written (2026-02-30 used to become 2 March)", async () => {
    const before = snapshot(store);
    for (const dueDate of ["2026-02-30", "next week", "20-10-2026", "2026-13-01", "2026-10-20T10:00:00Z", 20261020]) {
      const out = await add({ meetingId, title: "Order tiles", dueDate });
      expect({ dueDate, ok: out.success }).toEqual({ dueDate, ok: false });
    }
    expect(snapshot(store)).toBe(before);
    expect(tasksOf()).toEqual([]);
  });

  test("a meeting of another project reads as absent, and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await add({ meetingId: otherProjectMeetingId, title: "Order tiles" })).code).toBe("RECORD_NOT_FOUND");
    expect(failureOf(await add({ meetingId: "no_such_meeting", title: "Order tiles" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("a title of spaces only, or none, is refused naming the title, and nothing is written", async () => {
    const before = snapshot(store);
    for (const params of [{ meetingId, title: "   " }, { meetingId }]) {
      expect({ params, code: failureOf(await add(params)).code }).toEqual({ params, code: "TITLE_REQUIRED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a write that names no person is refused, and nothing is written", async () => {
    const before = snapshot(store);
    for (const actorUserId of [null, undefined, ""]) {
      const out = await add({ meetingId, title: "Order tiles" }, { actorUserId });
      expect({ actorUserId, ok: out.success }).toEqual({ actorUserId, ok: false });
    }
    expect(snapshot(store)).toBe(before);
  });
});
