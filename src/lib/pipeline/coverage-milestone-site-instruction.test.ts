/// <reference types="bun-types" />
// create_milestone, update_milestone (R-94) and create_site_instruction (R-C14): the functions the offline PROJEXA writers send from a laptop
// (ai-work-link-exec). They are registered (coverage waves 1 and 2, which run them against faked services); this file runs the SAME executor
// path against the store double, so the rows the services really write are read back from the store.
//
// WHAT IS PROVEN: the checks that precede a write; the row written, re-read from the store, with the right organisation and
// project; a milestone's name/description/date/status after an update, and that a field the call does not name is left as it was; that
// milestone completion is never settable; a site instruction's numbering (SI 1, then 2), its flags (yes/no, set only by a true), the
// acting person as issuer; that an instruction names a BOQ of this project only; and that a refused call writes nothing.
// WHAT IS FAKED: @/lib/db/tenant-scoped (coverage-fixtures.ts), the link's database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-milestone-site-instruction.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { changedTables, coverageWithTenantContext, makeStore, MANAGER, ORG, PROJECT_A, PROJECT_B, seedProgressRecords, snapshot, tableJson } from "./__test-helpers__/coverage-fixtures";
import { failureOf, resultOf, task } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: coverageWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedProgressRecords(store); // brings one BOQ in project A (boq_a) and one in project B (boq_b)
  seedRows(store, "pms_milestones", [
    { id: "ms_a", orgId: ORG, projectId: PROJECT_A, name: "Structure complete", description: "Frame", targetDate: "2026-11-30", status: "planned" },
    { id: "ms_b", orgId: ORG, projectId: PROJECT_B, name: "Other project", description: null, targetDate: null, status: "planned" },
  ]);
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const run = (fn: string, params: Row, over: Parameters<typeof task>[2] = {}) => executeTask(task(fn, params, over));
const row = (table: string, id: string): Row => rowsOf(store, table).find((r) => r.id === id)!;

const SI = { issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door by 300 mm", drawingRef: "AR-101 rev B", costImpact: true, timeImpact: false, boqId: "boq_a" };

// The shared coverage suite (coverage-suite.ts) is NOT used here: its executor-level rank check expects every function to refuse a viewer
// itself, and these three (the older projectWrite path in executor.ts) do not: the rank is decided before the executor runs, by the link
// (wave 1 and 2 tests: "a viewer's link does not carry it") and, for a laptop's write, by platform.projexa_sync__op_claim (drizzle/0681:
// ROLE_TOO_LOW). The registry and link checks live in coverage-wave1/2.test.ts; the executor checks that matter for a laptop's write are below.
const CALLS: Array<[fn: string, valid: Row, missing: Array<[param: string, key: string]>]> = [
  ["create_milestone", { title: "Slab cast L2" }, [["title", "title"]]],
  ["update_milestone", { milestoneId: "ms_a", title: "Structure done" }, [["milestoneId", "value"]]],
  ["create_site_instruction", { issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door by 300 mm" }, [["issueDate", "date"], ["toContractor", "value"], ["description", "description"]]],
];

describe.each(CALLS)("%s: the checks that come before a write", (fn, valid, missing) => {
  const without = (key: string): Row => Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
  test("a missing required parameter is a failure that names it, and nothing is written", async () => {
    for (const [param, key] of missing) {
      const before = snapshot(store);
      const failure = failureOf(await run(fn, without(param)));
      expect({ param, missing: failure.missing }).toEqual({ param, missing: [key] });
      expect(snapshot(store)).toBe(before);
    }
  });

  test("a params.projectId that names another project is PROJECT_NOT_REACHABLE, and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run(fn, { ...valid, projectId: PROJECT_B })).code).toBe("PROJECT_NOT_REACHABLE");
    expect(snapshot(store)).toBe(before);
  });

  test("a write that names no person is refused NOT_PERMITTED, and nothing is written", async () => {
    for (const actorUserId of [null, undefined, ""]) {
      const before = snapshot(store);
      expect({ actorUserId, code: failureOf(await run(fn, valid, { actorUserId })).code }).toEqual({ actorUserId, code: "NOT_PERMITTED" });
      expect(snapshot(store)).toBe(before);
    }
  });
});

describe("the three functions are real writes", () => {
  test("each has an executor and is a write", () => {
    for (const fn of ["create_milestone", "update_milestone", "create_site_instruction"]) {
      expect({ fn, executor: hasExecutor(fn), write: functionWrites(fn) }).toEqual({ fn, executor: true, write: true });
    }
  });
});

describe("create_milestone", () => {
  test("writes one milestone in pms_milestones for this project and organisation, named by the title, and changes no other table", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_milestone", { title: "  Slab cast L2 ", targetDate: "2026-11-15", description: "Pour" }));
    expect(out.route).toBe("/milestones");
    expect(changedTables(before, store)).toEqual(["pms_milestones"]);
    expect(row("pms_milestones", out.id)).toMatchObject({ orgId: ORG, projectId: PROJECT_A, name: "Slab cast L2", description: "Pour", targetDate: "2026-11-15" });
    expect(rowsOf(store, "pms_milestones")).toHaveLength(3);
  });

  test("the date and the description are optional and are stored empty", async () => {
    const out = resultOf(await run("create_milestone", { title: "Roof on" }));
    expect(row("pms_milestones", out.id)).toMatchObject({ name: "Roof on", description: null, targetDate: null });
  });

  test("a title of spaces only is refused and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_milestone", { title: "   " })).code).toBe("TITLE_REQUIRED");
    expect(snapshot(store)).toBe(before);
  });
});

describe("update_milestone", () => {
  test("changes only the fields named, re-read from the store; the others are left as they were", async () => {
    resultOf(await run("update_milestone", { milestoneId: "ms_a", status: "in_progress", targetDate: "2026-12-10" }));
    expect(row("pms_milestones", "ms_a")).toMatchObject({ name: "Structure complete", description: "Frame", status: "in_progress", targetDate: "2026-12-10" });
    resultOf(await run("update_milestone", { milestoneId: "ms_a", title: "Structure done" }));
    expect(row("pms_milestones", "ms_a")).toMatchObject({ name: "Structure done", status: "in_progress", targetDate: "2026-12-10" });
    expect(row("pms_milestones", "ms_b")).toMatchObject({ name: "Other project", status: "planned" });
  });

  test("a milestone of another project or of no record reads as absent, and nothing is written", async () => {
    const before = snapshot(store);
    for (const milestoneId of ["ms_b", "no_such_record"]) {
      expect({ milestoneId, code: failureOf(await run("update_milestone", { milestoneId, title: "x" })).code }).toEqual({ milestoneId, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a status outside the four, a call that changes nothing, and a title of spaces are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const params of [{ milestoneId: "ms_a", status: "done" }, { milestoneId: "ms_a" }, { milestoneId: "ms_a", title: "   " }]) {
      const out = await run("update_milestone", params);
      expect({ params, ok: out.success }).toEqual({ params, ok: false });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("the completion percentage is not a parameter: it is derived, and a call that sends one changes nothing", async () => {
    const before = snapshot(store);
    expect((await run("update_milestone", { milestoneId: "ms_a", completionPercentage: 100 })).success).toBe(false);
    expect(snapshot(store)).toBe(before);
  });
});

describe("create_mom (R-C04): the meeting, its attendees, agenda, minutes and action items", () => {
  const MOM = {
    title: "Weekly site meeting", scheduledAt: "2026-10-12T10:30:00.000Z", meetingType: "site", attendees: ["Asha", "Ravi"], agenda: ["Slab", "Safety"],
    minutes: "Pour agreed.", actionItems: [{ title: "Order tiles", dueDate: "2026-10-20" }, { title: "Check props" }],
  };

  test("writes the meeting with its lists and minutes, and one task plus one link per action item, all re-read from the store", async () => {
    const out = resultOf(await run("create_mom", MOM));
    expect(out.route).toBe(`/moms/${out.id}`);
    expect(row("veri_meetings", out.id)).toMatchObject({
      orgId: ORG, title: "Weekly site meeting", meetingType: "site", attendees: ["Asha", "Ravi"], agenda: ["Slab", "Safety"], minutes: "Pour agreed.",
      contextEntityType: "project", contextEntityId: PROJECT_A, createdById: MANAGER,
    });
    const tasks = rowsOf(store, "tasks");
    expect(tasks.map((t) => [t.title, t.userId, t.assignedById])).toEqual([["Order tiles", MANAGER, MANAGER], ["Check props", MANAGER, MANAGER]]);
    expect((tasks[0]!.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(tasks[1]!.dueDate).toBeNull();
    expect(rowsOf(store, "veri_meeting_action_items").map((l) => [l.meetingId, l.taskId])).toEqual(tasks.map((t) => [out.id, t.id]));
  });

  test("a meeting with no action items writes no task; an action item with an empty title is skipped", async () => {
    const out = resultOf(await run("create_mom", { title: "Short one", scheduledAt: MOM.scheduledAt, actionItems: [{ title: "   " }] }));
    expect(row("veri_meetings", out.id)).toMatchObject({ title: "Short one", meetingType: "team", attendees: [], agenda: [], minutes: null });
    expect(rowsOf(store, "tasks")).toEqual([]);
    expect(rowsOf(store, "veri_meeting_action_items")).toEqual([]);
  });

  test("action items that are not a list of titles, more than 25, or a title missing: refused with nothing written", async () => {
    const before = snapshot(store);
    for (const bad of [{ actionItems: "Order tiles" }, { actionItems: ["Order tiles"] }, { actionItems: Array.from({ length: 26 }, (_, i) => ({ title: `T${i}` })) }, { title: "  " }]) {
      const out = await run("create_mom", { ...MOM, ...bad });
      expect({ bad: Object.keys(bad)[0], ok: out.success }).toEqual({ bad: Object.keys(bad)[0], ok: false });
    }
    expect(snapshot(store)).toBe(before);
  });
});

describe("create_site_instruction", () => {
  test("writes one numbered instruction under the acting person, re-read from the store, and changes no other table", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_site_instruction", SI));
    expect(out.route).toBe("/site-instructions");
    expect(changedTables(before, store)).toEqual(["construction_site_instructions"]);
    expect(row("construction_site_instructions", out.id)).toMatchObject({
      orgId: ORG, projectId: PROJECT_A, siNumber: 1, issueDate: "2026-10-05", issuedBy: MANAGER, toContractor: "Bharat Builders",
      description: "Move the door by 300 mm", drawingRef: "AR-101 rev B", costImpact: true, timeImpact: false, boqId: "boq_a",
    });
  });

  test("the next instruction on the project is number 2; the flags are set only by a true and are otherwise false; the BOQ is optional", async () => {
    resultOf(await run("create_site_instruction", SI));
    const out = resultOf(await run("create_site_instruction", { issueDate: "2026-10-06", toContractor: "Ace", description: "Hold the pour", costImpact: "yes", timeImpact: 1 }));
    expect(row("construction_site_instructions", out.id)).toMatchObject({ siNumber: 2, costImpact: false, timeImpact: false, boqId: null, drawingRef: null });
  });

  test("a BOQ of another project is refused and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_site_instruction", { ...SI, boqId: "boq_b" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("a contractor or an instruction of spaces only is refused and nothing is written", async () => {
    const before = snapshot(store);
    for (const bad of [{ toContractor: "   " }, { description: " " }]) expect((await run("create_site_instruction", { ...SI, ...bad })).success).toBe(false);
    expect(snapshot(store)).toBe(before);
  });
});
