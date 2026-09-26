/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05h, register row AW-308 -- coverage wave 7: progress claims, submit for approval and KPI entries are callable by an AI
// through a project link as LEVEL-2 DRAFTS the signed-in person confirms (owner decision PMD-41), and by the internal pipeline, as the person's
// role and the project allow. No function writes an approval on its own.
//
// THE EIGHT FUNCTIONS (all level 2)
//   create_progress_claim (rank 3)   draft_progress_claim (rank 3)   submit_progress_claim (rank 3)   reject_progress_claim (rank 3)
//   submit_change_order_for_approval (rank 3)   submit_boq_for_approval (rank 3)   submit_kpi_entry (rank 2)   approve_kpi_entry (rank 3)
//
// WHAT IS PROVEN, for every function (coverage-suite.ts, registered once per function below)
//   the generated link policy is this table; the valid parameters are a valid check on a manager's link; a level-2 function is refused on the
//   direct path (403 LEVEL_NOT_ALLOWED) and is a proposal, a draft, on /propose; a viewer's link does not carry it; a missing required parameter
//   is named on a check and by the executor, which writes nothing; another project in params.projectId is PROJECT_NOT_REACHABLE; a role below
//   the minimum rank, and no role, is refused; a write that names no person is refused; an id of another project, of another organisation or of
//   no record reads as absent and the store is byte-identical afterwards; every free-text parameter is capped at 2,000 characters and cleaned.
// AND, function by function (this file)
//   a valid call writes exactly the row it should, only in the tables it should, recorded under the acting person and never the API key, re-read
//   from the store; a claim is billed to a customer the project bills (its client's, or an earlier claim's) and no other; the state machine of
//   the service stays the judge of a transition; a change order goes to external signers whose addresses are checked and whose signing tokens are
//   never returned; a BOQ that is not a draft is not submitted; an organisation-wide KPI cannot be written from a project link; a KPI value is null
//   below the manager rank; the submitter cannot approve their own KPI entry; and NOTHING approves a claim, a BOQ or a change order.
//
// WHAT IS REAL: executor.ts, function-registry.ts, the executors of executors/claims.ts and approvals.ts, the services they wrap
// (construction-billing-workflow-service.ts, construction-change-order-service.ts with esignature-service.ts, construction-boq-service.ts submitBoq,
// construction-kpi-service.ts), the free-text rule (ai-link-text.ts), the generated link policy and the Edge handler.
// WHAT IS FAKED: only @/lib/db/tenant-scoped (coverage-fixtures.ts and coverage-w79.ts: the real where clause of every query compiled and evaluated
// against fixture rows, writes committed on success and discarded on throw) and the link's own database (awl-edge-fake.ts).
// WHAT IS NOT PROVEN HERE: the direct path answers 503 today because the executor host is not switched on (WP-09), so a level-1 link write is proven
// up to that gate; /drafts answers 501 until WP-09, so "accepted as a draft" is proven on /propose and /check. submitBoq() of a REVISION also starts a
// comparison and an automation rule (fire and forget); the fixtures use a first version, so that branch is not run here.
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave7.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { API_KEY, changedTables, linkHarness, makeStore, MANAGER, MEMBER, PROJECT_A, snapshot, tableJson, TOKENS } from "./__test-helpers__/coverage-fixtures";
import { CUSTOMER_A, CUSTOMER_EARLIER, CUSTOMER_GONE, CUSTOMER_OTHER, seedWave7Records, w79WithTenantContext } from "./__test-helpers__/coverage-w79";
import { defineCoverageSuite, failureOf, fnRow, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: w79WithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedWave7Records(store);
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
const asMember = { role: "member", actorUserId: MEMBER } as const;

const CLAIM = { boqId: "boq_a", customerId: CUSTOMER_A, milestoneDescription: "Slab complete, level 2", scheduledDate: "2026-10-15", retentionPercent: 5 };
const SIGNERS = [{ name: "Asha Rao", email: "Asha@Example.com" }, { name: "Vikram Shah", email: "vikram@example.com", order: 2 }];

const CASES: Case[] = [
  {
    fn: "create_progress_claim", level: 2, minRank: 3, money: true, valid: CLAIM,
    required: [["boqId", "boqVersion"], ["customerId", "value"], ["milestoneDescription", "value"], ["scheduledDate", "date"]],
    text: ["milestoneDescription"], foreign: [["boqId", "boq_b"], ["customerId", CUSTOMER_OTHER]],
  },
  { fn: "draft_progress_claim", level: 2, minRank: 3, money: true, valid: { claimId: "claim_a" }, required: [["claimId", "value"]], text: [], foreign: [["claimId", "claim_b"]] },
  { fn: "submit_progress_claim", level: 2, minRank: 3, money: true, valid: { claimId: "claim_a_drafted" }, required: [["claimId", "value"]], text: [], foreign: [["claimId", "claim_b"]] },
  {
    fn: "reject_progress_claim", level: 2, minRank: 3, money: true, valid: { claimId: "claim_a_submitted", rejectionReason: "Quantities do not match the site measurement" },
    required: [["claimId", "value"]], text: ["rejectionReason"], foreign: [["claimId", "claim_b"]],
  },
  {
    fn: "submit_change_order_for_approval", level: 2, minRank: 3, money: true, valid: { changeOrderId: "co_a", signers: SIGNERS },
    required: [["changeOrderId", "value"], ["signers", "value"]], text: [], foreign: [["changeOrderId", "co_b"]],
  },
  { fn: "submit_boq_for_approval", level: 2, minRank: 3, money: true, valid: { boqId: "boq_a" }, required: [["boqId", "boqVersion"]], text: [], foreign: [["boqId", "boq_b"]] },
  {
    fn: "submit_kpi_entry", level: 2, minRank: 2, money: true, valid: { kpiDefinitionId: "kpi_a", period: "2026-09", actualValue: 92 },
    required: [["kpiDefinitionId", "value"], ["period", "value"], ["actualValue", "value"]], text: ["period"], foreign: [["kpiDefinitionId", "kpi_b"]],
  },
  { fn: "approve_kpi_entry", level: 2, minRank: 3, money: true, valid: { entryId: "kentry_a" }, required: [["entryId", "value"]], text: [], foreign: [["entryId", "kentry_b"]] },
];

describe("AW-308: the eight functions are registered, executable, writes, and level 2 on a link", () => {
  test("every function of the wave has an executor, is a write, and is level 2 in the generated policy (a draft the person confirms, never direct)", () => {
    expect(CASES).toHaveLength(8);
    for (const c of CASES) {
      expect({ fn: c.fn, executor: hasExecutor(c.fn), write: functionWrites(c.fn), level: fnRow(c.fn).link_level }).toEqual({ fn: c.fn, executor: true, write: true, level: 2 });
    }
  });

  test("no function writes an approval on its own: nothing approves a claim, a BOQ or a change order, and nothing invoices a claim", async () => {
    for (const id of ["approve_progress_claim", "approve_billing_claim", "invoice_approved_claim", "approve_boq", "approve_change_order", "mark_change_order_approved", "reject_change_order"]) {
      expect({ id, executor: hasExecutor(id) }).toEqual({ id, executor: false });
      expect(failureOf(await run(id, { claimId: "claim_a_submitted", boqId: "boq_a", changeOrderId: "co_a" })).code).toBe("FUNCTION_NOT_AVAILABLE");
    }
  });

  test("every wave 7 function is refused on the direct path of a link, even for a manager (403 LEVEL_NOT_ALLOWED), so the person's own confirmation is the only way in", async () => {
    const { action } = linkHarness();
    for (const c of CASES) {
      const res = await action(TOKENS.manager, c.fn, c.valid);
      expect({ fn: c.fn, status: res.status, code: res.body.code }).toEqual({ fn: c.fn, status: 403, code: "LEVEL_NOT_ALLOWED" });
    }
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

// ---------------------------------------------------------------------------------------------------------------------------------
describe("create_progress_claim", () => {
  test("writes one claim in 'milestone achieved', recorded under the acting person, and only in construction_progress_claims: nothing is invoiced or sent", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_progress_claim", CLAIM));
    expect(out.route).toBe(`/billing-milestones/${out.id}`);
    expect(changedTables(before, store)).toEqual(["construction_progress_claims"]);
    expect(row("construction_progress_claims", out.id)).toMatchObject({
      projectId: PROJECT_A, boqId: "boq_a", customerId: CUSTOMER_A, milestoneDescription: "Slab complete, level 2", scheduledDate: "2026-10-15",
      retentionPercent: "5", status: "milestone_achieved", createdById: MANAGER,
    });
    expect(row("construction_progress_claims", out.id).createdById).not.toBe(API_KEY);
    expect(row("construction_progress_claims", out.id).interimBillId ?? null).toBeNull();
  });

  test("the retention defaults to 0; a value over 100, below 0 or not a number is a 400 and writes nothing", async () => {
    const { retentionPercent: _drop, ...noRetention } = CLAIM;
    const ok = resultOf(await run("create_progress_claim", noRetention));
    expect(row("construction_progress_claims", ok.id).retentionPercent).toBe("0");
    const before = snapshot(store);
    for (const retentionPercent of [101, -1, "lots", Number.NaN, Infinity]) {
      expect({ retentionPercent, code: failureOf(await run("create_progress_claim", { ...CLAIM, retentionPercent })).code }).toEqual({ retentionPercent, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("the customer must be one the project bills: its client's customer or the customer of an earlier claim; any other, and an inactive one, reads as absent", async () => {
    resultOf(await run("create_progress_claim", { ...CLAIM, customerId: CUSTOMER_EARLIER }));
    const before = snapshot(store);
    for (const customerId of [CUSTOMER_OTHER, CUSTOMER_GONE, "no_such_customer"]) {
      const failure = failureOf(await run("create_progress_claim", { ...CLAIM, customerId }));
      expect({ customerId, code: failure.code }).toEqual({ customerId, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("an unreal date, a missing project and text over the cap are refused with nothing written; control characters are removed from the milestone", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_progress_claim", { ...CLAIM, scheduledDate: "2026-02-30" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_progress_claim", { ...CLAIM, milestoneDescription: "a".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_progress_claim", { ...CLAIM, milestoneDescription: "   " })).code).toBe("TITLE_REQUIRED");
    expect(failureOf(await run("create_progress_claim", CLAIM, { projectId: "project_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
    const clean = resultOf(await run("create_progress_claim", { ...CLAIM, milestoneDescription: "Slab\u0000 done‮ ```x```" }));
    expect(row("construction_progress_claims", clean.id).milestoneDescription).toBe("Slab done ''x''");
  });

  test("a member is refused even with valid parameters (the money rank), and the claim is not created", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_progress_claim", CLAIM, asMember)).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
  });
});

describe("draft_progress_claim, submit_progress_claim and reject_progress_claim: the service's state machine stays the only judge", () => {
  test("the walk a claim takes: milestone achieved, drafted, submitted, then queried; each step changes only that claim and only its status columns", async () => {
    const before = tableJson(store);
    const other = JSON.stringify(row("construction_progress_claims", "claim_b"));
    expect(resultOf(await run("draft_progress_claim", { claimId: "claim_a" })).route).toBe("/billing-milestones/claim_a");
    expect(row("construction_progress_claims", "claim_a")).toMatchObject({ status: "drafted" });
    expect(row("construction_progress_claims", "claim_a").draftedAt).toBeTruthy();
    resultOf(await run("submit_progress_claim", { claimId: "claim_a" }));
    expect(row("construction_progress_claims", "claim_a")).toMatchObject({ status: "submitted" });
    expect(row("construction_progress_claims", "claim_a").submittedAt).toBeTruthy();
    resultOf(await run("reject_progress_claim", { claimId: "claim_a", rejectionReason: "  Rates queried \u0000 by the client ```  " }));
    expect(row("construction_progress_claims", "claim_a")).toMatchObject({ status: "rejected", rejectionReason: "Rates queried  by the client ''" });
    expect(row("construction_progress_claims", "claim_a").rejectedAt).toBeTruthy();
    expect(changedTables(before, store)).toEqual(["construction_progress_claims"]);
    expect(JSON.stringify(row("construction_progress_claims", "claim_b"))).toBe(other);
  });

  test("a step out of order is the service's own 409: a milestone cannot be submitted, a drafted claim cannot be drafted or queried; nothing is written", async () => {
    const before = snapshot(store);
    for (const [fn, claimId] of [["submit_progress_claim", "claim_a"], ["draft_progress_claim", "claim_a_drafted"], ["reject_progress_claim", "claim_a_drafted"], ["draft_progress_claim", "claim_a_submitted"]] as const) {
      const failure = failureOf(await run(fn, { claimId }));
      expect({ fn, claimId, code: failure.code, status: failure.context?.status }).toEqual({ fn, claimId, code: "ALREADY_RECORDED", status: 409 });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("the claim is never approved or invoiced by any of them: the status set they can reach is drafted, submitted and rejected", async () => {
    const reached = new Set<string>();
    for (const [fn, claimId] of [["draft_progress_claim", "claim_a"], ["submit_progress_claim", "claim_a_drafted"], ["reject_progress_claim", "claim_a_submitted"]] as const) {
      resultOf(await run(fn, { claimId }));
      reached.add(String(row("construction_progress_claims", claimId).status));
    }
    expect([...reached].sort()).toEqual(["drafted", "rejected", "submitted"]);
    expect(rowsOf(store, "construction_interim_bills")).toHaveLength(0);
    expect(rowsOf(store, "erp_sales_invoices")).toHaveLength(0);
  });

  test("a rejection reason is optional (stored as none) and over 2,000 characters is a 400 with nothing written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("reject_progress_claim", { claimId: "claim_a_submitted", rejectionReason: "b".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
    resultOf(await run("reject_progress_claim", { claimId: "claim_a_submitted" }));
    expect(row("construction_progress_claims", "claim_a_submitted").rejectionReason ?? null).toBeNull();
  });

  test("a member is refused each of the three", async () => {
    const before = snapshot(store);
    for (const [fn, claimId] of [["draft_progress_claim", "claim_a"], ["submit_progress_claim", "claim_a_drafted"], ["reject_progress_claim", "claim_a_submitted"]] as const) {
      expect({ fn, code: failureOf(await run(fn, { claimId }, asMember)).code }).toEqual({ fn, code: "NOT_PERMITTED" });
    }
    expect(snapshot(store)).toBe(before);
  });
});

describe("submit_change_order_for_approval", () => {
  test("creates one e-signature request and one signer row per person, moves the change order to pending approval, and touches nothing else", async () => {
    const before = tableJson(store);
    const other = JSON.stringify(row("construction_change_orders", "co_b"));
    const out = resultOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: SIGNERS }));
    expect(out.id).toBe("co_a");
    expect(changedTables(before, store)).toEqual(["construction_change_orders", "esignature_requests", "esignature_signers"]);
    const request = rowsOf(store, "esignature_requests")[0];
    expect(request).toMatchObject({ linkedEntityType: "change_order", linkedEntityId: "co_a", createdById: MANAGER });
    expect(String(request.documentHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(row("construction_change_orders", "co_a")).toMatchObject({ status: "pending_approval", esignatureRequestId: request.id });
    const signers = rowsOf(store, "esignature_signers");
    expect(signers.map((s) => ({ name: s.name, email: s.email, requestId: s.requestId })).sort((a, b) => String(a.email).localeCompare(String(b.email)))).toEqual([
      { name: "Asha Rao", email: "asha@example.com", requestId: request.id },
      { name: "Vikram Shah", email: "vikram@example.com", requestId: request.id },
    ]);
    expect(JSON.stringify(row("construction_change_orders", "co_b"))).toBe(other);
  });

  test("the answer carries the change order and no signing token or signer address", async () => {
    const out = resultOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: SIGNERS }));
    const text = JSON.stringify(out);
    expect(text).not.toContain("esig_");
    expect(text).not.toContain("asha@example.com");
    expect(text).not.toContain("accessToken");
  });

  test("the signers may come as a JSON list in a string (a link's GET /propose carries every value as a string)", async () => {
    resultOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: JSON.stringify(SIGNERS) }));
    expect(rowsOf(store, "esignature_signers")).toHaveLength(2);
  });

  test("a signer list that is not names with well-formed, different addresses is a 400 and writes nothing", async () => {
    const before = snapshot(store);
    const bad: unknown[] = [
      [],
      "not a list",
      [{ name: "No Email" }],
      [{ email: "nobody@example.com" }],
      [{ name: "A", email: "not an email" }],
      [{ name: "A", email: "a@b" }],
      [{ name: "A", email: "a b@example.com" }],
      [{ name: "A", email: "a@example.com, b@example.com" }],
      [{ name: "A", email: "a@example.com" }, { name: "B", email: "A@EXAMPLE.COM" }],
      [{ name: "A", email: "a@example.com", order: 0 }],
      [{ name: "A", email: "a@example.com", order: 11 }],
      [{ name: "a".repeat(2001), email: "a@example.com" }],
      [{ name: "A".repeat(201), email: "a@example.com" }],
      [{ name: "A", email: `${"x".repeat(250)}@example.com` }],
      [null],
      [["A", "a@example.com"]],
      Array.from({ length: 11 }, (_, i) => ({ name: `Signer ${i}`, email: `s${i}@example.com` })),
      "{not json",
    ];
    for (const signers of bad) {
      const failure = failureOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers }));
      expect({ signers: JSON.stringify(signers).slice(0, 40), code: failure.code }).toEqual({ signers: JSON.stringify(signers).slice(0, 40), code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("ten signers are accepted and control characters are removed from a name", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: i === 0 ? "Asha\u0000 Rao‮" : `Signer ${i}`, email: `s${i}@example.com`, order: i + 1 }));
    resultOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: ten }));
    const signers = rowsOf(store, "esignature_signers");
    expect(signers).toHaveLength(10);
    expect(signers.find((s) => s.email === "s0@example.com")!.name).toBe("Asha Rao");
  });

  test("a change order that is not a draft is the service's own 400, and a person who is not an active user of the organisation is refused; nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a_sent", signers: SIGNERS })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: SIGNERS }, { actorUserId: "person_ghost" })).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
  });

  test("a second submission of the same change order is refused (it is no longer a draft) and adds no request", async () => {
    resultOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: SIGNERS }));
    const before = snapshot(store);
    expect(failureOf(await run("submit_change_order_for_approval", { changeOrderId: "co_a", signers: SIGNERS })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
    expect(rowsOf(store, "esignature_requests")).toHaveLength(1);
  });
});

describe("submit_boq_for_approval", () => {
  test("moves one draft BOQ to submitted and touches no other BOQ", async () => {
    const before = tableJson(store);
    const other = JSON.stringify(row("construction_boqs", "boq_b"));
    const out = resultOf(await run("submit_boq_for_approval", { boqId: "boq_a" }));
    expect(out.route).toBe("/scope/boq_a");
    expect(changedTables(before, store)).toEqual(["construction_boqs"]);
    expect(row("construction_boqs", "boq_a")).toMatchObject({ status: "submitted" });
    expect(JSON.stringify(row("construction_boqs", "boq_b"))).toBe(other);
    expect(row("construction_boqs", "boq_a").status).not.toBe("approved");
  });

  test("a BOQ that is already submitted is the service's own 400 and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("submit_boq_for_approval", { boqId: "boq_a_sent" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });
});

describe("submit_kpi_entry", () => {
  test("writes one submitted entry for the project's KPI under the acting person; the value is null below the manager rank and only there", async () => {
    const before = tableJson(store);
    const manager = resultOf<{ id: string; route: string; record: Row }>(await run("submit_kpi_entry", CASES[6].valid));
    expect(manager.route).toBe("/kpis");
    expect(changedTables(before, store)).toEqual(["construction_kpi_entries"]);
    expect(row("construction_kpi_entries", manager.id)).toMatchObject({ kpiDefinitionId: "kpi_a", period: "2026-09", actualValue: "92", approvalStatus: "submitted", filledById: MANAGER });
    expect(manager.record.actualValue).toBe("92");
    const member = resultOf<{ id: string; record: Row }>(await run("submit_kpi_entry", { ...CASES[6].valid, period: "2026-10" }, asMember));
    expect(member.record.actualValue).toBeNull();
    expect(member.record.financialsRedacted).toBe(true);
    expect(row("construction_kpi_entries", member.id)).toMatchObject({ actualValue: "92", filledById: MEMBER });
  });

  test("an organisation-wide KPI, a KPI of another project and one of another organisation read as absent from a project link", async () => {
    const before = snapshot(store);
    for (const kpiDefinitionId of ["kpi_org", "kpi_b", "kpi_x"]) {
      expect({ kpiDefinitionId, code: failureOf(await run("submit_kpi_entry", { ...CASES[6].valid, kpiDefinitionId })).code }).toEqual({ kpiDefinitionId, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a value that is not a finite number, a period over 40 characters and a blank period are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const actualValue of ["lots", Number.NaN, Infinity, 1e13, {}, [1]]) {
      expect({ actualValue: String(actualValue), code: failureOf(await run("submit_kpi_entry", { ...CASES[6].valid, actualValue })).code }).toEqual({ actualValue: String(actualValue), code: "REQUEST_REJECTED" });
    }
    expect(failureOf(await run("submit_kpi_entry", { ...CASES[6].valid, period: "p".repeat(41) })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("submit_kpi_entry", { ...CASES[6].valid, period: "  " })).code).toBe("VALUE_REQUIRED");
    expect(snapshot(store)).toBe(before);
  });

  test("zero and a negative value are real values and are stored", async () => {
    const zero = resultOf(await run("submit_kpi_entry", { ...CASES[6].valid, actualValue: 0, period: "2026-01" }));
    const negative = resultOf(await run("submit_kpi_entry", { ...CASES[6].valid, actualValue: -12.5, period: "2026-02" }));
    expect(row("construction_kpi_entries", zero.id).actualValue).toBe("0");
    expect(row("construction_kpi_entries", negative.id).actualValue).toBe("-12.5");
  });
});

describe("approve_kpi_entry", () => {
  test("approves one submitted entry in the manager's name and touches no other entry", async () => {
    const before = tableJson(store);
    const others = JSON.stringify(rowsOf(store, "construction_kpi_entries").filter((r) => r.id !== "kentry_a"));
    const out = resultOf(await run("approve_kpi_entry", { entryId: "kentry_a" }));
    expect(out.id).toBe("kentry_a");
    expect(changedTables(before, store)).toEqual(["construction_kpi_entries"]);
    expect(row("construction_kpi_entries", "kentry_a")).toMatchObject({ approvalStatus: "approved", approvedById: MANAGER });
    expect(row("construction_kpi_entries", "kentry_a").approvedAt).toBeTruthy();
    expect(JSON.stringify(rowsOf(store, "construction_kpi_entries").filter((r) => r.id !== "kentry_a"))).toBe(others);
  });

  test("the submitter cannot approve their own entry (the service's 403 reaches the caller) and nothing is written", async () => {
    const before = snapshot(store);
    const failure = failureOf(await run("approve_kpi_entry", { entryId: "kentry_a_mine" }));
    expect(failure).toMatchObject({ code: "NOT_PERMITTED", context: { status: 403 } });
    expect(snapshot(store)).toBe(before);
  });

  test("an entry that is not waiting for approval, an entry of an organisation-wide KPI and one of another organisation are refused with nothing written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("approve_kpi_entry", { entryId: "kentry_a_done" })).code).toBe("REQUEST_REJECTED");
    for (const entryId of ["kentry_org", "kentry_x"]) expect({ entryId, code: failureOf(await run("approve_kpi_entry", { entryId })).code }).toEqual({ entryId, code: "RECORD_NOT_FOUND" });
    expect(snapshot(store)).toBe(before);
  });

  test("a member is refused: an approval is a decision of the manager rank", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("approve_kpi_entry", { entryId: "kentry_a" }, asMember)).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
  });
});
