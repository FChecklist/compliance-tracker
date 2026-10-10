/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05c, register row AW-303 -- coverage wave 3: RFIs, submittals, punch list and the site diary are callable by an AI
// through a project link, and by the internal pipeline, as the person's role and the project allow.
//
// THE NINE FUNCTIONS
//   create_rfi (level 1, rank 2)        answer_rfi (level 2, rank 2)            close_rfi (level 1, rank 2)
//   create_submittal (level 1, rank 2)  review_submittal (level 2, rank 3)
//   create_punch_list_item (level 1, rank 2)  mark_punch_item_ready (level 1, rank 2)  verify_punch_item_closed (level 2, rank 3)
//   create_site_diary (level 1, rank 2)
//
// WHAT IS PROVEN, for every function (coverage-suite.ts, registered once per function below)
//   the generated link policy is this table; the valid parameters are a valid check on a manager's link; a level-2 function is refused on
//   the direct path and is a proposal; a viewer's link does not carry it; a missing required parameter is 422 with `missing` on the direct
//   path and is named on a check; the executor names a missing parameter and writes nothing; another project in params.projectId is
//   PROJECT_NOT_REACHABLE; a role below the minimum rank, and no role, is refused; a write that names no person is refused; an id of
//   another project, of another organisation or of no record reads as absent and the store is byte-identical afterwards; every free-text
//   parameter is capped at 2,000 characters and cleaned by the rule a link submission gets.
// AND, function by function (this file)
//   a valid call writes exactly the row it should, and only in the one table; the row is re-read from the store and is recorded under the
//   acting person and never under the API key; the numbering counts the project's own records; a value of a closed list that the service
//   would cast without checking (ballInCourt, submittal type, decision, priority) is a 400; a date that is not a real day is a 400; the
//   project is checked because createRfi, createSubmittal and createPunchListItem never look it up; an assignee is one of the project's
//   people; the independent-reviewer rules of the service reach the caller (a submittal is not reviewed by whoever submitted it, a punch
//   list item is not verified by its assignee); a second diary entry for a day is refused and adds nothing.
//
// WHAT IS REAL: executor.ts, function-registry.ts, the executors of executors/field-records.ts and site-diary.ts, the services they wrap
// (construction-field-workflow-service.ts, construction-site-diary-service.ts), run-submission's free-text rule (ai-link-text.ts), the
// generated link policy and the Edge handler (supabase/functions/ai-work-link/handler.ts).
// WHAT IS FAKED: only @/lib/db/tenant-scoped (coverage-fixtures.ts: the real where clause of every query compiled and evaluated against
// fixture rows, writes committed on success and discarded on throw) and the link's own database (awl-edge-fake.ts).
// WHAT IS NOT PROVEN HERE: the direct path answers 503 today because the executor host is not switched on (the write path is WP-09), so a
// level-1 link write is proven up to that gate and the executor separately; /drafts answers 501 until WP-09, so "accepted as a draft" is
// proven on /propose and /check, the two places the handler builds a draft today.
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave3.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import {
  API_KEY, changedTables, coverageWithTenantContext, makeStore, MANAGER, MEMBER, PROJECT_A, PROJECT_X, seedFieldRecords, snapshot, STRANGER, TEAM, tableJson,
} from "./__test-helpers__/coverage-fixtures";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

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
  seedFieldRecords(store);
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
const row = (table: string, id: string): Row => rowsOf(store, table).find((r) => r.id === id)!;

// The table every function of the wave is held to. `valid` is what succeeds; `foreign` names the id parameters and a record of another project.
const CASES: Case[] = [
  {
    fn: "create_rfi", level: 1, minRank: 2, money: false,
    valid: { subject: "Beam depth at grid C4", question: "Please confirm the beam depth.", dueDate: "2026-10-01", ballInCourt: "contractor", assignedToId: TEAM },
    required: [["subject", "value"], ["question", "value"]], text: ["subject", "question"], foreign: [["assignedToId", STRANGER]],
  },
  {
    fn: "answer_rfi", level: 2, minRank: 2, money: false,
    valid: { rfiId: "rfi_a", answer: "Use 450 mm, as drawing S-12." },
    required: [["rfiId", "value"], ["answer", "value"]], text: ["answer"], foreign: [["rfiId", "rfi_b"]],
  },
  { fn: "close_rfi", level: 1, minRank: 2, money: false, valid: { rfiId: "rfi_a" }, required: [["rfiId", "value"]], text: [], foreign: [["rfiId", "rfi_b"]] },
  {
    fn: "create_submittal", level: 1, minRank: 2, money: false,
    valid: { title: "Tile sample, lobby", specSection: "09 30 00", type: "product_data", dueDate: "2026-10-05" },
    required: [["title", "title"]], text: ["title", "specSection"], foreign: [],
  },
  {
    fn: "review_submittal", level: 2, minRank: 3, money: false,
    valid: { submittalId: "sub_a", status: "approved", comments: "Approved for the lobby only." },
    required: [["submittalId", "value"], ["status", "value"]], text: ["comments"], foreign: [["submittalId", "sub_b"]],
  },
  {
    fn: "create_punch_list_item", level: 1, minRank: 2, money: false,
    valid: { description: "Chipped skirting, corridor 2", location: "Level 2 corridor", trade: "Joinery", priority: "high", assignedToId: TEAM, dueDate: "2026-10-10" },
    required: [["description", "value"]], text: ["description", "location", "trade"], foreign: [["assignedToId", STRANGER]],
  },
  { fn: "mark_punch_item_ready", level: 1, minRank: 2, money: false, valid: { itemId: "punch_a_open" }, required: [["itemId", "value"]], text: [], foreign: [["itemId", "punch_b"]] },
  { fn: "verify_punch_item_closed", level: 2, minRank: 3, money: false, valid: { itemId: "punch_a" }, required: [["itemId", "value"]], text: [], foreign: [["itemId", "punch_b"]] },
  {
    fn: "create_site_diary", level: 1, minRank: 2, money: false,
    valid: { diaryDate: "2026-09-20", weather: "Hot, 41 C", workDone: "Screed, level 2", visitors: "Client rep", issues: "Late delivery", instructions: "None", materialReceived: "Tiles, 40 boxes", labourCount: 12, remarks: "All well" },
    required: [["diaryDate", "date"]], text: ["weather", "workDone", "visitors", "issues", "instructions", "materialReceived", "remarks"], foreign: [],
  },
];

describe("AW-303: the nine functions are registered, executable and writes", () => {
  test("every function of the wave has an executor and is a write (a proposal until a person confirms it)", () => {
    expect(CASES).toHaveLength(9);
    for (const c of CASES) expect({ fn: c.fn, executor: hasExecutor(c.fn), write: functionWrites(c.fn) }).toEqual({ fn: c.fn, executor: true, write: true });
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

// ---------------------------------------------------------------------------------------------------------------------------------
describe("create_rfi", () => {
  test("writes one RFI, numbered after the project's own, recorded under the acting person, and only in construction_rfis", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_rfi", CASES[0].valid));
    expect(out.route).toBe(`/rfis/${out.id}`);
    expect(changedTables(before, store)).toEqual(["construction_rfis"]);
    expect(rowsOf(store, "construction_rfis")).toHaveLength(4);
    expect(row("construction_rfis", out.id)).toMatchObject({
      projectId: PROJECT_A, number: 2, subject: "Beam depth at grid C4", question: "Please confirm the beam depth.", status: "open",
      ballInCourt: "contractor", dueDate: "2026-10-01", assignedToId: TEAM, raisedById: MANAGER,
    });
    expect(row("construction_rfis", out.id).raisedById).not.toBe(API_KEY);
  });

  test("the number counts this project's RFIs only: project B's own RFI does not move it", async () => {
    const a = resultOf(await run("create_rfi", { subject: "One", question: "One?" }));
    const b = resultOf(await run("create_rfi", { subject: "Two", question: "Two?" }, { projectId: "project_b" }));
    expect({ a: row("construction_rfis", a.id).number, b: row("construction_rfis", b.id).number }).toEqual({ a: 2, b: 2 });
  });

  test("an assignee may be the project's lead, a member of its team or the acting person; a user of the organisation who is none of them is refused", async () => {
    for (const who of [MEMBER, TEAM, MANAGER]) {
      const out = resultOf(await run("create_rfi", { subject: "S", question: "Q", assignedToId: who }));
      expect(row("construction_rfis", out.id).assignedToId).toBe(who);
    }
    const before = snapshot(store);
    const refused = failureOf(await run("create_rfi", { subject: "S", question: "Q", assignedToId: STRANGER }));
    expect(refused).toMatchObject({ code: "RECORD_NOT_FOUND", context: { param: "assignedToId" } });
    expect(snapshot(store)).toBe(before);
  });

  test("a value the service would cast unchecked is a 400 and writes nothing: ballInCourt, dueDate, a text that is not a string", async () => {
    const before = snapshot(store);
    for (const bad of [{ ballInCourt: "judge" }, { dueDate: "31/10/2026" }, { dueDate: "2026-02-30" }, { subject: 5 }, { question: { text: "q" } }]) {
      const failure = failureOf(await run("create_rfi", { subject: "S", question: "Q", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a project of another organisation, or none, is refused because the service never looks the project up", async () => {
    const before = snapshot(store);
    for (const projectId of [PROJECT_X, "no_such_project"]) {
      const failure = failureOf(await run("create_rfi", { subject: "S", question: "Q" }, { projectId }));
      expect({ projectId, code: failure.code, param: failure.context?.param }).toEqual({ projectId, code: "RECORD_NOT_FOUND", param: "projectId" });
    }
    expect(snapshot(store)).toBe(before);
  });
});

describe("answer_rfi and close_rfi", () => {
  test("answer_rfi records the answer under the acting person, hands the RFI to the contractor and touches only that RFI", async () => {
    const before = tableJson(store);
    const other = JSON.stringify(row("construction_rfis", "rfi_b"));
    const out = resultOf(await run("answer_rfi", CASES[1].valid));
    expect(out.id).toBe("rfi_a");
    expect(changedTables(before, store)).toEqual(["construction_rfis"]);
    expect(row("construction_rfis", "rfi_a")).toMatchObject({ status: "answered", answer: "Use 450 mm, as drawing S-12.", answeredById: MANAGER, ballInCourt: "contractor" });
    expect(row("construction_rfis", "rfi_a").answeredAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row("construction_rfis", "rfi_b"))).toBe(other);
  });

  test("close_rfi closes that RFI and no other", async () => {
    const other = JSON.stringify(row("construction_rfis", "rfi_b"));
    const out = resultOf(await run("close_rfi", { rfiId: "rfi_a" }));
    expect(out.id).toBe("rfi_a");
    expect(row("construction_rfis", "rfi_a").status).toBe("closed");
    expect(JSON.stringify(row("construction_rfis", "rfi_b"))).toBe(other);
  });

  test("an RFI of another organisation reads as absent for both", async () => {
    const before = snapshot(store);
    for (const [fn, params] of [["answer_rfi", { rfiId: "rfi_x", answer: "A" }], ["close_rfi", { rfiId: "rfi_x" }]] as Array<[string, Row]>) {
      expect({ fn, code: failureOf(await run(fn, params)).code }).toEqual({ fn, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot(store)).toBe(before);
  });
});

describe("create_submittal and review_submittal", () => {
  test("create_submittal writes one submittal, numbered after the project's own, submitted by the acting person", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_submittal", CASES[3].valid));
    expect(out.route).toBe(`/submittals/${out.id}`);
    expect(changedTables(before, store)).toEqual(["construction_submittals"]);
    expect(row("construction_submittals", out.id)).toMatchObject({
      projectId: PROJECT_A, number: 2, title: "Tile sample, lobby", specSection: "09 30 00", type: "product_data", status: "pending", dueDate: "2026-10-05", submittedById: MANAGER,
    });
  });

  test("a submittal type outside the closed list, and a project that does not exist, are refused with nothing written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_submittal", { title: "T", type: "gadget" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_submittal", { title: "T" }, { projectId: PROJECT_X })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("review_submittal records the decision, the comments and the reviewer, and touches only that submittal", async () => {
    const before = tableJson(store);
    const other = JSON.stringify(row("construction_submittals", "sub_b"));
    const out = resultOf(await run("review_submittal", CASES[4].valid));
    expect(out.id).toBe("sub_a");
    expect(changedTables(before, store)).toEqual(["construction_submittals"]);
    expect(row("construction_submittals", "sub_a")).toMatchObject({ status: "approved", reviewComments: "Approved for the lobby only.", reviewedById: MANAGER });
    expect(JSON.stringify(row("construction_submittals", "sub_b"))).toBe(other);
  });

  test("a decision outside the four the service knows is a 400 and writes nothing", async () => {
    const before = snapshot(store);
    for (const status of ["maybe", "pending", "APPROVED", 5]) {
      expect({ status, code: failureOf(await run("review_submittal", { submittalId: "sub_a", status })).code }).toEqual({ status, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("the independent-reviewer rule holds: the person who submitted it may not review it (403 from the service), and nothing is written", async () => {
    const before = snapshot(store);
    const failure = failureOf(await run("review_submittal", { submittalId: "sub_a", status: "approved" }, { actorUserId: MEMBER }));
    expect(failure).toMatchObject({ code: "NOT_PERMITTED", context: { status: 403 } });
    expect(snapshot(store)).toBe(before);
  });

  test("a submittal of another organisation reads as absent for both", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("review_submittal", { submittalId: "sub_x", status: "approved" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });
});

describe("the punch list", () => {
  test("create_punch_list_item writes one item, numbered after the project's own, created by the acting person, and only in its table", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_punch_list_item", CASES[5].valid));
    expect(out.route).toBe(`/punch-list/${out.id}`);
    expect(changedTables(before, store)).toEqual(["construction_punch_list_items"]);
    expect(row("construction_punch_list_items", out.id)).toMatchObject({
      projectId: PROJECT_A, number: 3, description: "Chipped skirting, corridor 2", location: "Level 2 corridor", trade: "Joinery", priority: "high", status: "open",
      assignedToId: TEAM, dueDate: "2026-10-10", createdById: MANAGER,
    });
  });

  test("a priority outside the closed list, an unreal date, a stranger as assignee and a project of another organisation are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const [params, over, code] of [
      [{ description: "D", priority: "urgent" }, {}, "REQUEST_REJECTED"],
      [{ description: "D", dueDate: "2026-13-01" }, {}, "REQUEST_REJECTED"],
      [{ description: "D", assignedToId: STRANGER }, {}, "RECORD_NOT_FOUND"],
      [{ description: "D" }, { projectId: PROJECT_X }, "RECORD_NOT_FOUND"],
    ] as Array<[Row, Partial<import("./executor").ExecutableTask>, string]>) {
      expect({ params, code: failureOf(await run("create_punch_list_item", params, over)).code }).toEqual({ params, code });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("mark_punch_item_ready moves that item to ready_for_review and touches no other", async () => {
    const other = JSON.stringify(row("construction_punch_list_items", "punch_b"));
    const out = resultOf(await run("mark_punch_item_ready", { itemId: "punch_a_open" }));
    expect(out.id).toBe("punch_a_open");
    expect(row("construction_punch_list_items", "punch_a_open").status).toBe("ready_for_review");
    expect(JSON.stringify(row("construction_punch_list_items", "punch_b"))).toBe(other);
  });

  test("verify_punch_item_closed closes it under the verifying person, who is not its assignee", async () => {
    const out = resultOf(await run("verify_punch_item_closed", { itemId: "punch_a" }));
    expect(out.id).toBe("punch_a");
    expect(row("construction_punch_list_items", "punch_a")).toMatchObject({ status: "verified_closed", verifiedById: MANAGER });
    expect(row("construction_punch_list_items", "punch_a").verifiedAt).toBeInstanceOf(Date);
  });

  test("the independent-verifier rule holds: the item's own assignee may not verify it (403 from the service), and nothing is written", async () => {
    const before = snapshot(store);
    const failure = failureOf(await run("verify_punch_item_closed", { itemId: "punch_a" }, { actorUserId: MEMBER }));
    expect(failure).toMatchObject({ code: "NOT_PERMITTED", context: { status: 403 } });
    expect(snapshot(store)).toBe(before);
  });

  test("an item of another organisation reads as absent for both", async () => {
    const before = snapshot(store);
    for (const fn of ["mark_punch_item_ready", "verify_punch_item_closed"]) {
      expect({ fn, code: failureOf(await run(fn, { itemId: "punch_x" })).code }).toEqual({ fn, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot(store)).toBe(before);
  });
});

describe("create_site_diary", () => {
  test("writes one diary entry for the day, recorded by the acting person, and only in construction_site_diaries", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_site_diary", CASES[8].valid));
    expect(out.route).toBe(`/site-diary/${out.id}`);
    expect(changedTables(before, store)).toEqual(["construction_site_diaries"]);
    expect(row("construction_site_diaries", out.id)).toMatchObject({
      projectId: PROJECT_A, diaryDate: "2026-09-20", weather: "Hot, 41 C", workDone: "Screed, level 2", visitors: "Client rep", issues: "Late delivery",
      instructions: "None", materialReceived: "Tiles, 40 boxes", labourCount: 12, remarks: "All well", recordedById: MANAGER,
    });
  });

  test("only the date is needed: the text fields of an entry that leaves them out are null", async () => {
    const out = resultOf(await run("create_site_diary", { diaryDate: "2026-09-21" }));
    expect(row("construction_site_diaries", out.id)).toMatchObject({ weather: null, workDone: null, labourCount: null, remarks: null });
  });

  test("a second entry for the same day is refused (ALREADY_RECORDED, 409) and adds nothing, so a retried call never makes two", async () => {
    const before = snapshot(store);
    const failure = failureOf(await run("create_site_diary", { diaryDate: "2026-09-01", weather: "rain" }));
    expect(failure).toMatchObject({ code: "ALREADY_RECORDED", context: { status: 409 } });
    expect(snapshot(store)).toBe(before);
  });

  test("a date that is not a real day, a labour count that is not a whole number, and a text that is not a string are 400s with nothing written", async () => {
    const before = snapshot(store);
    for (const bad of [{ diaryDate: "2026-02-30" }, { diaryDate: "20 Sep" }, { labourCount: 1.5 }, { labourCount: -3 }, { labourCount: "many" }, { weather: 7 }, { remarks: ["a"] }]) {
      const failure = failureOf(await run("create_site_diary", { diaryDate: "2026-09-22", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a project of another organisation is refused by the service's own project check", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_site_diary", { diaryDate: "2026-09-22" }, { projectId: PROJECT_X })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });
});

describe("no field of wave 3 carries money", () => {
  test("no answer of a valid call names a money field", async () => {
    const money = ["rate", "amount", "unitCost", "dailyRate", "costImpact", "cost", "price", "budget"];
    for (const c of CASES) {
      const out = await run(c.fn, c.valid);
      const text = JSON.stringify(out.success ? out.result : out);
      for (const key of money) expect({ fn: c.fn, key, present: text.includes(`"${key}"`) }).toEqual({ fn: c.fn, key, present: false });
      store = makeStore();
      seedFieldRecords(store);
    }
  });
});
