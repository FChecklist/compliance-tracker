// PROJEXA-BUILD-002 WP-05c/WP-05d -- what the coverage wave tests share (coverage-wave3.test.ts, coverage-wave4.test.ts): the fixtures, a
// database double that also answers `select count(*)`, a snapshot for "nothing was written", and the Edge handler behind a small harness.
//
// The double is boq-store-double.ts (the REAL drizzle where clause of every query compiled and evaluated against fixture rows, writes
// staged and committed when the transaction function returns, discarded when it throws) plus two things it does not model: the
// `db.select({ value: count() })` that createRfi, createSubmittal and createPunchListItem use to number a record, and the
// `coalesce(sum(col), 0)` that createMaterialIssue uses for the stock on hand. Each is answered from the rows the same where clause matches.
// Every test file installs its own mock of @/lib/db/tenant-scoped (a module mock
// is per file). Lives in __test-helpers__ for the reason pipeline-store-double.ts does: a test seam owes the repo no sibling test.
import { getTableColumns, is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { handleAwl } from "../../../../supabase/functions/ai-work-link/handler";
import { TOKENS, makeFake, req, testConfig } from "../../services/__test-helpers__/awl-edge-fake";
import { fakeWithTenantContext, makeBoqStore, seedRows, type BoqStore } from "./boq-store-double";

export const ORG = "org_1";
export const OTHER_ORG = "org_2";
export const PROJECT_A = "project_a";
export const PROJECT_B = "project_b";
export const PROJECT_X = "project_x"; // a project of another organisation
/** A manager (rank 3, sees money) and members (rank 2). MEMBER is the project's lead; TEAM is on its team; STRANGER is neither. */
export const MANAGER = "person_manager";
export const MEMBER = "person_member";
export const TEAM = "person_team";
export const STRANGER = "person_stranger";
/** What task.userId holds for PROJEXA's proxy: the org API key's id, not a person. */
export const API_KEY = "apikey_1";

export function makeStore(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Zoomies Dubai", status: "active", leadUserId: MEMBER },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood", status: "active" },
    { id: PROJECT_X, orgId: OTHER_ORG, name: "Elsewhere", status: "active" },
  ]);
  seedRows(s, "users", [
    { id: MANAGER, orgId: ORG, isActive: true, role: "manager", name: "Asha Manager", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Ravi Member", email: "ravi@example.com" },
    { id: TEAM, orgId: ORG, isActive: true, role: "member", name: "Tara Team", email: "tara@example.com" },
    { id: STRANGER, orgId: ORG, isActive: true, role: "member", name: "Sam Stranger", email: "sam@example.com" },
  ]);
  seedRows(s, "project_team_members", [{ id: "ptm_1", orgId: ORG, projectId: PROJECT_A, userId: TEAM, role: "member" }]);
  return s;
}

/** A row of `table` for project A and one for project B, so every id check has a real record of another project to be refused. */
export function seedFieldRecords(s: BoqStore): void {
  seedRows(s, "construction_rfis", [
    { id: "rfi_a", orgId: ORG, projectId: PROJECT_A, number: 1, subject: "Beam depth", question: "Confirm depth", status: "open", ballInCourt: "architect", raisedById: MEMBER },
    { id: "rfi_b", orgId: ORG, projectId: PROJECT_B, number: 1, subject: "Slab edge", question: "Confirm edge", status: "open", ballInCourt: "architect", raisedById: MEMBER },
    { id: "rfi_x", orgId: OTHER_ORG, projectId: PROJECT_X, number: 1, subject: "Other organisation", question: "Other", status: "open", ballInCourt: "architect", raisedById: MEMBER },
  ]);
  seedRows(s, "construction_submittals", [
    { id: "sub_a", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Tile sample", type: "sample", status: "pending", submittedById: MEMBER },
    { id: "sub_b", orgId: ORG, projectId: PROJECT_B, number: 1, title: "Paint sample", type: "sample", status: "pending", submittedById: MEMBER },
    { id: "sub_x", orgId: OTHER_ORG, projectId: PROJECT_X, number: 1, title: "Other organisation", type: "sample", status: "pending", submittedById: MEMBER },
  ]);
  seedRows(s, "construction_punch_list_items", [
    { id: "punch_a", orgId: ORG, projectId: PROJECT_A, number: 1, description: "Chipped skirting", status: "ready_for_review", assignedToId: MEMBER, createdById: MEMBER },
    { id: "punch_a_open", orgId: ORG, projectId: PROJECT_A, number: 2, description: "Paint touch-up", status: "open", assignedToId: MEMBER, createdById: MEMBER },
    { id: "punch_b", orgId: ORG, projectId: PROJECT_B, number: 1, description: "Loose handle", status: "open", createdById: MEMBER },
    { id: "punch_x", orgId: OTHER_ORG, projectId: PROJECT_X, number: 1, description: "Other organisation", status: "open", createdById: MEMBER },
  ]);
  seedRows(s, "construction_site_diaries", [{ id: "diary_a", orgId: ORG, projectId: PROJECT_A, diaryDate: "2026-09-01", weather: "clear", recordedById: MEMBER }]);
}

export function seedProgressRecords(s: BoqStore): void {
  seedRows(s, "construction_categories", [
    { id: "cat_a", orgId: ORG, projectId: PROJECT_A, name: "Joinery" },
    { id: "cat_b", orgId: ORG, projectId: PROJECT_B, name: "Flooring" },
  ]);
  seedRows(s, "construction_activities", [
    { id: "act_a", orgId: ORG, projectId: PROJECT_A, categoryId: "cat_a", name: "Frames" },
    { id: "act_b", orgId: ORG, projectId: PROJECT_B, categoryId: "cat_b", name: "Tiles" },
  ]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1 },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1 },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "EX-01", quantity: "10" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "EX-01", quantity: "10" },
  ]);
  seedRows(s, "construction_work_progress_entries", [
    { id: "entry_a", orgId: ORG, projectId: PROJECT_A, activityId: "act_a", entryDate: "2026-09-01", quantityDone: "2", percentComplete: "20", recordedById: MEMBER },
    { id: "entry_b", orgId: ORG, projectId: PROJECT_B, activityId: "act_b", entryDate: "2026-09-01", quantityDone: "2", percentComplete: "20", recordedById: MEMBER },
  ]);
}

export function seedLabourAndMaterials(s: BoqStore): void {
  seedRows(s, "construction_labour_roster", [
    { id: "roster_a", orgId: ORG, projectId: PROJECT_A, name: "Asha", trade: "Mason", dailyRate: "800", isActive: true },
    { id: "roster_a2", orgId: ORG, projectId: PROJECT_A, name: "Babu", trade: "Painter", dailyRate: "700", isActive: true },
    { id: "roster_b", orgId: ORG, projectId: PROJECT_B, name: "Chandra", trade: "Mason", dailyRate: "900", isActive: true },
  ]);
  seedRows(s, "construction_materials", [
    { id: "mat_a", orgId: ORG, projectId: PROJECT_A, name: "Cement OPC 53", unit: "bag", unitCost: "420", isActive: true },
    { id: "mat_b", orgId: ORG, projectId: PROJECT_B, name: "Steel TMT", unit: "kg", unitCost: "60", isActive: true },
  ]);
  seedRows(s, "construction_material_receipts", [
    { id: "rec_a", orgId: ORG, projectId: PROJECT_A, materialId: "mat_a", receivedDate: "2026-09-01", quantity: "100", unitCost: "420", createdById: MEMBER },
    { id: "rec_b", orgId: ORG, projectId: PROJECT_B, materialId: "mat_b", receivedDate: "2026-09-01", quantity: "100", unitCost: "60", createdById: MEMBER },
    { id: "rec_x", orgId: OTHER_ORG, projectId: PROJECT_X, materialId: "mat_x", receivedDate: "2026-09-01", quantity: "100", unitCost: "60", createdById: MEMBER },
  ]);
}

// -- the database double -------------------------------------------------------------------------------------------------------

const dialect = new PgDialect();

/**
 * The one-column aggregates the wrapped services use, answered from the rows the same where clause matches:
 *   count(*)                      the number of rows        (createRfi, createSubmittal, createPunchListItem)
 *   coalesce(sum("t"."col"), 0)   the sum of one column     (createMaterialIssue's on-hand check)
 * Any other select is the store double's own; an aggregate it cannot read throws, so a test can never pass on a guessed number.
 */
function withAggregates(db: any): unknown {
  return {
    ...db,
    select: (selection?: Record<string, unknown>) => {
      const entries = Object.entries(selection ?? {});
      const sqlOf = entries.length === 1 && is(entries[0][1], SQL) ? dialect.sqlToQuery(entries[0][1] as SQL).sql : null;
      if (sqlOf === null || !/^(count\(|coalesce\(sum\()/i.test(sqlOf)) return db.select(selection);
      const alias = entries[0][0];
      const column = /sum\((?:"\w+"\.)*"(\w+)"\)/i.exec(sqlOf)?.[1];
      if (!/^count\(/i.test(sqlOf) && !column) throw new Error(`coverage-fixtures: cannot read the aggregate ${sqlOf}`);
      return {
        from: (table: any) => {
          const keyOf = column ? Object.entries(getTableColumns(table)).find(([, c]) => (c as { name: string }).name === column)?.[0] : undefined;
          if (column && !keyOf) throw new Error(`coverage-fixtures: no column ${column} on the table`);
          const answer = (rows: Array<Record<string, unknown>>) => [{ [alias]: keyOf ? String(rows.reduce((sum, r) => sum + Number(r[keyOf]), 0)) : rows.length }];
          return {
            where: (cond: unknown) => ({
              then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(db.select().from(table).where(cond)).then((rows: any) => answer(rows)).then(resolve, reject),
            }),
          };
        },
      };
    },
  };
}

/** The withTenantContext stand-in every coverage test installs. */
export function coverageWithTenantContext(getStore: () => BoqStore) {
  const base = fakeWithTenantContext(getStore);
  return (ctx: unknown, fn: (db: unknown) => Promise<unknown>) => base(ctx, (db) => fn(withAggregates(db)));
}

/** The whole store as text: equal before and after means nothing was written (or, for a mutation, that nothing else was). */
export function snapshot(s: BoqStore): string {
  return JSON.stringify(s.tables);
}

/** Every table as its own text, so a test can name the tables a call changed. */
export function tableJson(s: BoqStore): Record<string, string> {
  return Object.fromEntries(Object.entries(s.tables).map(([name, rows]) => [name, JSON.stringify(rows)]));
}

/** The names of the tables that differ from `before` (a tableJson taken earlier), sorted. */
export function changedTables(before: Record<string, string>, s: BoqStore): string[] {
  const after = tableJson(s);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((t) => before[t] !== after[t]).sort();
}

// -- the Edge handler -----------------------------------------------------------------------------------------------------------

export { TOKENS };

/** The real handler over the fake link database, writes switched on and the executor present (a level-1 change is direct only then, BUILD-002 WP-09a). */
export function linkHarness() {
  const fake = makeFake({ writesEnabled: true });
  const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig({ execPresent: true }), log: () => {} });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;
  return {
    run,
    /** POST /check: what a function would do with these parameters. */
    check: async (token: string, fn: string, params: unknown) => {
      const res = await run(`/${token}/check`, { method: "POST", body: { function: fn, params } });
      return { status: res.status, body: await json(res) };
    },
    /** POST /actions: the direct path. */
    action: async (token: string, fn: string, params: unknown) => {
      const res = await run(`/${token}/actions`, { method: "POST", body: { function: fn, params } });
      return { status: res.status, body: await json(res) };
    },
    /** GET /propose: the draft a person is handed to confirm. */
    propose: async (token: string, fn: string, params: Record<string, string>) => {
      const q = new URLSearchParams({ fn, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [`p.${k}`, v])), format: "json" });
      const res = await run(`/${token}/propose?${q.toString()}`);
      return { status: res.status, body: await json(res) };
    },
  };
}
