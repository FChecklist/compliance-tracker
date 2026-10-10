/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05g, register row AW-307 -- coverage waves 8 and 9: permits, document details, the project wiki, mood boards, FF&E items and
// floor plans are callable by an AI through a project link, and by the internal pipeline, as the person's role and the project allow.
//
// THE TWELVE FUNCTIONS
//   wave 8  create_permit (level 1, rank 2)  update_document_metadata (1, 2)  create_wiki_page (1, 2)  update_wiki_page (1, 2)
//           create_mood_board (1, 2)  add_mood_board_item (1, 2)  create_ffe_item (2, 2, money)  update_ffe_status (2, 3, money)
//           get_ffe_margin_summary (0, 3, money)
//   wave 9  create_floor_plan (1, 2)  add_room (1, 2)  place_furniture (1, 2)
//
// WHAT IS PROVEN, for every function (coverage-suite.ts, registered once per function below)
//   the generated link policy is this table; the valid parameters are a valid check on a manager's link; a level-0 function is not an action, a
//   level-1 function passes the direct path up to the executor gate (503, never 403 or 422), a level-2 function is refused on the direct path
//   (403 LEVEL_NOT_ALLOWED) and is a proposal on /propose; a viewer's link does not carry it; a missing required parameter is 422 with `missing` on
//   the direct path and is named on a check; the executor names a missing parameter and writes nothing; another project in params.projectId is
//   PROJECT_NOT_REACHABLE; a role below the minimum rank, and no role, is refused; a write that names no person is refused; an id of another
//   project, of another organisation or of no record reads as absent and the store is byte-identical afterwards; every free-text parameter is capped
//   at 2,000 characters and cleaned by the rule a link submission gets.
// AND, function by function (this file)
//   a valid call writes exactly the row it should, only in the table it should, under the acting person and never the API key, re-read from the
//   store; a permit is a link to an https address (never fetched) with its number, authority and dates; a document's details change without
//   re-linking it to another project; a wiki page gets an unused slug, its version goes up on every edit, and archiving stays with the person; a
//   mood board item, a placement and a room are held to the plan and the project they name; an FF&E item's cost and price are null below the manager
//   rank and feed the margin summary, which a member cannot read; organisation records (a supplier, a room's materials) are never taken from a link.
//
// WHAT IS REAL: executor.ts, function-registry.ts, the executors of executors/documents-wiki.ts and interior.ts, the services they wrap
// (document-service.ts, pms-wiki-service.ts, interior-design-service.ts, interior-floorplan-service.ts), the free-text rule (ai-link-text.ts), the
// generated link policy and the Edge handler.
// WHAT IS FAKED: only @/lib/db/tenant-scoped (coverage-fixtures.ts and coverage-w79.ts) and the link's own database (awl-edge-fake.ts).
// WHAT IS NOT PROVEN HERE: the direct path answers 503 today because the executor host is not switched on (WP-09), so a level-1 link write is proven
// up to that gate and the executor separately; /drafts answers 501 until WP-09, so "accepted as a draft" is proven on /propose and /check. A permit is
// never uploaded from a task (a task carries JSON, not bytes), so the storage branch of createDocumentRecord is not run.
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave8-9.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { API_KEY, changedTables, makeStore, MANAGER, MEMBER, ORG, PROJECT_A, snapshot, tableJson } from "./__test-helpers__/coverage-fixtures";
import { seedWave89Records, w79WithTenantContext } from "./__test-helpers__/coverage-w79";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: w79WithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
let cache: typeof import("@/lib/services/project-dashboard-cache");
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
  cache = await import("@/lib/services/project-dashboard-cache");
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedWave89Records(store);
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

const PERMIT = {
  name: "Fit-out permit", externalUrl: "https://example.com/permits/fitout-2026.pdf", permitNumber: "FO-2026-114", permitAuthority: "Dubai Municipality",
  expiryDate: "2027-03-31", issueDate: "2026-09-01",
};
const SQUARE = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }];
const FFE = {
  itemName: "Lounge chair", roomOrArea: "Living", category: "furniture", description: "Boucle, ivory", sku: "LC-100", quantity: 2, unitCost: 900, unitPrice: 1400,
  leadTimeDays: 45, documentId: "doc_a", widthCm: 80, depthCm: 85, heightCm: 90,
};

const CASES: Case[] = [
  {
    fn: "create_permit", level: 1, minRank: 2, money: false, valid: PERMIT,
    required: [["name", "value"], ["externalUrl", "externalUrl"], ["permitNumber", "value"], ["permitAuthority", "value"], ["expiryDate", "date"]],
    text: ["name", "externalUrl", "permitNumber", "permitAuthority"], foreign: [],
  },
  {
    fn: "update_document_metadata", level: 1, minRank: 2, money: false, valid: { documentId: "doc_a", name: "Fit-out permit, stamped", category: "permit", expiryDate: "2027-04-30" },
    required: [["documentId", "value"]], text: ["name", "category"], foreign: [["documentId", "doc_b"]],
  },
  {
    fn: "create_wiki_page", level: 1, minRank: 2, money: false, valid: { title: "Site access rules", content: "Deliveries between 7 and 11 only.", parentPageId: "wiki_a" },
    required: [["title", "value"]], text: ["title", "content"], foreign: [["parentPageId", "wiki_b"]],
  },
  {
    fn: "update_wiki_page", level: 1, minRank: 2, money: false, valid: { pageId: "wiki_a", title: "Site rules, v2", content: "Hard hats and boots." },
    required: [["pageId", "value"]], text: ["title", "content"], foreign: [["pageId", "wiki_b"]],
  },
  {
    fn: "create_mood_board", level: 1, minRank: 2, money: false, valid: { title: "Master bedroom", roomOrArea: "Level 2", description: "Warm neutrals, brushed brass." },
    required: [["title", "value"]], text: ["title", "roomOrArea", "description"], foreign: [],
  },
  {
    fn: "add_mood_board_item", level: 1, minRank: 2, money: false, valid: { moodBoardId: "mb_a", documentId: "doc_a", label: "Oak veneer sample", notes: "Matte finish" },
    required: [["moodBoardId", "value"]], text: ["label", "notes"], foreign: [["moodBoardId", "mb_b"], ["documentId", "doc_b"]],
  },
  { fn: "create_ffe_item", level: 2, minRank: 2, money: true, valid: FFE, required: [["itemName", "value"]], text: ["itemName", "roomOrArea", "description", "sku"], foreign: [["documentId", "doc_b"]] },
  {
    fn: "update_ffe_status", level: 2, minRank: 3, money: true, valid: { itemId: "ffe_a", status: "ordered" },
    required: [["itemId", "value"], ["status", "value"]], text: [], foreign: [["itemId", "ffe_b"]],
  },
  { fn: "get_ffe_margin_summary", level: 0, minRank: 3, money: true, valid: {}, required: [], text: [], foreign: [] },
  { fn: "create_floor_plan", level: 1, minRank: 2, money: false, valid: { name: "Level 2", floorLevel: "2" }, required: [["name", "value"]], text: ["name", "floorLevel"], foreign: [] },
  {
    fn: "add_room", level: 1, minRank: 2, money: false, valid: { floorPlanId: "fp_a", name: "Living", polygon: SQUARE, ceilingHeightCm: 270 },
    required: [["floorPlanId", "value"], ["name", "value"], ["polygon", "value"]], text: ["name"], foreign: [["floorPlanId", "fp_b"]],
  },
  {
    fn: "place_furniture", level: 1, minRank: 2, money: false, valid: { floorPlanId: "fp_a", ffeItemId: "ffe_a", roomId: "room_a", x: 120, y: 80, rotationDeg: 90 },
    required: [["floorPlanId", "value"], ["ffeItemId", "value"]], text: [], foreign: [["floorPlanId", "fp_b"], ["ffeItemId", "ffe_b"], ["roomId", "room_b"]],
  },
];
const CASE = (fn: string) => CASES.find((c) => c.fn === fn)!;

describe("AW-307: the twelve functions are registered and executable; the writes are writes and the margin summary is a read", () => {
  test("every function of the two waves has an executor; all but the margin summary are writes (a proposal until a person confirms it)", () => {
    expect(CASES).toHaveLength(12);
    for (const c of CASES) expect({ fn: c.fn, executor: hasExecutor(c.fn), write: functionWrites(c.fn) }).toEqual({ fn: c.fn, executor: true, write: c.level !== 0 });
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

// ---------------------------------------------------------------------------------------------------------------------------------
describe("create_permit", () => {
  test("writes one permit document linked to the project, with its number, authority and dates, recorded under the acting person, and only in documents", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_permit", PERMIT));
    expect(out.route).toBe(`/permits/${out.id}`);
    expect(changedTables(before, store)).toEqual(["documents"]);
    const doc = row("documents", out.id);
    expect(doc).toMatchObject({
      name: "Fit-out permit", category: "permit", fileUrl: "https://example.com/permits/fitout-2026.pdf", linkedEntityType: "project", linkedEntityId: PROJECT_A,
      uploadedById: MANAGER, orgId: ORG, isLatestVersion: true, versionNumber: 1,
    });
    expect(doc.uploadedById).not.toBe(API_KEY);
    expect(doc.metadata).toEqual({ isExternalLink: true, permitAuthority: "Dubai Municipality", permitNumber: "FO-2026-114", issueDate: "2026-09-01" });
    expect(new Date(doc.expiryDate as string).toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  test("the issue date is optional (stored as none)", async () => {
    const { issueDate: _drop, ...noIssue } = PERMIT;
    const out = resultOf(await run("create_permit", noIssue));
    expect((row("documents", out.id).metadata as Row).issueDate).toBeNull();
  });

  test("only an https address is kept: http, other schemes, relative paths and a blank are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const externalUrl of ["http://example.com/p.pdf", "javascript:alert(1)", "ftp://example.com/p.pdf", "/permits/p.pdf", "example.com/p.pdf", "https://", `https://example.com/${"a".repeat(2000)}`]) {
      const code = failureOf(await run("create_permit", { ...PERMIT, externalUrl })).code;
      expect({ externalUrl: externalUrl.slice(0, 40), code }).toEqual({ externalUrl: externalUrl.slice(0, 40), code: "REQUEST_REJECTED" });
    }
    expect(failureOf(await run("create_permit", { ...PERMIT, externalUrl: "  " })).code).toBe("LINK_REQUIRED");
    expect(snapshot(store)).toBe(before);
  });

  test("dates must be real days and the permit must not end before it was issued; a project that does not exist is refused; nothing is written", async () => {
    const before = snapshot(store);
    for (const over of [{ expiryDate: "2027-02-30" }, { expiryDate: "31/03/2027" }, { issueDate: "2026-13-01" }, { issueDate: "2027-04-01" }]) {
      expect({ over, code: failureOf(await run("create_permit", { ...PERMIT, ...over })).code }).toEqual({ over, code: "REQUEST_REJECTED" });
    }
    expect(failureOf(await run("create_permit", PERMIT, { projectId: "project_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("control characters are removed from the number and the authority", async () => {
    const out = resultOf(await run("create_permit", { ...PERMIT, permitNumber: "FO\u0000-2026‮-114", permitAuthority: "Dubai ```Municipality```" }));
    expect(row("documents", out.id).metadata).toMatchObject({ permitNumber: "FO-2026-114", permitAuthority: "Dubai ''Municipality''" });
  });

  test("a new permit drops the project dashboard's cached figure, as the permits route does", async () => {
    cache.writeDashboardCache(ORG, PROJECT_A, { permitsExpiring: 0 });
    expect(cache.readDashboardCache(ORG, PROJECT_A)).toEqual({ permitsExpiring: 0 });
    resultOf(await run("create_permit", PERMIT));
    expect(cache.readDashboardCache(ORG, PROJECT_A)).toBeNull();
  });
});

describe("update_document_metadata", () => {
  test("changes the name, the category and the expiry date of a project document, and nothing else about it", async () => {
    const before = tableJson(store);
    const others = JSON.stringify(rowsOf(store, "documents").filter((d) => d.id !== "doc_a"));
    const out = resultOf(await run("update_document_metadata", CASE("update_document_metadata").valid));
    expect(out.route).toBe("/documents/doc_a");
    expect(changedTables(before, store)).toEqual(["documents"]);
    const doc = row("documents", "doc_a");
    expect(doc).toMatchObject({ name: "Fit-out permit, stamped", category: "permit", linkedEntityType: "project", linkedEntityId: PROJECT_A, fileUrl: "https://example.com/permit.pdf" });
    expect(new Date(doc.expiryDate as string).toISOString().slice(0, 10)).toBe("2027-04-30");
    expect(doc.metadata).toEqual({ isExternalLink: true, permitNumber: "FO-1" });
    expect(JSON.stringify(rowsOf(store, "documents").filter((d) => d.id !== "doc_a"))).toBe(others);
  });

  test("one field alone is enough, and a document that names the project in its metadata (a drawing) is the project's", async () => {
    resultOf(await run("update_document_metadata", { documentId: "doc_a_meta", name: "AR-101 plan, rev B" }));
    expect(row("documents", "doc_a_meta")).toMatchObject({ name: "AR-101 plan, rev B", category: "drawing", linkedEntityType: "permit", linkedEntityId: "permit_x" });
  });

  test("a document that is not this project's (another project, no project, another organisation's id) reads as absent; nothing is written", async () => {
    const before = snapshot(store);
    for (const documentId of ["doc_b", "doc_none", "no_such_record"]) {
      expect({ documentId, code: failureOf(await run("update_document_metadata", { documentId, name: "X" })).code }).toEqual({ documentId, code: "RECORD_NOT_FOUND" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("nothing to change, a blank name or category, a category over 60 characters and an unreal date are 400s with nothing written; the link's own fields are never taken", async () => {
    const before = snapshot(store);
    for (const params of [{}, { name: "  " }, { category: "  " }, { category: "c".repeat(61) }, { expiryDate: "2027-02-30" }, { name: 5 }]) {
      expect({ params, code: failureOf(await run("update_document_metadata", { documentId: "doc_a", ...params })).code }).toEqual({ params, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
    // an attempt to re-link the document to another project, or to patch its metadata, is dropped: only three fields are read
    resultOf(await run("update_document_metadata", { documentId: "doc_a", name: "Renamed", linkedEntityType: "project", linkedEntityId: "project_b", metadata: { permitNumber: "HACK" } }));
    expect(row("documents", "doc_a")).toMatchObject({ name: "Renamed", linkedEntityId: PROJECT_A });
    expect((row("documents", "doc_a").metadata as Row).permitNumber).toBe("FO-1");
  });
});

describe("the project wiki", () => {
  test("create_wiki_page writes one page with an unused slug under the acting person, version 1, and only in pms_wiki_pages", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_wiki_page", CASE("create_wiki_page").valid));
    expect(out.route).toBe(`/wiki/${out.id}`);
    expect(changedTables(before, store)).toEqual(["pms_wiki_pages"]);
    expect(row("pms_wiki_pages", out.id)).toMatchObject({
      projectId: PROJECT_A, slug: "site-access-rules", title: "Site access rules", content: "Deliveries between 7 and 11 only.", parentPageId: "wiki_a", version: 1, updatedById: MANAGER,
    });
  });

  test("a second page with the same title gets the next slug, and a page with no text (or a blank one) is stored with none", async () => {
    const first = resultOf(await run("create_wiki_page", { title: "Fresh page" }));
    const second = resultOf(await run("create_wiki_page", { title: "Fresh page", content: "   " }));
    expect(row("pms_wiki_pages", first.id).slug).toBe("fresh-page");
    expect(row("pms_wiki_pages", second.id).slug).toBe("fresh-page-1");
    expect(row("pms_wiki_pages", second.id).content ?? null).toBeNull();
    // the fixture's own "Site rules" page holds the plain slug, so a page with that title takes the next one
    const third = resultOf(await run("create_wiki_page", { title: "Site rules" }));
    expect(row("pms_wiki_pages", third.id).slug).toBe("site-rules-1");
  });

  test("a parent that is archived, of another project or absent is refused; text that is nothing once cleaned is a 400; a project that does not exist is refused; nothing is written", async () => {
    const before = snapshot(store);
    for (const parentPageId of ["wiki_a_old", "wiki_b", "no_such_record"]) {
      expect({ parentPageId, code: failureOf(await run("create_wiki_page", { title: "T", parentPageId })).code }).toEqual({ parentPageId, code: "RECORD_NOT_FOUND" });
    }
    expect(failureOf(await run("create_wiki_page", { title: "T", content: " ​" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_wiki_page", { title: "T", content: "c".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_wiki_page", { title: "T" }, { projectId: "project_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("update_wiki_page replaces the title and the text, raises the version by one and records the person; no other page changes", async () => {
    const before = tableJson(store);
    const others = JSON.stringify(rowsOf(store, "pms_wiki_pages").filter((p) => p.id !== "wiki_a"));
    resultOf(await run("update_wiki_page", CASE("update_wiki_page").valid));
    expect(changedTables(before, store)).toEqual(["pms_wiki_pages"]);
    expect(row("pms_wiki_pages", "wiki_a")).toMatchObject({ title: "Site rules, v2", content: "Hard hats and boots.", version: 2, updatedById: MANAGER, slug: "site-rules", isArchived: false });
    resultOf(await run("update_wiki_page", { pageId: "wiki_a", content: "Boots only." }));
    expect(row("pms_wiki_pages", "wiki_a")).toMatchObject({ title: "Site rules, v2", content: "Boots only.", version: 3 });
    expect(JSON.stringify(rowsOf(store, "pms_wiki_pages").filter((p) => p.id !== "wiki_a"))).toBe(others);
  });

  test("archiving stays with the person: isArchived and every other field of the patch are dropped, and an archived page reads as absent", async () => {
    resultOf(await run("update_wiki_page", { pageId: "wiki_a", title: "Kept", isArchived: true, projectId: PROJECT_A, version: 99, slug: "hacked" }));
    expect(row("pms_wiki_pages", "wiki_a")).toMatchObject({ title: "Kept", isArchived: false, version: 2, slug: "site-rules" });
    const before = snapshot(store);
    expect(failureOf(await run("update_wiki_page", { pageId: "wiki_a_old", title: "Revived" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("nothing to change is a refusal naming the value, a field that is nothing once cleaned is a 400, and a person who is not an active user is refused; nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_wiki_page", { pageId: "wiki_a" })).code).toBe("VALUE_REQUIRED");
    expect(failureOf(await run("update_wiki_page", { pageId: "wiki_a", title: "  " })).code).toBe("VALUE_REQUIRED");
    expect(failureOf(await run("update_wiki_page", { pageId: "wiki_a", title: " " })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("update_wiki_page", { pageId: "wiki_a", content: 5 })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("update_wiki_page", { pageId: "wiki_a", title: "T" }, { actorUserId: "person_ghost" })).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
  });
});

describe("mood boards", () => {
  test("create_mood_board writes one draft board for the project under the acting person, and only in interior_mood_boards", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_mood_board", CASE("create_mood_board").valid));
    expect(out.route).toBe(`/mood-boards/${out.id}`);
    expect(changedTables(before, store)).toEqual(["interior_mood_boards"]);
    expect(row("interior_mood_boards", out.id)).toMatchObject({ projectId: PROJECT_A, title: "Master bedroom", roomOrArea: "Level 2", description: "Warm neutrals, brushed brass.", status: "draft", createdById: MANAGER });
  });

  test("the project is checked (the service does not), and a room or description that is nothing once cleaned is a 400", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_mood_board", { title: "T" }, { projectId: "project_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(failureOf(await run("create_mood_board", { title: "T", roomOrArea: " " })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_mood_board", { title: "T", description: 5 })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });

  test("add_mood_board_item adds one item at the end of the board's own, pointing at a document of the project, and changes no other board", async () => {
    const first = resultOf(await run("add_mood_board_item", CASE("add_mood_board_item").valid));
    const second = resultOf(await run("add_mood_board_item", { moodBoardId: "mb_a", label: "Brass tap" }));
    expect(row("interior_mood_board_items", first.id)).toMatchObject({ moodBoardId: "mb_a", documentId: "doc_a", label: "Oak veneer sample", notes: "Matte finish", sortOrder: 0 });
    expect(row("interior_mood_board_items", second.id)).toMatchObject({ moodBoardId: "mb_a", label: "Brass tap", sortOrder: 1 });
    expect(row("interior_mood_board_items", second.id).documentId ?? null).toBeNull();
    expect(rowsOf(store, "interior_mood_board_items").every((i) => i.moodBoardId === "mb_a")).toBe(true);
    expect(first.route).toBe("/mood-boards/mb_a");
  });

  test("an empty item, a document of no project, and text over the cap are refused with nothing written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("add_mood_board_item", { moodBoardId: "mb_a" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("add_mood_board_item", { moodBoardId: "mb_a", documentId: "doc_none" })).code).toBe("RECORD_NOT_FOUND");
    expect(failureOf(await run("add_mood_board_item", { moodBoardId: "mb_a", notes: "n".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("add_mood_board_item", { moodBoardId: "mb_a", documentId: 7 })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });
});

describe("FF&E items and the margin summary", () => {
  test("create_ffe_item writes one item with its cost, price, size and spec, under the acting person, and only in interior_ffe_items", async () => {
    const before = tableJson(store);
    const out = resultOf<{ id: string; route: string; record: Row }>(await run("create_ffe_item", FFE));
    expect(out.route).toBe(`/ffe/${out.id}`);
    expect(changedTables(before, store)).toEqual(["interior_ffe_items"]);
    expect(row("interior_ffe_items", out.id)).toMatchObject({
      projectId: PROJECT_A, itemName: "Lounge chair", roomOrArea: "Living", category: "furniture", description: "Boucle, ivory", sku: "LC-100", quantity: 2,
      unitCost: "900", unitPrice: "1400", leadTimeDays: 45, documentId: "doc_a", widthCm: "80", depthCm: "85", heightCm: "90", status: "specified", createdById: MANAGER,
    });
    expect(out.record.unitCost).toBe("900");
    expect(out.record.unitPrice).toBe("1400");
  });

  test("below the manager rank the answer carries no cost and no price, while the stored row keeps what was given", async () => {
    const out = resultOf<{ id: string; record: Row }>(await run("create_ffe_item", FFE, asMember));
    expect(out.record.unitCost).toBeNull();
    expect(out.record.unitPrice).toBeNull();
    expect(out.record.financialsRedacted).toBe(true);
    expect(row("interior_ffe_items", out.id)).toMatchObject({ unitCost: "900", unitPrice: "1400", createdById: MEMBER });
  });

  test("a supplier is an organisation record: a vendorId given to the executor is not stored", async () => {
    const out = resultOf(await run("create_ffe_item", { ...FFE, vendorId: "supplier_other" }));
    expect(row("interior_ffe_items", out.id).vendorId ?? null).toBeNull();
  });

  test("a category outside the closed list, a quantity that is not a whole number of at least 1, a negative cost, a bad lead time and a bad size are 400s with nothing written", async () => {
    const before = snapshot(store);
    for (const over of [
      { category: "gadget" }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 100001 }, { unitCost: -1 }, { unitPrice: "lots" }, { leadTimeDays: -1 }, { leadTimeDays: 3651 },
      { widthCm: -5 }, { depthCm: Infinity }, { heightCm: "tall" }, { sku: 5 },
    ]) {
      expect({ over, code: failureOf(await run("create_ffe_item", { ...FFE, ...over })).code }).toEqual({ over, code: "REQUEST_REJECTED" });
    }
    expect(failureOf(await run("create_ffe_item", FFE, { projectId: "project_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });

  test("only the name is needed: the rest take the service's defaults (furniture, quantity 1, no cost, no price)", async () => {
    const out = resultOf(await run("create_ffe_item", { itemName: "Bare item" }));
    expect(row("interior_ffe_items", out.id)).toMatchObject({ itemName: "Bare item", category: "furniture", quantity: 1, unitCost: "0", unitPrice: "0", status: "specified" });
  });

  test("update_ffe_status changes one item's status and nothing else, and only to one of the four statuses", async () => {
    const before = tableJson(store);
    const others = JSON.stringify(rowsOf(store, "interior_ffe_items").filter((i) => i.id !== "ffe_a"));
    const out = resultOf(await run("update_ffe_status", { itemId: "ffe_a", status: "ordered" }));
    expect(out.route).toBe("/ffe/ffe_a");
    expect(changedTables(before, store)).toEqual(["interior_ffe_items"]);
    expect(row("interior_ffe_items", "ffe_a")).toMatchObject({ status: "ordered", itemName: "Sofa", unitCost: "1000" });
    expect(JSON.stringify(rowsOf(store, "interior_ffe_items").filter((i) => i.id !== "ffe_a"))).toBe(others);
    for (const status of ["installed", "received", "specified"]) resultOf(await run("update_ffe_status", { itemId: "ffe_a", status }));
    const snap = snapshot(store);
    for (const status of ["shipped", "ORDERED", "", 3]) {
      expect({ status, code: failureOf(await run("update_ffe_status", { itemId: "ffe_a", status })).code }).toEqual({ status, code: status === "" ? "VALUE_REQUIRED" : "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(snap);
  });

  test("a member cannot change a status (a decision of the manager rank)", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_ffe_status", { itemId: "ffe_a", status: "ordered" }, asMember)).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
  });

  test("get_ffe_margin_summary states this project's cost, price and margin only, by category, and writes nothing", async () => {
    const before = snapshot(store);
    const summary = resultOf<{ totalCost: number; totalPrice: number; totalMargin: number; marginPercent: number; byCategory: Array<{ category: string; cost: number; price: number; margin: number }> }>(await run("get_ffe_margin_summary", {}));
    expect(snapshot(store)).toBe(before);
    // Sofa 2 x 1000 / 2 x 1500 and pendant lights 3 x 200 / 3 x 300 are project A's; project B's chair (1 x 50 / 80) is not counted
    expect(summary).toMatchObject({ totalCost: 2600, totalPrice: 3900, totalMargin: 1300 });
    expect(summary.marginPercent).toBeCloseTo(33.333, 2);
    expect(summary.byCategory.sort((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: "furniture", cost: 2000, price: 3000, margin: 1000 },
      { category: "lighting", cost: 600, price: 900, margin: 300 },
    ]);
  });

  test("a member is refused the margin summary before anything is read, and a new item moves the figures", async () => {
    expect(failureOf(await run("get_ffe_margin_summary", {}, asMember)).code).toBe("NOT_PERMITTED");
    resultOf(await run("create_ffe_item", { itemName: "Rug", unitCost: 100, unitPrice: 250, quantity: 2, category: "textile" }));
    const summary = resultOf<{ totalCost: number; totalPrice: number }>(await run("get_ffe_margin_summary", {}));
    expect(summary).toMatchObject({ totalCost: 2800, totalPrice: 4400 });
  });
});

describe("floor plans, rooms and placements", () => {
  test("create_floor_plan writes one draft plan for the project under the acting person, and only in interior_floor_plans", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_floor_plan", CASE("create_floor_plan").valid));
    expect(out.route).toBe(`/floor-plans/${out.id}`);
    expect(changedTables(before, store)).toEqual(["interior_floor_plans"]);
    expect(row("interior_floor_plans", out.id)).toMatchObject({ projectId: PROJECT_A, name: "Level 2", floorLevel: "2", status: "draft", createdById: MANAGER });
    const before2 = snapshot(store);
    expect(failureOf(await run("create_floor_plan", { name: "T" }, { projectId: "project_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(failureOf(await run("create_floor_plan", { name: "T", floorLevel: 2 })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before2);
  });

  test("add_room writes one room at the end of the plan's own, with the outline as given, and only in interior_floor_plan_rooms", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("add_room", CASE("add_room").valid));
    expect(out.route).toBe("/floor-plans/fp_a");
    expect(changedTables(before, store)).toEqual(["interior_floor_plan_rooms"]);
    expect(row("interior_floor_plan_rooms", out.id)).toMatchObject({ floorPlanId: "fp_a", name: "Living", polygon: SQUARE, ceilingHeightCm: "270", sortOrder: 1 });
    resultOf(await run("add_room", { floorPlanId: "fp_a", name: "Hall", polygon: JSON.stringify(SQUARE) }));
    const hall = rowsOf(store, "interior_floor_plan_rooms").find((r) => r.name === "Hall")!;
    expect(hall).toMatchObject({ ceilingHeightCm: "270", sortOrder: 2, polygon: SQUARE });
  });

  test("an outline that is not 3 to 200 points of finite numbers within a million centimetres, and a ceiling outside 50 to 2000 cm, are 400s with nothing written", async () => {
    const before = snapshot(store);
    const bad: unknown[] = [
      [], [{ x: 0, y: 0 }, { x: 1, y: 1 }], "no", "{bad", { x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: "2", y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, null], [[0, 0], [1, 1], [2, 2]], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2e6, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: Number.NaN, y: 0 }],
      Array.from({ length: 201 }, (_, i) => ({ x: i, y: i * i })),
    ];
    for (const polygon of bad) {
      const code = failureOf(await run("add_room", { floorPlanId: "fp_a", name: "R", polygon })).code;
      expect({ polygon: JSON.stringify(polygon)?.slice(0, 40), code }).toEqual({ polygon: JSON.stringify(polygon)?.slice(0, 40), code: "REQUEST_REJECTED" });
    }
    for (const ceilingHeightCm of [49, 2001, "high"]) expect(failureOf(await run("add_room", { floorPlanId: "fp_a", name: "R", polygon: SQUARE, ceilingHeightCm })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
    const many = Array.from({ length: 200 }, (_, i) => ({ x: i, y: (i * 7) % 300 }));
    resultOf(await run("add_room", { floorPlanId: "fp_a", name: "Max", polygon: many }));
  });

  test("a room's materials are organisation records: a material id given to the executor is not stored", async () => {
    const out = resultOf(await run("add_room", { floorPlanId: "fp_a", name: "Den", polygon: SQUARE, floorMaterialId: "mat_x", wallMaterialId: "mat_y", ceilingMaterialId: "mat_z" }));
    const room = row("interior_floor_plan_rooms", out.id);
    expect([room.floorMaterialId ?? null, room.wallMaterialId ?? null, room.ceilingMaterialId ?? null]).toEqual([null, null, null]);
  });

  test("place_furniture writes one placement for an FF&E item of the project in a room of the plan, and only in interior_furniture_placements", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("place_furniture", CASE("place_furniture").valid));
    expect(out.route).toBe("/floor-plans/fp_a");
    expect(changedTables(before, store)).toEqual(["interior_furniture_placements"]);
    expect(row("interior_furniture_placements", out.id)).toMatchObject({ floorPlanId: "fp_a", ffeItemId: "ffe_a", roomId: "room_a", x: "120", y: "80", rotationDeg: "90" });
    const bare = resultOf(await run("place_furniture", { floorPlanId: "fp_a", ffeItemId: "ffe_a2" }));
    expect(row("interior_furniture_placements", bare.id)).toMatchObject({ ffeItemId: "ffe_a2", x: "0", y: "0", rotationDeg: "0" });
    expect(row("interior_furniture_placements", bare.id).roomId ?? null).toBeNull();
  });

  test("a room of another plan, a position outside a million centimetres and a rotation outside 360 degrees are refused with nothing written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("place_furniture", { floorPlanId: "fp_a", ffeItemId: "ffe_a", roomId: "room_b" })).code).toBe("RECORD_NOT_FOUND");
    for (const over of [{ x: 1e7 }, { y: -1e7 }, { x: "far" }, { rotationDeg: 361 }, { rotationDeg: -361 }]) {
      expect({ over, code: failureOf(await run("place_furniture", { floorPlanId: "fp_a", ffeItemId: "ffe_a", ...over })).code }).toEqual({ over, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });
});
