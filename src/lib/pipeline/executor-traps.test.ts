/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-38, register row BR-513: the two traps of PROJEXA_BUILD_SPEC
// section 5, where the obvious registry entry would have written data that looks
// right and is wrong.
//
// TRAP 1, drawings. create_document calls createDocumentRecord(), which writes
// none of the register fields and never supersedes anything, so a second revision
// of a Drawing No. would leave two rows with nothing to say which one to build
// from, and no error. create_drawing calls createDrawingRecord(), which takes the
// previous 'current' revision of the same Drawing No. on the same project to
// 'superseded' and writes the new row with the id it replaced, in ONE transaction.
// Proven here against the real createDrawingRecord: Rev B leaves Rev A superseded
// and itself current with supersedesId = Rev A's id; a failed insert leaves Rev A
// current (the supersede rolls back with it); another project's drawing is never
// touched; and create_document does none of it.
//
// A note on the register row's wording: BR-513's title says the previous row gets
// isLatestVersion=false. createDrawingRecord() does not touch isLatestVersion. The
// register's own signal for a superseded drawing is metadata.status ('current' /
// 'superseded' / 'for_approval', drawings-register.ts) and the register list keeps
// superseded rows visible (a filter on isLatestVersion would hide them), so this
// file asserts the status flip, which is what the register reads.
//
// TRAP 2, minutes of meeting. create_meeting wraps the older pms-meeting-service
// createMeeting() (no minutes, no publish, no PDF, no share link). create_mom
// calls createVeriMeeting(), the service the MoM screens read. Proven here by
// which service each entry reaches: create_mom reaches createVeriMeeting() with
// the person's own user row and the project as the meeting's context, and never
// createMeeting(); create_meeting still reaches createMeeting() and never
// createVeriMeeting().
//
// WHAT IS REAL: executor.ts, function-registry.ts, createDrawingRecord() and
// createDocumentRecord() (document-service.ts). WHAT IS FAKED: @/lib/db/tenant-scoped
// (boq-store-double.ts, plus a reader for the one jsonb where clause the drawing
// lookup builds, evaluated against the fixture rows and recorded in `unparsed` if
// it does not match the shape the reader knows), and the two meeting services'
// write functions, replaced by recording fakes.
//
// Run: bun test --isolate src/lib/pipeline/executor-traps.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { documents } from "@/lib/db/schema";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const PROJECT_OTHER_ORG = "project_x";
const PERSON = "person_1";
/** What task.userId holds for PROJEXA's proxy: the org API key's id, not a person. */
const API_KEY = "apikey_1";

let store: BoqStore;
let failInsert = false;
const unparsedDocumentWhere: string[] = [];

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  return s;
}

// ── the reader for createDrawingRecord's lookup ──────────────────────────────
// boq-store-double.ts reads `col = $n`, `col in (...)`, `and`, `or` and `is null`.
// The drawing lookup also compares two keys of the metadata jsonb
// (`metadata->>'drawingNo' = $6`, `metadata->>'status' = 'current'`), which that
// double cannot read, so this file reads the one shape createDrawingRecord builds.
const dialect = new PgDialect();
const keyOfColumn: Record<string, string> = Object.fromEntries(
  Object.entries(getTableColumns(documents)).map(([key, column]) => [column.name, key])
);

function drawingLookup(where: unknown): (row: Row) => boolean {
  const { sql, params } = dialect.sqlToQuery(where as SQL);
  const parts = sql.replace(/^\(/, "").replace(/\)$/, "").split(" and ");
  const value = (marker: string) => params[Number(marker.replace("$", "")) - 1];
  const tests = parts.map((part): ((row: Row) => boolean) => {
    const equal = /^"compliance"\."documents"\."(\w+)" = (\$\d+)$/.exec(part);
    if (equal) return (row) => row[keyOfColumn[equal[1]]] === value(equal[2]);
    const within = /^"compliance"\."documents"\."(\w+)" in \(([$\d, ]+)\)$/.exec(part);
    if (within) {
      const wanted = within[2].split(",").map((m) => value(m.trim()));
      return (row) => wanted.includes(row[keyOfColumn[within[1]]]);
    }
    const metaParam = /^"compliance"\."documents"\."metadata"->>'(\w+)' = (\$\d+)$/.exec(part);
    if (metaParam) return (row) => ((row.metadata ?? {}) as Row)[metaParam[1]] === value(metaParam[2]);
    const metaLiteral = /^"compliance"\."documents"\."metadata"->>'(\w+)' = '(\w+)'$/.exec(part);
    if (metaLiteral) return (row) => ((row.metadata ?? {}) as Row)[metaLiteral[1]] === metaLiteral[2];
    unparsedDocumentWhere.push(part);
    return () => false;
  });
  return (row) => tests.every((t) => t(row));
}

const baseWithTenantContext = fakeWithTenantContext(() => store);

/** boq-store-double's transaction, with the documents lookup above and an optional insert failure. */
async function fakeWithDrawingLookup(ctx: unknown, fn: (db: unknown) => Promise<unknown>) {
  return baseWithTenantContext(ctx, (rawDb) => {
    const db = rawDb as { query: object; insert: (table: unknown) => unknown } & Record<string, unknown>;
    const query = new Proxy(db.query as Record<string, unknown>, {
      get: (target, key) =>
        key === "documents"
          ? {
              findFirst: async (cfg: { where?: unknown } = {}) => {
                const found = rowsOf(store, "documents").find(drawingLookup(cfg.where));
                return found ? { ...found } : undefined;
              },
            }
          : target[key as string],
    });
    return fn({
      ...db,
      query,
      insert: (table: unknown) => {
        if (failInsert) throw new Error("insert failed");
        return db.insert(table);
      },
    });
  });
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realVeriMeetingService = await import("@/lib/services/veri-meeting-service");
const realPmsMeetingService = await import("@/lib/services/pms-meeting-service");

const createVeriMeeting = mock(async (_ctx: unknown, input: { title: string }) => ({ id: "veri_meeting_1", title: input.title }));
const createPmsMeeting = mock(async (_ctx: unknown, _projectId: string, input: { title: string }) => ({ id: "pms_meeting_1", title: input.title }));

mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithDrawingLookup }));
mock.module("@/lib/services/veri-meeting-service", () => ({ ...realVeriMeetingService, createVeriMeeting }));
mock.module("@/lib/services/pms-meeting-service", () => ({ ...realPmsMeetingService, createMeeting: createPmsMeeting }));

let executeTask: typeof import("./executor").executeTask;
let functionSpec: typeof import("./function-registry").functionSpec;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ functionSpec } = await import("./function-registry"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  failInsert = false;
  unparsedDocumentWhere.length = 0;
  createVeriMeeting.mockClear();
  createPmsMeeting.mockClear();
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/services/veri-meeting-service", () => realVeriMeetingService);
  await mock.module("@/lib/services/pms-meeting-service", () => realPmsMeetingService);
});

function task(functionId: string, params: Row, overrides: Partial<import("./executor").ExecutableTask> = {}): import("./executor").ExecutableTask {
  return { orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, role: "manager", actorUserId: PERSON, ...overrides };
}

const drawing = (params: Row, overrides: Partial<import("./executor").ExecutableTask> = {}) => task("create_drawing", params, overrides);
const link = (rev: string) => `https://example.com/AR-101-${rev}`;
const revA = () => ({ name: "AR-101 Ground floor plan", externalUrl: link("A"), drawingNo: "AR-101", rev: "A", status: "current", discipline: "Architectural" });
const revB = () => ({ ...revA(), externalUrl: link("B"), rev: "B" });

const meta = (row: Row) => (row.metadata ?? {}) as Row;
const documentRows = () => rowsOf(store, "documents");
const byRev = (rev: string) => documentRows().find((r) => meta(r).rev === rev)!;
const nothingWritten = (before: string) => expect(JSON.stringify(store.tables)).toBe(before);

// ═══ TRAP 1: DRAWINGS ═══════════════════════════════════════════════════════

describe("BR-513 trap 1: create_drawing supersedes the previous current revision", () => {
  test("*** THE ROW ***: Rev B takes Rev A to superseded, records which row it replaced, and Rev A keeps everything else it had", async () => {
    expect((await executeTask(drawing(revA()))).success).toBe(true);
    const before = store.transactions;

    const outcome = await executeTask(drawing(revB()));

    expect(outcome.success).toBe(true);
    // Re-read from the store, not from the result.
    expect(documentRows()).toHaveLength(2);
    expect(meta(byRev("A"))).toEqual({
      isExternalLink: true, discipline: "Architectural", drawingNo: "AR-101", rev: "A", status: "superseded", supersedesId: null,
    });
    expect(meta(byRev("B"))).toEqual({
      isExternalLink: true, discipline: "Architectural", drawingNo: "AR-101", rev: "B", status: "current", supersedesId: byRev("A").id,
    });
    // One current revision of the Drawing No., not two.
    expect(documentRows().filter((r) => meta(r).status === "current")).toHaveLength(1);
    // The supersede and the insert share one transaction, and it is never nested (D-06).
    // The second call's other transaction is the executor's project lookup, closed before it.
    expect(store.transactions - before).toBe(2);
    expect(store.maxOpen).toBe(1);
    expect(store.unparsed).toEqual([]);
    expect(unparsedDocumentWhere).toEqual([]);
  });

  test("the receipt names the drawing row that was written, filed on the task's project under the person", async () => {
    const outcome = await executeTask(drawing(revA()));

    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    const row = documentRows()[0];
    const result = outcome.result as { id: string; route: string };
    expect(result.id).toBe(row.id as string);
    expect(result.route).toBe(`/drawings/${row.id}`);
    expect([row.orgId, row.category, row.linkedEntityType, row.linkedEntityId, row.fileUrl]).toEqual([ORG, "drawing", "project", PROJECT_A, link("A")]);
    // The person, not the API key.
    expect(row.uploadedById).toBe(PERSON);
  });

  test("the supersede and the insert stand or fall together: an insert that fails leaves Rev A current", async () => {
    await executeTask(drawing(revA()));
    failInsert = true;

    const outcome = await executeTask(drawing(revB()));

    expect(outcome.success).toBe(false);
    expect(documentRows()).toHaveLength(1);
    expect(meta(byRev("A")).status).toBe("current");
  });

  test("the previous revision is looked for on this project only: another project's current AR-101 is not touched", async () => {
    seedRows(store, "documents", [
      {
        id: "doc_b", orgId: ORG, name: "AR-101 (Oakwood)", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_B,
        fileUrl: link("Z"), metadata: { drawingNo: "AR-101", rev: "Z", status: "current", isExternalLink: true },
      },
    ]);

    await executeTask(drawing(revA()));

    expect(meta(documentRows().find((r) => r.id === "doc_b")!).status).toBe("current");
    expect(meta(byRev("A")).supersedesId).toBeNull();
  });

  test("a drawing sent for approval supersedes nothing: it is not the build set yet", async () => {
    await executeTask(drawing(revA()));

    await executeTask(drawing({ ...revB(), status: undefined }));

    expect(meta(byRev("A")).status).toBe("current");
    expect(meta(byRev("B")).status).toBe("for_approval");
    expect(meta(byRev("B")).supersedesId).toBeNull();
  });

  test("a 3D walkthrough revision of the same Drawing No. supersedes the DWG revision: the lookup spans both categories", async () => {
    await executeTask(drawing(revA()));

    await executeTask(drawing({ ...revB(), kind: "3d_walkthrough" }));

    expect(byRev("B").category).toBe("drawing_3d");
    expect(meta(byRev("A")).status).toBe("superseded");
    expect(meta(byRev("B")).supersedesId).toBe(byRev("A").id);
  });

  test("CONTRAST, why it is its own entry: create_document with the drawing category writes no register field and supersedes nothing", async () => {
    const generic = (rev: string) => task("create_document", { name: `AR-101 Rev ${rev}`, category: "drawing", externalUrl: link(rev) });
    expect((await executeTask(generic("A"))).success).toBe(true);
    expect((await executeTask(generic("B"))).success).toBe(true);

    expect(documentRows()).toHaveLength(2);
    for (const row of documentRows()) {
      expect(meta(row).drawingNo).toBeUndefined();
      expect(meta(row).status).toBeUndefined();
      expect(meta(row).supersedesId).toBeUndefined();
    }
    // Nothing in the store answers "which one is the build set".
    expect(documentRows().filter((r) => meta(r).status === "current")).toHaveLength(0);
  });
});

describe("BR-513 trap 1: create_drawing's own refusals write nothing", () => {
  const refused = async (t: import("./executor").ExecutableTask) => {
    const before = JSON.stringify(store.tables);
    const outcome = await executeTask(t);
    nothingWritten(before);
    if (outcome.success) throw new Error("expected a refusal");
    return outcome.failure;
  };

  test("a task naming no person -> NOT_PERMITTED (unidentified_actor)", async () => {
    expect(await refused(drawing(revA(), { actorUserId: null }))).toEqual({
      code: "NOT_PERMITTED", missing: [], context: { reason: "unidentified_actor" }, picker: "none",
    });
  });

  test("params.projectId naming another project -> PROJECT_NOT_REACHABLE", async () => {
    expect(await refused(drawing({ ...revA(), projectId: PROJECT_B }))).toEqual({
      code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project",
    });
  });

  test("a project of another org -> RECORD_NOT_FOUND", async () => {
    const failure = await refused(drawing(revA(), { projectId: PROJECT_OTHER_ORG }));
    expect(failure.code).toBe("RECORD_NOT_FOUND");
  });

  test("a status the register does not know -> REQUEST_REJECTED", async () => {
    const failure = await refused(drawing({ ...revA(), status: "final" }));
    expect(failure).toEqual({ code: "REQUEST_REJECTED", missing: [], context: { status: 400, functionId: "create_drawing" }, picker: "none" });
  });

  test("no name, or no link -> the registry's own codes", async () => {
    expect((await refused(drawing({ ...revA(), name: undefined }))).code).toBe("TITLE_REQUIRED");
    expect((await refused(drawing({ ...revA(), externalUrl: undefined }))).code).toBe("LINK_REQUIRED");
  });
});

// ═══ TRAP 2: MINUTES OF MEETING ═════════════════════════════════════════════

describe("BR-513 trap 2: create_mom calls createVeriMeeting, never pms createMeeting", () => {
  const mom = (params: Row = {}, overrides: Partial<import("./executor").ExecutableTask> = {}) =>
    task("create_mom", { title: "Site coordination 24 Sep", scheduledAt: "2026-09-24T10:00:00.000Z", ...params }, overrides);

  test("*** THE ROW ***: one call to createVeriMeeting with the person's own user row and the project as context, 0 calls to pms createMeeting", async () => {
    const outcome = await executeTask(
      mom({
        meetingType: "site",
        attendees: ["Asha", "Babu"],
        agenda: ["Slab pour", "Facade samples"],
        minutes: "Slab pour agreed for Friday.",
        actionItems: [{ title: "Confirm the pump booking", assigneeUserId: PERSON, dueDate: "2026-09-26" }],
      })
    );

    expect(outcome.success).toBe(true);
    expect(createVeriMeeting).toHaveBeenCalledTimes(1);
    expect(createPmsMeeting).toHaveBeenCalledTimes(0);
    const [ctx, input] = createVeriMeeting.mock.calls[0] as unknown as [{ orgId: string; userId: string; dbUser: Row }, Row];
    expect([ctx.orgId, ctx.userId, ctx.dbUser.id]).toEqual([ORG, PERSON, PERSON]);
    expect(input).toEqual({
      title: "Site coordination 24 Sep",
      meetingType: "site",
      scheduledAt: "2026-09-24T10:00:00.000Z",
      attendees: ["Asha", "Babu"],
      agenda: ["Slab pour", "Facade samples"],
      contextEntityType: "project",
      contextEntityId: PROJECT_A,
      minutes: "Slab pour agreed for Friday.",
      actionItems: [{ title: "Confirm the pump booking", assigneeUserId: PERSON, dueDate: "2026-09-26" }],
    });
    // The receipt is the MoM screen's route, for the row createVeriMeeting returned.
    if (!outcome.success) return;
    expect(outcome.result).toEqual({ id: "veri_meeting_1", route: "/moms/veri_meeting_1", record: { id: "veri_meeting_1", title: "Site coordination 24 Sep" } });
  });

  test("CONTRAST: create_meeting still reaches pms createMeeting, and never createVeriMeeting -- the two entries are not the same thing", async () => {
    const outcome = await executeTask(task("create_meeting", { title: "Site coordination 24 Sep", scheduledAt: "2026-09-24T10:00:00.000Z" }));

    expect(outcome.success).toBe(true);
    expect(createPmsMeeting).toHaveBeenCalledTimes(1);
    expect(createVeriMeeting).toHaveBeenCalledTimes(0);
    // The two are distinct registry entries with distinct wording.
    expect(functionSpec("create_mom")!.label).not.toBe(functionSpec("create_meeting")!.label);
    expect(functionSpec("create_mom")!.card!.fields.map((f) => f.key)).toContain("minutes");
    expect(functionSpec("create_meeting")!.card!.fields.map((f) => f.key)).not.toContain("minutes");
  });

  test("the meeting is recorded under the person: a task naming no person, or a person who is not an active user of the org, reaches neither service", async () => {
    seedRows(store, "users", [{ id: "person_off", orgId: ORG, isActive: false, role: "manager", name: "Off", email: "off@example.com" }]);
    const before = JSON.stringify(store.tables);

    const none = await executeTask(mom({}, { actorUserId: null }));
    const inactive = await executeTask(mom({}, { actorUserId: "person_off" }));
    const stranger = await executeTask(mom({}, { actorUserId: API_KEY }));

    expect(none.success === false && none.failure.context).toEqual({ reason: "unidentified_actor" });
    expect(inactive.success === false && inactive.failure.context).toEqual({ reason: "unknown_actor" });
    expect(stranger.success === false && stranger.failure.context).toEqual({ reason: "unknown_actor" });
    expect(createVeriMeeting).toHaveBeenCalledTimes(0);
    expect(createPmsMeeting).toHaveBeenCalledTimes(0);
    nothingWritten(before);
  });

  test("a project of another org -> RECORD_NOT_FOUND, and params.projectId naming another project -> PROJECT_NOT_REACHABLE; neither service is reached", async () => {
    const otherOrg = await executeTask(mom({}, { projectId: PROJECT_OTHER_ORG }));
    const otherProject = await executeTask(mom({ projectId: PROJECT_B }));

    expect(otherOrg.success === false && otherOrg.failure.code).toBe("RECORD_NOT_FOUND");
    expect(otherProject.success === false && otherProject.failure.code).toBe("PROJECT_NOT_REACHABLE");
    expect(createVeriMeeting).toHaveBeenCalledTimes(0);
    expect(createPmsMeeting).toHaveBeenCalledTimes(0);
  });

  test("no title, or no date -> the registry's own codes, before any service", async () => {
    const noTitle = await executeTask(mom({ title: undefined }));
    const noDate = await executeTask(mom({ scheduledAt: undefined }));

    expect(noTitle.success === false && noTitle.failure.code).toBe("TITLE_REQUIRED");
    expect(noDate.success === false && noDate.failure.code).toBe("DATE_REQUIRED");
    expect(createVeriMeeting).toHaveBeenCalledTimes(0);
  });
});
