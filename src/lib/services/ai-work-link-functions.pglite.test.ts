/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46 step 1 (BR-483 to BR-486, spec sections 6, 9 and 10): behaviour of the SQL functions of the Universal AI Work
// Link (drizzle/0624 to 0628) on PGlite over the committed base snapshot of the live tables. Nothing touches a live database.
//
// The fixture is two organisations (A and B) with seven people of organisation A in different roles, four projects, and rows in every
// table a record kind reads, INCLUDING decoys: rows of another project of the same organisation, rows of another organisation, and a row
// whose own org_id disagrees with its BOQ's. A link for project "proj-a" must never show a decoy.
//
// WHAT IS PROVEN
//   minting       eligibility (inactive, other organisation, private project, level, functions), the token shape, only sha256 stored,
//                 expiry, rotation (the previous link of the same person and project is revoked and stops resolving), the auth-user
//                 variants, listing, revoking by the person and by an admin and by nobody else, the warning sentence
//   resolving     the effective level and function list from the LIVE role on every call: a demotion narrows at once, a promotion
//                 never raises above the ceiling, writes_enabled caps every link at level 0; a person who is deactivated or moved, a
//                 project that becomes private or disappears, an expired or revoked or malformed token: one answer, gone
//   call log      fail closed, 120 a minute per link, 30 a minute per address prefix for unknown tokens refused BEFORE a row is written,
//                 a token never reaches the path column, only a /24 or /48 is stored, a result is filled once
//   context       business counters only, money_fields per role, function availability follows the switch
//   records       all 13 kinds: scope, money nulled for a member and for a manager whose organisation withholds cost, every filter and
//                 sort of the allow-list runs, hidden fields refused for filter and sort, keyset paging, no decoy ever, single records
//   intents       drafts and actions, idempotency (replay, a failed intent frees its key), expiry, write caps, level, projectId, the
//                 draft confirmation (single use, owner only, token, switch)
//
// Run: bun test --isolate src/lib/services/ai-work-link-functions.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, failure, one, sha256Hex } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

type J = Record<string, any>

let db: PGlite

const A = { mgr: "u-mgr", sen: "u-sen", mem: "u-mem", tm: "u-tm", view: "u-view", adm: "u-adm", off: "u-off" }
const AUTH = { mgr: "11111111-1111-4111-8111-111111111111", mem: "22222222-2222-4222-8222-222222222222", adm: "33333333-3333-4333-8333-333333333333", b: "44444444-4444-4444-8444-444444444444" }

const FIXTURE_SQL = `
insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
  ('u-mgr',  'Mira Manager', 'mira@a.example.test', 'x', 'manager', true,  'org-a', '${AUTH.mgr}'),
  ('u-sen',  'Sam Senior',   'sam@a.example.test',  'x', 'senior_professional', true, 'org-a', null),
  ('u-mem',  'Mo Member',    'mo@a.example.test',   'x', 'member', true,  'org-a', '${AUTH.mem}'),
  ('u-tm',   'Tia Team',     'tia@a.example.test',  'x', 'team_member', true, 'org-a', null),
  ('u-view', 'Vic Viewer',   'vic@a.example.test',  'x', 'viewer', true,  'org-a', null),
  ('u-adm',  'Ada Admin',    'ada@a.example.test',  'x', 'admin', true,   'org-a', '${AUTH.adm}'),
  ('u-off',  'Off Member',   'off@a.example.test',  'x', 'member', false, 'org-a', null),
  ('u-b',    'Bo Manager',   'bo@b.example.test',   'x', 'manager', true, 'org-b', '${AUTH.b}'),
  ('u-b-adm','Bea Admin',    'bea@b.example.test',  'x', 'admin', true,   'org-b', '55555555-5555-4555-8555-555555555555');
insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level) values
  ('proj-a',    'prod', 'org-a', 'Villa A',   'u-mgr', 'public'),
  ('proj-a2',   'prod', 'org-a', 'Villa A2',  'u-sen', 'public'),
  ('proj-priv', 'prod', 'org-a', 'Secret A',  'u-sen', 'private'),
  ('proj-b',    'prod', 'org-b', 'Tower B',   'u-b',   'public');
update compliance.projects set project_value = 1000000, vat_rate_percent = 18, retention_percent = 5 where id = 'proj-a';
-- organisation A lets managers and admins see cost, and withholds it from senior professionals
insert into compliance.cost_visibility_config (id, org_id, role, can_see_cost, changed_by_id) values
  ('cv1', 'org-a', 'manager', true, 'u-adm'), ('cv2', 'org-a', 'admin', true, 'u-adm'), ('cv3', 'org-a', 'senior_professional', false, 'u-adm');
insert into compliance.project_team_members (id, org_id, project_id, user_id, role) values ('ptm-1', 'org-a', 'proj-a', 'u-tm', 'engineer');
insert into compliance.construction_boqs (id, org_id, project_id, version, title, created_by_id, contract_value_override) values
  ('boq-a1', 'org-a', 'proj-a', 1, 'A original', 'u-mgr', 5000),
  ('boq-a2', 'org-a', 'proj-a', 2, 'A revision', 'u-sen', 6000),
  ('boq-a2x', 'org-a', 'proj-a2', 1, 'SECRET other project', 'u-sen', 9999),
  ('boq-b1', 'org-b', 'proj-b', 1, 'SECRET org B', 'u-b', 7777);
insert into compliance.construction_boq_line_items (id, boq_id, org_id, description, unit, quantity, rate, amount, item_code, category, material_cost, labour_cost, equipment_cost, budget_percentage, vendor_amount, material_amount, manpower_amount, rate_project, rate_contract) values
  ('la-1', 'boq-a1', 'org-a', 'A line 1', 'm3', 2, 10, 20, '1.01', 'civil', 4, 5, 1, 10, 3, 2, 1, 7, 9),
  ('la-2', 'boq-a1', 'org-a', 'A line 2', 'm3', 3, 11, 33, '1.02', 'civil', 4, 5, 1, 20, 3, 2, 1, 8, 10),
  ('la-3', 'boq-a2', 'org-a', 'A line 3', 'nos', 5, 4, 20, '2.01', 'finish', 2, 1, 1, 30, 3, 2, 1, 3, 4),
  ('la-4', 'boq-a2', 'org-a', 'A line 4', 'nos', 1, 100, 100, '2.02', 'finish', 60, 30, 10, 40, 3, 2, 1, 90, 95),
  ('lx-a2x', 'boq-a2x', 'org-a', 'SECRET other project', 'nos', 1, 1, 1, '9.9', 'x', 1, 1, 1, 1, 1, 1, 1, 1, 1),
  ('lx-b', 'boq-b1', 'org-b', 'SECRET org B', 'nos', 1, 1, 1, '9.8', 'x', 1, 1, 1, 1, 1, 1, 1, 1, 1),
  ('lx-wrong-org', 'boq-a1', 'org-b', 'SECRET inconsistent org', 'nos', 1, 1, 1, '9.7', 'x', 1, 1, 1, 1, 1, 1, 1, 1, 1);
insert into compliance.construction_activities (id, org_id, project_id, category_id, name, unit, planned_quantity) values
  ('act-1', 'org-a', 'proj-a', 'cat', 'Excavation', 'm3', 100), ('act-2', 'org-a', 'proj-a', 'cat', 'Slab', 'm2', 50), ('act-x', 'org-a', 'proj-a2', 'cat', 'SECRET activity', 'm2', 1);
insert into compliance.construction_work_progress_entries (id, org_id, project_id, activity_id, entry_date, quantity_done, percent_complete, remarks, recorded_by_id) values
  ('pe-1', 'org-a', 'proj-a', 'act-1', '2026-09-01', 2, 10, 'poured slab', 'u-mem'),
  ('pe-2', 'org-a', 'proj-a', 'act-1', '2026-09-02', 4, 20, 'more', 'u-mem'),
  ('pe-3', 'org-a', 'proj-a', 'act-2', '2026-09-03', 1, 5, 'x', 'u-tm'),
  ('pe-x', 'org-a', 'proj-a2', 'act-x', '2026-09-03', 1, 5, 'SECRET progress', 'u-sen');
insert into compliance.pms_issues (id, org_id, project_id, type_id, status_id, number, title, description, assignee_id, created_by_id, priority) values
  ('is-1', 'org-a', 'proj-a', 'ty', 'st-open', 1, 'Set out', 'd1', 'u-mem', 'u-mgr', 'high'),
  ('is-2', 'org-a', 'proj-a', 'ty', 'st-open', 2, 'Shuttering', 'd2', 'u-tm', 'u-mgr', 'low'),
  ('is-3', 'org-a', 'proj-a', 'ty', 'st-done', 3, 'Cure', 'd3', 'u-mem', 'u-mem', 'medium'),
  ('is-x', 'org-a', 'proj-a2', 'ty', 'st-open', 1, 'SECRET task', 'dx', 'u-sen', 'u-sen', 'low');
insert into compliance.pms_meetings (id, org_id, project_id, title, scheduled_at, duration_minutes) values
  ('m-1', 'org-a', 'proj-a', 'Kickoff', '2026-09-10T09:00:00Z', 60), ('m-2', 'org-a', 'proj-a', 'Weekly', '2026-09-17T09:00:00Z', 30), ('m-x', 'org-a', 'proj-a2', 'SECRET meeting', '2026-09-10T09:00:00Z', 30);
insert into compliance.documents (id, name, file_url, org_id, category, linked_entity_type, linked_entity_id) values
  ('d-1', 'Drawing set', 'https://example.test/d1', 'org-a', 'drawing', 'project', 'proj-a'),
  ('d-2', 'SECRET doc of another project', 'https://example.test/d2', 'org-a', 'drawing', 'project', 'proj-a2'),
  ('d-3', 'SECRET unlinked doc', 'https://example.test/d3', 'org-a', 'drawing', null, null),
  ('d-4', 'SECRET doc linked to a task with the project id', 'https://example.test/d4', 'org-a', 'drawing', 'task', 'proj-a'),
  ('d-b', 'SECRET org B doc', 'https://example.test/db', 'org-b', 'drawing', 'project', 'proj-a');
insert into compliance.construction_labour_roster (id, org_id, project_id, name, trade, daily_rate, employee_code) values
  ('ro-1', 'org-a', 'proj-a', 'Ravi', 'mason', 500, 'E1'), ('ro-2', 'org-a', 'proj-a', 'Sita', 'carpenter', 450, 'E2'), ('ro-x', 'org-a', 'proj-a2', 'SECRET worker', 'mason', 1, 'EX');
insert into compliance.construction_attendance (id, org_id, project_id, roster_id, attendance_date, status, hours_worked, daily_cost) values
  ('at-1', 'org-a', 'proj-a', 'ro-1', '2026-09-01', 'present', 8, 500), ('at-2', 'org-a', 'proj-a', 'ro-2', '2026-09-01', 'half_day', 4, 225), ('at-x', 'org-a', 'proj-a2', 'ro-x', '2026-09-01', 'present', 8, 1);
insert into compliance.pms_time_entries (id, org_id, issue_id, user_id, hours, spent_on, hourly_rate_snapshot, invoice_item_id, comments) values
  ('te-1', 'org-a', 'is-1', 'u-mem', 2, '2026-09-01', 50, 'inv-1', 'set out'), ('te-2', 'org-a', 'is-2', 'u-tm', 3.5, '2026-09-02', 60, null, 'boards'),
  ('te-x', 'org-a', 'is-x', 'u-sen', 1, '2026-09-02', 1, null, 'SECRET time');
insert into compliance.submissions (id, org_id, project_id, mode, raw_input, user_id) values
  ('s1', 'org-a', 'proj-a', 'Projects', 'fixture', 'u-adm'), ('s9', 'org-a', 'proj-a2', 'Projects', 'fixture', 'u-sen');
insert into compliance.pipeline_tasks (id, submission_id, sequence, org_id, project_id, project_source, function_id, params, result) values
  ('pt-1', 's1', 1, 'org-a', 'proj-a', 'stated', 'add_roster_entry', '{"dailyRate": 500}', '{"id": "ro-1", "dailyRate": 500}'),
  ('pt-2', 's1', 2, 'org-a', 'proj-a', 'stated', 'record_attendance', '{"rosterId": "ro-1"}', '{}'),
  ('pt-x', 's9', 1, 'org-a', 'proj-a2', 'stated', 'add_roster_entry', '{"dailyRate": 1}', '{}');
`

const jsonArg = (x: unknown) => JSON.stringify(x ?? {})

async function mint(userId: string, projectId: string, o: { level?: number; fns?: string[] | null; days?: number; hide?: boolean; label?: string | null } = {}): Promise<J> {
  const r = await one<{ r: J }>(db, "select public.ai_work_link_create_for($1, $2, $3, $4::text[], $5, $6, $7) r", [
    userId, projectId, o.level ?? 1, o.fns ?? null, o.days ?? 7, o.hide ?? true, o.label ?? null,
  ])
  return r.r
}
const resolve = async (token: string) => (await one<{ r: J }>(db, "select public.ai_work_link__resolve($1) r", [token])).r
const records = async (token: string, kind: string, o: { after?: string | null; limit?: number; filters?: unknown } = {}) =>
  (await one<{ r: J }>(db, "select public.ai_work_link_records($1, $2, $3, $4, $5::jsonb) r", [token, kind, o.after ?? null, o.limit ?? 50, jsonArg(o.filters)])).r
const recordsErr = (token: string, kind: string, filters: unknown, o: { after?: string | null; limit?: number } = {}) =>
  failure(db, "select public.ai_work_link_records($1, $2, $3, $4, $5::jsonb)", [token, kind, o.after ?? null, o.limit ?? 50, jsonArg(filters)])
const ids = (page: J) => (page.items as J[]).map((i) => i.id as string)
const setWrites = (on: boolean) => db.exec(`update platform.ai_work_link_settings set writes_enabled = ${on}`)

beforeAll(async () => {
  db = await createAwlDb("0628")
  await db.exec(FIXTURE_SQL)
}, 120_000) // PGlite starts and the eight migrations apply here: slow on a loaded laptop, and bun's default hook limit is 5 s
afterAll(async () => {
  await db.close()
})

// -------------------------------------------------------------------------------------------------------------- minting
describe("minting a link", () => {
  test("a link is 'pxa_' + 64 hex, returned once, stored only as sha256 with no plaintext (BR-483)", async () => {
    const r = await mint(A.mgr, "proj-a", { label: "  site AI  " })
    expect(r.token).toMatch(/^pxa_[0-9a-f]{64}$/)
    expect(r.label).toBe("site AI")
    expect(r.project).toEqual({ id: "proj-a", name: "Villa A" })
    const row = await one<J>(db, "select token, token_hash, product, project_id, status, user_id, org_id, authority_level, created_by_user_id, expires_at > now() future from platform.user_ai_links where id = $1", [r.link_id])
    expect(row.token).toBeNull()
    expect(row.token_hash).toBe(sha256Hex(r.token))
    expect(row).toMatchObject({ product: "projexa", project_id: "proj-a", status: "active", user_id: "u-mgr", org_id: "org-a", authority_level: 1, created_by_user_id: "u-mgr", future: true })
    // the register rows' own assertions (BR-483): hashed, no plaintext, at least one row
    const hashed = await one<{ v: number }>(db, "select case when count(*) filter (where product = 'projexa') >= 1 and count(*) filter (where product = 'projexa' and token is not null) = 0 then 1 else 0 end v from platform.user_ai_links")
    const hasHash = await one<{ v: number }>(db, "select case when count(*) filter (where product = 'projexa') >= 1 and count(*) filter (where product = 'projexa' and token_hash is null) = 0 then 1 else 0 end v from platform.user_ai_links")
    expect([hashed.v, hasHash.v]).toEqual([1, 1])
  })

  test("two mints give two different tokens; expiry follows the days asked (1, 7 or 30), default 7", async () => {
    const a = await mint(A.sen, "proj-a2", { days: 1 })
    const b = await mint(A.sen, "proj-a2", { days: 30 })
    expect(a.token).not.toBe(b.token)
    const d = await one<{ d1: number; d2: number }>(db, "select round(extract(epoch from (select expires_at - created_at from platform.user_ai_links where id = $1)) / 86400)::int d1, round(extract(epoch from (select expires_at - created_at from platform.user_ai_links where id = $2)) / 86400)::int d2", [a.link_id, b.link_id])
    expect(d).toEqual({ d1: 1, d2: 30 })
    const dflt = await mint(A.sen, "proj-a2")
    expect((await one<{ d: number }>(db, "select round(extract(epoch from (expires_at - created_at)) / 86400)::int d from platform.user_ai_links where id = $1", [dflt.link_id])).d).toBe(7)
  })

  test("only 1, 7 and 30 days and levels 0 and 1 are accepted", async () => {
    for (const days of [0, 2, 8, 31, -1]) {
      const f = await failure(db, "select public.ai_work_link_create_for($1, 'proj-a', 0, null, $2, true, null)", [A.mgr, days])
      expect({ days, m: f.message, c: f.code }).toEqual({ days, m: "BAD_DAYS", c: "AW400" })
    }
    for (const level of [2, -1, 9]) {
      const f = await failure(db, "select public.ai_work_link_create_for($1, 'proj-a', $2, null, 7, true, null)", [A.mgr, level])
      expect({ level, m: f.message, c: f.code }).toEqual({ level, m: "BAD_LEVEL", c: "AW400" })
    }
  })

  test("refused: an inactive person, an unknown person, another organisation's project, a missing project", async () => {
    expect(await failure(db, "select public.ai_work_link_create_for('u-off', 'proj-a', 0, null, 7, true, null)")).toMatchObject({ message: "USER_NOT_ACTIVE", code: "AW403" })
    expect(await failure(db, "select public.ai_work_link_create_for('nobody', 'proj-a', 0, null, 7, true, null)")).toMatchObject({ message: "USER_NOT_ACTIVE", code: "AW403" })
    expect(await failure(db, "select public.ai_work_link_create_for('u-mgr', 'proj-b', 0, null, 7, true, null)")).toMatchObject({ message: "PROJECT_NOT_FOUND", code: "AW404" })
    expect(await failure(db, "select public.ai_work_link_create_for('u-mgr', 'proj-none', 0, null, 7, true, null)")).toMatchObject({ message: "PROJECT_NOT_FOUND", code: "AW404" })
  })

  test("a private project: the lead and an admin may mint, another manager or member may not", async () => {
    expect((await mint(A.sen, "proj-priv", { level: 0 })).link_id).toBeTruthy()
    expect((await mint(A.adm, "proj-priv", { level: 0 })).link_id).toBeTruthy()
    for (const u of [A.mgr, A.mem, A.view]) {
      expect(await failure(db, "select public.ai_work_link_create_for($1, 'proj-priv', 0, null, 7, true, null)", [u])).toMatchObject({ message: "PROJECT_NOT_READABLE", code: "AW403" })
    }
  })

  test("level 1 needs rank 2: a viewer may not; a member may", async () => {
    expect(await failure(db, "select public.ai_work_link_create_for('u-view', 'proj-a', 1, null, 7, true, null)")).toMatchObject({ message: "LEVEL_NOT_ALLOWED", code: "AW403" })
    expect((await mint(A.view, "proj-a", { level: 0 })).allowed_functions).toEqual(["get_construction_project_dashboard"])
    expect((await mint(A.mem, "proj-a", { level: 1 })).level).toBe(1)
  })

  test("functions: the default is every function within the person's rank; a function above the rank, or on no link, is refused", async () => {
    const mgr = await mint(A.mgr, "proj-a")
    expect(mgr.allowed_functions.length).toBe(10)
    const mem = await mint(A.mem, "proj-a")
    expect(mem.allowed_functions).not.toContain("get_construction_budget_status")
    expect(mem.allowed_functions).not.toContain("get_construction_kpi_status")
    expect(mem.allowed_functions.length).toBe(8)
    for (const fn of ["get_construction_budget_status", "review_budget", "create_boq", "generate_construction_progress_summary", "no_such_function"]) {
      const asMember = await failure(db, "select public.ai_work_link_create_for('u-mem', 'proj-a', 0, $1::text[], 7, true, null)", [[fn]])
      expect({ fn, m: asMember.message }).toEqual({ fn, m: "FUNCTION_NOT_ALLOWED" })
    }
    // a chosen subset is kept, sorted and de-duplicated
    const sub = await mint(A.mgr, "proj-a", { fns: ["record_attendance", "get_construction_project_dashboard", "record_attendance"] })
    expect(sub.allowed_functions).toEqual(["get_construction_project_dashboard", "record_attendance"])
    // and a manager may take the budget read that a member may not
    expect((await mint(A.mgr, "proj-a", { fns: ["get_construction_budget_status"] })).allowed_functions).toEqual(["get_construction_budget_status"])
  })

  test("rotation: a new link for the same person and project revokes the old one in the same call, and the old token stops resolving", async () => {
    const first = await mint(A.tm, "proj-a", { level: 0 })
    expect((await resolve(first.token)).status).toBe("ok")
    const second = await mint(A.tm, "proj-a", { level: 0 })
    expect((await resolve(first.token)).status).toBe("gone")
    expect((await resolve(second.token)).status).toBe("ok")
    const rows = await one<{ active: number; revoked: number }>(db, "select count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'revoked' and revoked_at is not null)::int revoked from platform.user_ai_links where user_id = 'u-tm' and project_id = 'proj-a'")
    expect(rows).toEqual({ active: 1, revoked: 1 })
    // another project of the same person is a different link and is left alone
    const other = await mint(A.tm, "proj-a2", { level: 0 })
    expect((await mint(A.tm, "proj-a", { level: 0 })).link_id).not.toBe(second.link_id)
    expect((await resolve(other.token)).status).toBe("ok")
  })

  test("a VERIDIAN link row of the same person is not touched by minting (the two products keep separate indexes)", async () => {
    await db.exec(`insert into platform.user_ai_links (id, org_id, user_id, token) values ('ver-mgr', 'org-a', 'u-mgr', 'plaintext-veridian-link-token')`)
    await mint(A.mgr, "proj-a")
    const v = await one<J>(db, "select status, token, product from platform.user_ai_links where id = 'ver-mgr'")
    expect(v).toEqual({ status: "active", token: "plaintext-veridian-link-token", product: "veridian" })
    expect((await resolve("plaintext-veridian-link-token")).status).toBe("gone")
  })
})

describe("the auth-user variants (the four functions the spec marks 'authenticated', served through the service role)", () => {
  test("ai_work_link_create mints for the person the auth id maps to inside the project's organisation", async () => {
    const r = (await one<{ r: J }>(db, "select public.ai_work_link_create($1::uuid, 'proj-a', 0, null, 7, true, 'via auth') r", [AUTH.mem])).r
    expect(r.user_id).toBe("u-mem")
    expect((await resolve(r.token)).user_id).toBe("u-mem")
    // an auth user of another organisation cannot mint on this project, and cannot tell it exists
    expect(await failure(db, "select public.ai_work_link_create($1::uuid, 'proj-a', 0, null, 7, true, null)", [AUTH.b])).toMatchObject({ message: "PROJECT_NOT_FOUND", code: "AW404" })
    expect(await failure(db, "select public.ai_work_link_create('99999999-9999-4999-8999-999999999999'::uuid, 'proj-a', 0, null, 7, true, null)")).toMatchObject({ message: "PROJECT_NOT_FOUND" })
  })

  test("ai_work_link_list shows only the caller's own links, newest first, with the active flag", async () => {
    await mint(A.mem, "proj-a", { level: 0, label: "older" })
    // PGlite takes its clock from JavaScript (millisecond resolution): two mints in the same millisecond tie on created_at and the order is then arbitrary, which only happens in this test, not in native Postgres.
    await new Promise((resolve) => setTimeout(resolve, 15))
    const newest = await mint(A.mem, "proj-a", { level: 1, label: "newest" })
    const list = (await one<{ r: J[] }>(db, "select public.ai_work_link_list($1::uuid, 'proj-a') r", [AUTH.mem])).r
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list[0]).toMatchObject({ id: newest.link_id, label: "newest", level: 1, project_id: "proj-a", project_name: "Villa A", active: true })
    expect(list.every((l) => typeof l.id === "string" && !("token" in l) && !("token_hash" in l))).toBe(true)
    expect(list.filter((l) => l.active).length).toBe(1)
    const other = (await one<{ r: J[] }>(db, "select public.ai_work_link_list($1::uuid, null) r", [AUTH.b])).r
    expect(other.filter((l) => list.some((x) => x.id === l.id)).length).toBe(0)
  })

  test("revoke: the link's person may, an admin of the same organisation may, a member of the organisation may not, another organisation may not", async () => {
    const mine = await mint(A.mem, "proj-a", { level: 0 })
    expect(await failure(db, "select public.ai_work_link_revoke($1::uuid, $2)", [AUTH.mgr, mine.link_id])).toMatchObject({ message: "NOT_ALLOWED", code: "AW403" })
    expect(await failure(db, "select public.ai_work_link_revoke($1::uuid, $2)", [AUTH.b, mine.link_id])).toMatchObject({ message: "NOT_ALLOWED", code: "AW403" })
    expect((await resolve(mine.token)).status).toBe("ok")
    const byAdmin = (await one<{ r: J }>(db, "select public.ai_work_link_revoke($1::uuid, $2) r", [AUTH.adm, mine.link_id])).r
    expect(byAdmin).toEqual({ link_id: mine.link_id, revoked: true, already: false })
    expect((await resolve(mine.token)).status).toBe("gone")
    // revoking again is harmless and says so
    expect((await one<{ r: J }>(db, "select public.ai_work_link_revoke($1::uuid, $2) r", [AUTH.mem, mine.link_id])).r).toEqual({ link_id: mine.link_id, revoked: false, already: true })
    const own = await mint(A.mem, "proj-a", { level: 0 })
    expect((await one<{ r: J }>(db, "select public.ai_work_link_revoke($1::uuid, $2) r", [AUTH.mem, own.link_id])).r.revoked).toBe(true)
    expect(await failure(db, "select public.ai_work_link_revoke_service('no-such-link', 'u-adm')")).toMatchObject({ message: "NOT_FOUND", code: "AW404" })
    expect(await failure(db, "select public.ai_work_link_revoke_service($1, 'u-off')", [own.link_id])).toMatchObject({ message: "NOT_ALLOWED" })
  })

  test("ai_work_link_warning: the counts of the project, the money clause only from rank 3, the write clause only for level 1 from rank 2", async () => {
    const m = (await one<{ r: J }>(db, "select public.ai_work_link_warning($1::uuid, 'proj-a', 1) r", [AUTH.mgr])).r
    expect(m).toMatchObject({ lines: 4, tasks: 3, money_visible: true, can_record: true, project: { id: "proj-a", name: "Villa A" } })
    expect(m.people).toBeGreaterThanOrEqual(3)
    expect(m.sentence).toContain("This link lets an AI assistant read project Villa A as you see it: 4 BOQ lines, 3 tasks and the names of")
    expect(m.sentence).toContain(", and money figures such as rates, amounts and budgets")
    expect(m.sentence).toContain("It can also record daily entries in your name.")
    expect(m.sentence).toContain("could send this information elsewhere")
    expect(m.sentence).toContain("Use it only in an assistant that you alone use.")
    const member = (await one<{ r: J }>(db, "select public.ai_work_link_warning($1::uuid, 'proj-a', 0) r", [AUTH.mem])).r
    expect(member.money_visible).toBe(false)
    expect(member.sentence).not.toContain("money figures")
    expect(member.sentence).toContain("It cannot change anything without your click.")
    // asking for level 1 does not promise writes to someone below rank 2
    await db.exec("update compliance.users set role = 'viewer' where id = 'u-mem'")
    try {
      const v = (await one<{ r: J }>(db, "select public.ai_work_link_warning($1::uuid, 'proj-a', 1) r", [AUTH.mem])).r
      expect(v.can_record).toBe(false)
      expect(v.sentence).toContain("It cannot change anything without your click.")
    } finally {
      await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
    }
    expect(await failure(db, "select public.ai_work_link_warning($1::uuid, 'proj-b', 0)", [AUTH.mgr])).toMatchObject({ message: "PROJECT_NOT_FOUND" })
  })
})

// ------------------------------------------------------------------------------------------------------------- resolving
describe("resolving a link, on every call, from the live person and project", () => {
  test("a live link resolves with the person, the project, the live role and rank, and the effective values", async () => {
    const l = await mint(A.mgr, "proj-a", { label: "x" })
    const r = await resolve(l.token)
    expect(r).toMatchObject({ status: "ok", link_id: l.link_id, org_id: "org-a", user_id: "u-mgr", user_name: "Mira Manager", project_id: "proj-a", project_name: "Villa A", live_role: "manager", live_rank: 3, authority_level: 1, money_visible: true, hide_personal: true, label: "x", writes_enabled: false })
    expect(r.effective_functions.length).toBe(10)
    expect(r.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  test("unknown, malformed and empty tokens are all 'gone', and so is the stored hash used as if it were a token", async () => {
    const l = await mint(A.mgr, "proj-a")
    const hash = sha256Hex(l.token)
    for (const t of [null, "", "nope", `pxa_${"0".repeat(64)}`, `pxa_${"g".repeat(64)}`, l.token.slice(0, -1), `${l.token}0`, l.token.toUpperCase(), hash, `pxa_${hash}`]) {
      expect(await resolve(t as string)).toEqual({ status: "gone" })
    }
  })

  test("writes_enabled caps every link at level 0; switching it on restores the stored ceiling; switching it off is the kill switch", async () => {
    const l = await mint(A.mgr, "proj-a", { level: 1 })
    expect((await resolve(l.token)).effective_level).toBe(0)
    await setWrites(true)
    try {
      expect((await resolve(l.token)).effective_level).toBe(1)
      const level0 = await mint(A.mgr, "proj-a2", { level: 0 })
      expect((await resolve(level0.token)).effective_level).toBe(0)
    } finally {
      await setWrites(false)
    }
    expect((await resolve(l.token)).effective_level).toBe(0)
  })

  test("a demotion narrows the link at once: the level drops below rank 2 and the money reads leave below rank 3 (audit A-03)", async () => {
    await setWrites(true)
    const l = await mint(A.mem, "proj-a", { level: 1 })
    try {
      expect(await resolve(l.token)).toMatchObject({ effective_level: 1, live_rank: 2, money_visible: false })
      await db.exec("update compliance.users set role = 'viewer' where id = 'u-mem'")
      const v = await resolve(l.token)
      expect(v).toMatchObject({ status: "ok", effective_level: 0, live_rank: 1, live_role: "viewer" })
      expect(v.effective_functions).toEqual(["get_construction_project_dashboard"])
      // the stored ceilings are what was minted, not what the person is now
      expect(v.authority_level).toBe(1)
      expect(v.allowed_functions.length).toBe(8)
    } finally {
      await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
      await setWrites(false)
    }
  })

  test("a promotion never raises a link above what it was minted with", async () => {
    const l = await mint(A.mem, "proj-a", { level: 0 })
    await db.exec("update compliance.users set role = 'manager' where id = 'u-mem'")
    try {
      const r = await resolve(l.token)
      expect(r.authority_level).toBe(0)
      expect(r.effective_level).toBe(0)
      expect(r.effective_functions).not.toContain("get_construction_budget_status")
      expect(r.money_visible).toBe(true) // the person may now see money; the link can only show what it was allowed to carry
    } finally {
      await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
    }
  })

  test("the person is deactivated, or moved to another organisation: the link is gone (PMD-33)", async () => {
    const l = await mint(A.tm, "proj-a", { level: 0 })
    await db.exec("update compliance.users set is_active = false where id = 'u-tm'")
    try {
      expect(await resolve(l.token)).toEqual({ status: "gone" })
    } finally {
      await db.exec("update compliance.users set is_active = true where id = 'u-tm'")
    }
    expect((await resolve(l.token)).status).toBe("ok")
    await db.exec("update compliance.users set org_id = 'org-b' where id = 'u-tm'")
    try {
      expect(await resolve(l.token)).toEqual({ status: "gone" })
    } finally {
      await db.exec("update compliance.users set org_id = 'org-a' where id = 'u-tm'")
    }
  })

  test("the project turns private and the person is neither its lead nor an admin: the link is gone; the lead's and an admin's links still resolve", async () => {
    const l = await mint(A.mem, "proj-a", { level: 0 })
    const lead = await mint(A.mgr, "proj-a", { level: 0 })
    const admin = await mint(A.adm, "proj-a", { level: 0 })
    await db.exec("update compliance.projects set access_level = 'private' where id = 'proj-a'")
    try {
      expect(await resolve(l.token)).toEqual({ status: "gone" })
      expect((await resolve(lead.token)).status).toBe("ok")
      expect((await resolve(admin.token)).status).toBe("ok")
    } finally {
      await db.exec("update compliance.projects set access_level = 'public' where id = 'proj-a'")
    }
    expect((await resolve(l.token)).status).toBe("ok")
  })

  test("the project moves to another organisation, or is deleted: the link is gone", async () => {
    const l = await mint(A.sen, "proj-a2", { level: 0 })
    await db.exec("update compliance.projects set org_id = 'org-b' where id = 'proj-a2'")
    try {
      expect(await resolve(l.token)).toEqual({ status: "gone" })
    } finally {
      await db.exec("update compliance.projects set org_id = 'org-a' where id = 'proj-a2'")
    }
    expect((await resolve(l.token)).status).toBe("ok")
    await db.exec("insert into compliance.projects (id, product_id, org_id, name, lead_user_id) values ('proj-tmp', 'prod', 'org-a', 'Temp', 'u-mgr')")
    const t = await mint(A.mgr, "proj-tmp", { level: 0 })
    expect((await resolve(t.token)).status).toBe("ok")
    await db.exec("delete from compliance.projects where id = 'proj-tmp'")
    expect(await resolve(t.token)).toEqual({ status: "gone" })
  })

  test("an expired link and a revoked link are gone; the stored expiry decides, not a flag", async () => {
    const l = await mint(A.tm, "proj-a2", { level: 0 })
    await db.exec(`update platform.user_ai_links set expires_at = now() - interval '1 second' where id = '${l.link_id}'`)
    expect(await resolve(l.token)).toEqual({ status: "gone" })
    const r = await mint(A.tm, "proj-a2", { level: 0 })
    await db.exec(`update platform.user_ai_links set status = 'revoked', revoked_at = now() where id = '${r.link_id}'`)
    expect(await resolve(r.token)).toEqual({ status: "gone" })
  })

  test("every function that takes a token refuses a dead link with the one sentence and SQLSTATE AW410", async () => {
    const dead = `pxa_${"e".repeat(64)}`
    const calls = [
      "select public.ai_work_link_context($1)",
      "select public.ai_work_link_records($1, 'project')",
      "select public.ai_work_link_record($1, 'project', 'proj-a')",
      "select public.ai_work_link_record_intent($1, 'draft', 'record_work_progress', '{}'::jsonb)",
      "select public.ai_work_link_intent_status($1, 'x')",
      "select public.ai_work_link_history($1)",
    ]
    for (const c of calls) {
      const f = await failure(db, c, [dead])
      expect({ c, m: f.message, code: f.code }).toEqual({ c, m: "This link has expired or was revoked", code: "AW410" })
    }
  })
})

// ------------------------------------------------------------------------------------------------------------ call log
describe("the call log and its limits", () => {
  const log = async (token: string | null, method = "GET", path = "/x", ip: string | null = "203.0.113.9", ua: string | null = "ClaudeBot") =>
    (await one<{ r: J }>(db, "select public.ai_work_link_log_call($1, $2, $3, $4, $5) r", [token, method, path, ip, ua])).r

  test("a live call writes one row, counts it on the link, and returns the count of the last minute", async () => {
    const l = await mint(A.mgr, "proj-a")
    const before = await one<{ c: number }>(db, "select call_count c from platform.user_ai_links where id = $1", [l.link_id])
    const r = await log(l.token, "GET", "/context")
    expect(r).toMatchObject({ status: "ok", link_id: l.link_id, calls_last_minute: 1, limit_per_minute: 120 })
    expect(typeof r.call_id).toBe("string")
    const row = await one<J>(db, "select link_id, org_id, method, path, ip_prefix, ua_family, status, called_at is not null has_time from platform.ai_work_link_call where id = $1", [r.call_id])
    expect(row).toMatchObject({ link_id: l.link_id, org_id: "org-a", method: "GET", path: "/context", ip_prefix: "203.0.113.0/24", ua_family: "ClaudeBot", status: null, has_time: true })
    const after = await one<{ c: number; used: boolean }>(db, "select call_count c, last_used_at is not null used from platform.user_ai_links where id = $1", [l.link_id])
    expect(after).toEqual({ c: before.c + 1, used: true })
    expect((await log(l.token)).calls_last_minute).toBe(2)
  })

  test("the token never reaches the path column, and a query string is dropped", async () => {
    const l = await mint(A.mgr, "proj-a")
    const r = await log(l.token, "GET", `/functions/v1/ai-work-link/${l.token}/records/boq_lines?limit=5&token=${l.token}`)
    const path = (await one<{ p: string }>(db, "select path p from platform.ai_work_link_call where id = $1", [r.call_id])).p
    expect(path).toBe("/functions/v1/ai-work-link/pxa_[redacted]/records/boq_lines")
    expect(path).not.toContain(l.token)
    const all = (await db.query<{ path: string }>("select path from platform.ai_work_link_call")).rows.map((x) => x.path).join("\n")
    expect(all).not.toContain("pxa_" + l.token.slice(4, 20))
    // a long method and path are cut
    const long = await log(l.token, "PROPFINDEXTRA", `/${"a".repeat(600)}`)
    const row = await one<{ m: string; n: number }>(db, "select method m, length(path) n from platform.ai_work_link_call where id = $1", [long.call_id])
    expect(row).toEqual({ m: "PROPFINDEX", n: 512 })
  })

  test("only a /24 or /48 network is stored, never the address", async () => {
    const l = await mint(A.mgr, "proj-a")
    const cases: [string | null, string | null][] = [
      ["203.0.113.77", "203.0.113.0/24"], ["2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff", "2001:db8:aaaa::/48"], ["203.0.113.0/24", "203.0.113.0/24"],
      ["all", "all"], ["not an address", null], ["", null], [null, null], ["  198.51.100.4 ", "198.51.100.0/24"],
    ]
    for (const [given, want] of cases) {
      const r = await log(l.token, "GET", "/x", given)
      expect({ given, stored: (await one<{ p: string | null }>(db, "select ip_prefix p from platform.ai_work_link_call where id = $1", [r.call_id])).p }).toEqual({ given, stored: want })
    }
  })

  test("an unknown token is logged with no link, and from the 31st call a minute from one prefix it is refused BEFORE a row is written", async () => {
    const stranger = `pxa_${"9".repeat(64)}`
    const prefix = "198.51.100.0/24"
    const count = async () => (await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_call where link_id is null and ip_prefix = $1", [prefix])).n
    expect(await count()).toBe(0)
    for (let i = 1; i <= 30; i++) {
      const r = await log(stranger, "GET", "/context", `198.51.100.${i}`)
      expect({ i, status: r.status }).toEqual({ i, status: "unknown" })
    }
    expect(await count()).toBe(30)
    const refused = await log(stranger, "GET", "/context", "198.51.100.200")
    expect(refused).toMatchObject({ status: "throttled", scope: "address", limit_per_minute: 30 })
    expect(await count()).toBe(30) // nothing was written for the 31st
    // another prefix is not affected, and a different token from the same prefix is throttled too (the bucket is the address)
    expect((await log(stranger, "GET", "/context", "203.0.114.5")).status).toBe("unknown")
    expect((await log(`pxa_${"8".repeat(64)}`, "GET", "/context", "198.51.100.9")).status).toBe("throttled")
    // and a known link from the throttled address is not blocked by the unknown-token bucket
    const l = await mint(A.mgr, "proj-a")
    expect((await log(l.token, "GET", "/context", "198.51.100.9")).status).toBe("ok")
  })

  test("calls older than a minute do not count against the unknown-token limit", async () => {
    await db.exec(`insert into platform.ai_work_link_call (id, method, path, ip_prefix, called_at)
                   select 'old-' || g, 'GET', '/x', '192.0.2.0/24', now() - interval '2 minutes' from generate_series(1, 40) g`)
    expect((await log(`pxa_${"7".repeat(64)}`, "GET", "/x", "192.0.2.5")).status).toBe("unknown")
  })

  test("the shared bucket 'all' (spike S-3 fallback) throttles every caller together", async () => {
    const stranger = `pxa_${"6".repeat(64)}`
    for (let i = 1; i <= 30; i++) expect((await log(stranger, "GET", "/x", "all")).status).toBe("unknown")
    expect((await log(stranger, "GET", "/x", "all")).status).toBe("throttled")
  })

  test("a link is limited to 120 calls a minute, over that the call is refused with no row, and another link is not affected", async () => {
    const l = await mint(A.mgr, "proj-a")
    const other = await mint(A.sen, "proj-a2", { level: 0 })
    await db.exec(`insert into platform.ai_work_link_call (id, link_id, org_id, method, path, called_at)
                   select 'flood-' || g, '${l.link_id}', 'org-a', 'GET', '/x', now() - make_interval(secs => 1) from generate_series(1, 120) g`)
    const refused = await log(l.token)
    expect(refused).toMatchObject({ status: "throttled", scope: "link", limit_per_minute: 120 })
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_call where link_id = $1", [l.link_id])).n).toBe(120)
    expect((await log(other.token)).status).toBe("ok")
  })

  test("a revoked or expired link is answered 'gone' and counted like an unknown token: no link on the row, limited per address prefix (spec 10.5); a malformed token writes no row", async () => {
    const l = await mint(A.tm, "proj-a2", { level: 0 })
    await db.exec(`update platform.user_ai_links set status = 'revoked', revoked_at = now() where id = '${l.link_id}'`)
    const r = await log(l.token, "GET", "/x", "192.0.2.77")
    expect(r).toMatchObject({ status: "gone", link_id: null, limit_per_minute: 30 })
    expect(await one<J>(db, "select link_id, org_id, ip_prefix from platform.ai_work_link_call where id = $1", [r.call_id])).toEqual({ link_id: null, org_id: null, ip_prefix: "192.0.2.0/24" })
    // the revoked link's call count does not move, and from the 31st call a minute from the prefix the dead link is refused before a row is written
    expect((await one<{ c: number }>(db, "select call_count c from platform.user_ai_links where id = $1", [l.link_id])).c).toBe(0)
    const prefixRows = async () => (await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_call where link_id is null and ip_prefix = '192.0.2.0/24' and called_at > now() - interval '1 minute'")).n
    const already = await prefixRows()
    for (let i = already; i < 30; i++) expect((await log(l.token, "GET", "/x", `192.0.2.${i}`)).status).toBe("gone")
    expect(await log(l.token, "GET", "/x", "192.0.2.200")).toMatchObject({ status: "throttled", scope: "address", limit_per_minute: 30 })
    expect(await prefixRows()).toBe(30)
    // an expired link is treated the same way
    const e = await mint(A.sen, "proj-a2", { level: 0 })
    await db.exec(`update platform.user_ai_links set expires_at = now() - interval '1 second' where id = '${e.link_id}'`)
    expect(await log(e.token, "GET", "/x", "203.0.113.200")).toMatchObject({ status: "gone", link_id: null })
    const before = (await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_call")).n
    expect(await log("not-a-token")).toEqual({ status: "malformed" })
    expect(await log(`pxa_${"A".repeat(64)}`)).toEqual({ status: "malformed" })
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_call")).n).toBe(before)
  })

  test("the log FAILS CLOSED: with no partition for the month the call raises instead of being served unlogged", async () => {
    const l = await mint(A.mgr, "proj-a")
    const part = (await one<{ n: string }>(db, "select 'ai_work_link_call_' || to_char(now() at time zone 'UTC', 'YYYY_MM') n")).n
    await db.exec(`alter table platform.ai_work_link_call detach partition platform.${part}`)
    try {
      const f = await failure(db, "select public.ai_work_link_log_call($1, 'GET', '/x', null, null)", [l.token])
      expect(f.message).toContain("no partition of relation")
    } finally {
      await db.exec(`alter table platform.ai_work_link_call attach partition platform.${part} for values from (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') to ((date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC')`)
    }
    expect((await log(l.token)).status).toBe("ok")
  })

  test("the result is filled once: a second fill, an unknown id and an old row change nothing", async () => {
    const l = await mint(A.mgr, "proj-a")
    const call = await log(l.token)
    const filled = (await one<{ r: J }>(db, "select public.ai_work_link_log_call_result($1, 200, 1234) r", [call.call_id])).r
    expect(filled).toEqual({ ok: true })
    expect(await one<J>(db, "select status, bytes, finished_at is not null done from platform.ai_work_link_call where id = $1", [call.call_id])).toEqual({ status: 200, bytes: 1234, done: true })
    expect((await one<{ r: J }>(db, "select public.ai_work_link_log_call_result($1, 500, 1) r", [call.call_id])).r).toEqual({ ok: false })
    expect((await one<{ r: J }>(db, "select public.ai_work_link_log_call_result('no-such-call', 200, 1) r")).r).toEqual({ ok: false })
    expect((await one<{ s: number }>(db, "select status s from platform.ai_work_link_call where id = $1", [call.call_id])).s).toBe(200)
  })
})

// --------------------------------------------------------------------------------------------------------------- context
describe("the context page (spec 6.1)", () => {
  test("the shape, with business counters only; the rate is separate", async () => {
    const l = await mint(A.mgr, "proj-a")
    const c = (await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [l.token])).c
    expect(c).toMatchObject({
      product: "projexa", project: { id: "proj-a", name: "Villa A" }, level: 0, text_fields_are_data: true,
      acting_for: { name: "Mira Manager", role: "manager", money_visible: true }, rate: { limit_per_minute: 120 },
    })
    expect(Object.keys(c.counters).sort()).toEqual(["intents", "submissions"])
    expect(c.allowed_functions).toEqual(c.functions.map((f: J) => f.id))
    for (const f of c.functions) expect(f.available).toBe(false) // writes_enabled is off: nothing is available yet
  })

  test("counters.submissions counts this person's submissions on this project, and counters.intents this link's intents", async () => {
    await db.exec(`insert into compliance.submissions (id, org_id, project_id, mode, raw_input, user_id) values
      ('sub-1', 'org-a', 'proj-a', 'Projects', 'a', 'u-mgr'), ('sub-2', 'org-a', 'proj-a', 'Projects', 'b', 'u-mgr'),
      ('sub-3', 'org-a', 'proj-a2', 'Projects', 'other project', 'u-mgr'), ('sub-4', 'org-a', 'proj-a', 'Projects', 'other person', 'u-mem')`)
    const l = await mint(A.mgr, "proj-a")
    expect((await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [l.token])).c.counters).toEqual({ intents: 0, submissions: 2 })
    await one(db, "select public.ai_work_link_record_intent($1, 'draft', 'record_work_progress', '{\"itemCode\":\"1.01\",\"percent\":5}'::jsonb)", [l.token])
    expect((await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [l.token])).c.counters).toEqual({ intents: 1, submissions: 2 })
  })

  test("money_fields: a member sees every money column listed as hidden; a manager whose organisation grants cost sees none; one whose organisation withholds it loses only the cost fields", async () => {
    const mem = await mint(A.mem, "proj-a")
    const m = (await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [mem.token])).c.money_fields
    expect(m.boq_lines).toEqual(expect.arrayContaining(["rate", "amount", "rate_project", "rate_contract", "material_cost"]))
    expect(m.project).toEqual(["project_value", "vat_rate_percent", "retention_percent"])
    expect(m.roster).toEqual(["daily_rate"])
    const mgr = await mint(A.mgr, "proj-a")
    expect((await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [mgr.token])).c.money_fields).toEqual({})
    const sen = await mint(A.sen, "proj-a2", { level: 0 })
    expect((await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [sen.token])).c.money_fields).toEqual({ project: ["project_value"], boq_lines: ["rate_project"] })
  })

  test("availability follows the switch, and the function list is the effective one", async () => {
    const l = await mint(A.mem, "proj-a")
    await setWrites(true)
    try {
      const c = (await one<{ c: J }>(db, "select public.ai_work_link_context($1) c", [l.token])).c
      expect(c.level).toBe(1)
      expect(c.functions.length).toBe(8)
      expect(c.functions.every((f: J) => f.available === true)).toBe(true)
      const dash = c.functions.find((f: J) => f.id === "get_construction_project_dashboard")
      expect(dash).toMatchObject({ kind: "read", level: 0, money_sensitive: true, min_role_rank: 1 })
      expect(c.functions.find((f: J) => f.id === "record_timesheet").text_params).toEqual(["task", "activityType"])
    } finally {
      await setWrites(false)
    }
  })
})

// --------------------------------------------------------------------------------------------------------------- records
describe("records: scope, money, filters, paging", () => {
  let mgr: string
  let mem: string
  let sen: string
  let lead2: string

  beforeAll(async () => {
    mgr = (await mint(A.mgr, "proj-a")).token
    mem = (await mint(A.mem, "proj-a")).token
    sen = (await mint(A.sen, "proj-a")).token
    lead2 = (await mint(A.sen, "proj-a2", { level: 0 })).token
  })

  const EXPECTED_IDS: Record<string, string[]> = {
    project: ["proj-a"],
    boqs: ["boq-a1", "boq-a2"],
    boq_lines: ["la-1", "la-2", "la-3", "la-4"],
    activities: ["act-1", "act-2"],
    progress: ["pe-1", "pe-2", "pe-3"],
    tasks: ["is-1", "is-2", "is-3"],
    meetings: ["m-1", "m-2"],
    documents: ["d-1"],
    roster: ["ro-1", "ro-2"],
    attendance: ["at-1", "at-2"],
    timesheets: ["te-1", "te-2"],
    pipeline_tasks: ["pt-1", "pt-2"],
    people: ["u-adm", "u-mem", "u-mgr", "u-tm"].sort(),
  }

  test("there are 13 kinds, each with its own scope: exactly this project's rows and never a decoy", async () => {
    const kinds = (await db.query<{ kind: string }>("select kind from platform.ai_work_link_record_kinds order by kind")).rows.map((r) => r.kind)
    expect(kinds).toEqual(Object.keys(EXPECTED_IDS).sort())
    for (const [kind, want] of Object.entries(EXPECTED_IDS)) {
      const page = await records(mgr, kind)
      const got = ids(page).sort()
      if (kind === "people") {
        // the lead, the team, assignees and recorders, and the link's own person; nobody of another organisation
        expect(got).toEqual(expect.arrayContaining(["u-mgr", "u-tm", "u-mem"]))
        expect(got).not.toContain("u-b")
        expect(got).not.toContain("u-off")
      } else {
        expect({ kind, got }).toEqual({ kind, got: [...want].sort() })
      }
      expect(JSON.stringify(page)).not.toContain("SECRET")
    }
  })

  test("a link on another project of the same organisation sees only that project's rows", async () => {
    expect(ids(await records(lead2, "boq_lines"))).toEqual(["lx-a2x"])
    expect(ids(await records(lead2, "boqs"))).toEqual(["boq-a2x"])
    expect(ids(await records(lead2, "activities"))).toEqual(["act-x"])
    expect(ids(await records(lead2, "tasks"))).toEqual(["is-x"])
    expect(ids(await records(lead2, "documents"))).toEqual(["d-2"])
    expect(ids(await records(lead2, "timesheets"))).toEqual(["te-x"])
    expect(ids(await records(lead2, "project"))).toEqual(["proj-a2"])
  })

  test("money: a manager whose organisation grants cost sees every column; a member sees them null, and pipeline_tasks params and result are left out", async () => {
    const boq = (await records(mgr, "boq_lines", { limit: 1 })).items[0]
    expect(boq).toMatchObject({ id: "la-1", rate: 10, amount: 20, material_cost: 4, labour_cost: 5, equipment_cost: 1, budget_percentage: 10, vendor_amount: 3, material_amount: 2, manpower_amount: 1, rate_project: 7, rate_contract: 9 })
    const proj = (await records(mgr, "project")).items[0]
    expect(proj).toMatchObject({ project_value: 1000000, vat_rate_percent: 18, retention_percent: 5 })
    expect((await records(mgr, "roster")).items.map((r: J) => r.daily_rate).sort()).toEqual([450, 500])
    expect((await records(mgr, "pipeline_tasks")).items[0].params).toBeDefined()

    const kinds = (await db.query<{ kind: string; money_columns: string[]; omit: string[] | null }>("select kind, money_columns, (filters -> 'omit_when_hidden') omit from platform.ai_work_link_record_kinds where cardinality(money_columns) > 0 order by 1")).rows
    expect(kinds.length).toBe(7)
    for (const k of kinds) {
      const page = await records(mem, k.kind)
      expect(page.items.length).toBeGreaterThan(0)
      expect(page.hidden_fields).toEqual(k.money_columns)
      for (const item of page.items as J[]) {
        for (const col of k.money_columns) {
          if (k.omit?.includes(col)) expect({ kind: k.kind, col, present: col in item }).toEqual({ kind: k.kind, col, present: false })
          else expect({ kind: k.kind, col, v: item[col] }).toEqual({ kind: k.kind, col, v: null })
        }
      }
    }
    // the same member sees the non-money columns of the same rows
    const line = (await records(mem, "boq_lines", { limit: 1 })).items[0]
    expect(line).toMatchObject({ id: "la-1", quantity: 2, item_code: "1.01", description: "A line 1", rate: null, amount: null })
    expect(JSON.stringify(await records(mem, "pipeline_tasks"))).not.toContain("dailyRate")
  })

  test("a manager of an organisation that withholds cost sees the money columns but not the project-side cost fields", async () => {
    const line = (await records(sen, "boq_lines", { limit: 1 })).items[0]
    expect(line).toMatchObject({ rate: 10, amount: 20, rate_contract: 9, rate_project: null })
    expect((await records(sen, "project")).items[0]).toMatchObject({ vat_rate_percent: 18, project_value: null })
    expect((await records(sen, "project")).hidden_fields).toEqual(["project_value"])
  })

  test("every filter and every sort of the allow-list runs against its real table (the seed and the SQL agree)", async () => {
    const kinds = (await db.query<{ kind: string; filters: J }>("select kind, filters from platform.ai_work_link_record_kinds order by kind")).rows
    const sample: Record<string, string> = { text: "x", numeric: "1", date: "2026-09-01", timestamptz: "2026-09-01T00:00:00Z", boolean: "true" }
    let ran = 0
    for (const k of kinds) {
      for (const [field, def] of Object.entries<J>(k.filters.fields)) {
        for (const op of def.ops as string[]) {
          const value = op === "in" ? `${sample[def.type]},${sample[def.type]}` : sample[def.type]
          const f = await recordsErr(mgr, k.kind, { [`${field}_${op}`]: value })
          expect({ kind: k.kind, field, op, err: f.message }).toEqual({ kind: k.kind, field, op, err: "" })
          ran++
        }
      }
      for (const field of k.filters.sort as string[]) {
        for (const dir of ["", "-"]) {
          const f = await recordsErr(mgr, k.kind, { sort: `${dir}${field}` })
          expect({ kind: k.kind, sort: `${dir}${field}`, err: f.message }).toEqual({ kind: k.kind, sort: `${dir}${field}`, err: "" })
          ran++
        }
      }
    }
    expect(ran).toBeGreaterThan(150)
  })

  test("eq, gt, lt and in return the right rows", async () => {
    expect(ids(await records(mgr, "boq_lines", { filters: { item_code_eq: "1.02" } }))).toEqual(["la-2"])
    expect(ids(await records(mgr, "boq_lines", { filters: { quantity_gt: 2 } })).sort()).toEqual(["la-2", "la-3"])
    expect(ids(await records(mgr, "boq_lines", { filters: { quantity_lt: 2 } }))).toEqual(["la-4"])
    expect(ids(await records(mgr, "boq_lines", { filters: { item_code_in: "1.01,2.02,nope" } })).sort()).toEqual(["la-1", "la-4"])
    expect(ids(await records(mgr, "boq_lines", { filters: { amount_gt: 25, category_eq: "civil" } }))).toEqual(["la-2"])
    expect(ids(await records(mgr, "progress", { filters: { entry_date_gt: "2026-09-01" } })).sort()).toEqual(["pe-2", "pe-3"])
    expect(ids(await records(mgr, "meetings", { filters: { scheduled_at_lt: "2026-09-15T00:00:00Z" } }))).toEqual(["m-1"])
    expect(ids(await records(mgr, "roster", { filters: { is_active_eq: "true", trade_eq: "mason" } }))).toEqual(["ro-1"])
    expect(ids(await records(mgr, "tasks", { filters: { priority_in: "high,low" } })).sort()).toEqual(["is-1", "is-2"])
  })

  test("sorting: ascending and descending, by a real column, with the id as tiebreak", async () => {
    expect(ids(await records(mgr, "boq_lines", { filters: { sort: "amount" } }))).toEqual(["la-1", "la-3", "la-2", "la-4"])
    expect(ids(await records(mgr, "boq_lines", { filters: { sort: "-amount" } }))).toEqual(["la-4", "la-2", "la-3", "la-1"])
    expect(ids(await records(mgr, "tasks", { filters: { sort: "-number" } }))).toEqual(["is-3", "is-2", "is-1"])
    expect(ids(await records(mgr, "people", { filters: { sort: "-name" } }))[0]).toBe("u-tm")
  })

  test("a money column can be neither filtered nor sorted below rank 3, or when the organisation withholds the cost field (audit A-09)", async () => {
    const kinds = (await db.query<{ kind: string; money_columns: string[]; filters: J }>("select kind, money_columns, filters from platform.ai_work_link_record_kinds where cardinality(money_columns) > 0 order by 1")).rows
    let refused = 0
    for (const k of kinds) {
      for (const col of k.money_columns) {
        const def = k.filters.fields[col] as J | undefined
        if (def) {
          for (const op of def.ops as string[]) {
            const f = await recordsErr(mem, k.kind, { [`${col}_${op}`]: op === "in" ? "1,2" : "1" })
            expect({ kind: k.kind, col, op, m: f.message, c: f.code }).toEqual({ kind: k.kind, col, op, m: "HIDDEN_FIELD", c: "AW403" })
            refused++
          }
        }
        if ((k.filters.sort as string[]).includes(col)) {
          for (const dir of ["", "-"]) {
            const f = await recordsErr(mem, k.kind, { sort: `${dir}${col}` })
            expect({ kind: k.kind, col, dir, m: f.message }).toEqual({ kind: k.kind, col, dir, m: "HIDDEN_FIELD" })
            refused++
          }
        }
      }
    }
    expect(refused).toBeGreaterThan(20)
    // the register rows' own examples (AWL-H23): a range filter and a sort on money as a member
    expect((await recordsErr(mem, "boq_lines", { amount_gt: 0 })).message).toBe("HIDDEN_FIELD")
    expect((await recordsErr(mem, "boq_lines", { sort: "rate" })).message).toBe("HIDDEN_FIELD")
    // a manager may; a manager whose organisation withholds cost may filter what it shows, but not the cost field
    expect((await recordsErr(mgr, "boq_lines", { amount_gt: 0 })).message).toBe("")
    expect((await recordsErr(sen, "boq_lines", { amount_gt: 0 })).message).toBe("")
    expect((await recordsErr(sen, "boq_lines", { rate_project_gt: 0 })).message).toBe("UNKNOWN_FILTER")
  })

  test("unknown and malformed filters are refused, and a value is only ever a quoted literal", async () => {
    for (const [filters, msg] of [
      [{ nope: 1 }, "UNKNOWN_FILTER"], [{ nope_eq: 1 }, "UNKNOWN_FILTER"], [{ item_code_like: "x" }, "UNKNOWN_FILTER"], [{ item_code: "x" }, "UNKNOWN_FILTER"],
      [{ amount_in: "1" }, "UNKNOWN_FILTER"], [{ sort: "nope" }, "UNKNOWN_FILTER"], [{ sort: "-nope" }, "UNKNOWN_FILTER"], [{ sort: "" }, "UNKNOWN_FILTER"],
      [{ quantity_gt: "abc" }, "BAD_FILTER_VALUE"], [{ quantity_eq: [1] }, "BAD_FILTER_VALUE"], [{ quantity_eq: null }, "BAD_FILTER_VALUE"],
      [{ quantity_eq: { a: 1 } }, "BAD_FILTER_VALUE"], [{ item_code_in: Array.from({ length: 51 }, (_, i) => `c${i}`).join(",") }, "BAD_FILTER_VALUE"],
    ] as [unknown, string][]) {
      const f = await recordsErr(mgr, "boq_lines", filters)
      expect({ filters, m: f.message }).toEqual({ filters, m: msg })
      expect(f.code).toBe("AW400")
    }
    expect((await recordsErr(mgr, "progress", { entry_date_eq: "not a date" })).message).toBe("BAD_FILTER_VALUE")
    expect((await failure(db, "select public.ai_work_link_records($1, 'boq_lines', null, 5, '[1]'::jsonb)", [mgr])).message).toBe("BAD_FILTER_VALUE")
    // injection attempts are values, so they match nothing and change nothing
    for (const evil of ["x' or '1'='1", "'; drop table platform.ai_work_link_call; --", "1.01') or true or ('"]) {
      expect(ids(await records(mgr, "boq_lines", { filters: { item_code_eq: evil } }))).toEqual([])
      expect(ids(await records(mgr, "boq_lines", { filters: { item_code_in: evil } }))).toEqual([])
    }
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_class where relname = 'ai_work_link_call'")).n).toBe(1)
    expect((await recordsErr(mgr, "no_such_kind", {})).message).toBe("UNKNOWN_KIND")
    expect((await recordsErr(mgr, "boq_lines", {})).message).toBe("")
  })

  test("keyset paging returns every row once, in order, and next_after is null on the last page (default order and sorted)", async () => {
    const seen: string[] = []
    let after: string | null = null
    let pages = 0
    do {
      const page: J = await records(mgr, "boq_lines", { limit: 3, after })
      seen.push(...ids(page))
      after = page.next_after
      pages++
    } while (after && pages < 10)
    expect(seen).toEqual(["la-1", "la-2", "la-3", "la-4"])
    expect(pages).toBe(2)
    const first = await records(mgr, "boq_lines", { limit: 1 })
    expect(first.next_after).toBe("la-1")
    // sorted and descending: the cursor continues after the last row in that order
    const desc: string[] = []
    after = null
    do {
      const page: J = await records(mgr, "boq_lines", { limit: 1, after, filters: { sort: "-amount" } })
      desc.push(...ids(page))
      after = page.next_after
    } while (after && desc.length < 10)
    expect(desc).toEqual(["la-4", "la-2", "la-3", "la-1"])
    // the limit is clamped to 1..200 and never errors
    expect((await records(mgr, "boq_lines", { limit: 0 })).items.length).toBe(1)
    expect((await records(mgr, "boq_lines", { limit: 100000 })).items.length).toBe(4)
  })

  test("a cursor that is not a row of this link's scope, or is not an id, is refused", async () => {
    for (const after of ["lx-a2x", "lx-b", "lx-wrong-org", "no-such-row", "la-1'; select 1; --", "a b", "x".repeat(65)]) {
      const f = await recordsErr(mgr, "boq_lines", {}, { after })
      expect({ after, m: f.message, c: f.code }).toEqual({ after, m: "BAD_CURSOR", c: "AW400" })
    }
  })

  test("record: one row by id; another project's id, another organisation's id and a missing id all give NULL (the 404)", async () => {
    const one1 = (await one<{ r: J }>(db, "select public.ai_work_link_record($1, 'boq_lines', 'la-3') r", [mgr])).r
    expect(one1).toMatchObject({ id: "la-3", item_code: "2.01", rate: 4 })
    for (const id of ["lx-a2x", "lx-b", "lx-wrong-org", "no-such-row", "x'; --"]) {
      expect({ id, r: (await one<{ r: J | null }>(db, "select public.ai_work_link_record($1, 'boq_lines', $2) r", [mgr, id])).r }).toEqual({ id, r: null })
    }
    expect((await one<{ r: J | null }>(db, "select public.ai_work_link_record($1, 'documents', 'd-2') r", [mgr])).r).toBeNull()
    expect((await one<{ r: J | null }>(db, "select public.ai_work_link_record($1, 'documents', 'd-1') r", [mgr])).r).toMatchObject({ id: "d-1", name: "Drawing set" })
    // money is redacted the same way for a single record
    expect((await one<{ r: J }>(db, "select public.ai_work_link_record($1, 'boq_lines', 'la-3') r", [mem])).r).toMatchObject({ id: "la-3", rate: null, amount: null, item_code: "2.01" })
  })

  test("people: e-mail addresses are masked for everyone but the link's person when hide_personal is on, and shown when it is off", async () => {
    const hidden = (await records(mgr, "people")).items as J[]
    const me = hidden.find((p) => p.id === "u-mgr")!
    expect(me).toMatchObject({ is_you: true, email: "mira@a.example.test", name: "Mira Manager", role: "manager" })
    const tia = hidden.find((p) => p.id === "u-tm")!
    expect(tia).toMatchObject({ is_you: false, email: "t***@a.example.test" })
    // a second link for the same person would revoke `mgr`, so an admin's link with hide_personal off shows the same people
    const open = (await mint(A.adm, "proj-a", { hide: false })).token
    const shown = ((await records(open, "people")).items as J[]).find((p) => p.id === "u-tm")!
    expect(shown.email).toBe("tia@a.example.test")
  })

  test("documents: only documents linked to this project as a project, and no file address is shown", async () => {
    const page = await records(mgr, "documents")
    expect(ids(page)).toEqual(["d-1"])
    expect(Object.keys(page.items[0])).not.toContain("file_url")
    expect(Object.keys(page.items[0])).not.toContain("extracted_data")
    expect(JSON.stringify(page)).not.toContain("example.test")
  })

  test("a row's key list is exactly the whitelist: no column the function does not name is ever shown", async () => {
    const line = (await records(mgr, "boq_lines", { limit: 1 })).items[0]
    expect(Object.keys(line).sort()).toEqual(
      ["activity_id", "amount", "boq_id", "budget_percentage", "category", "created_at", "description", "equipment_cost", "id", "item_code", "labour_cost", "manpower_amount", "material_amount", "material_cost", "parent_line_item_id", "qty_contract", "quantity", "rate", "rate_contract", "rate_project", "unit", "vendor_amount"].sort(),
    )
    expect(Object.keys(line)).not.toContain("qty_project")
    expect(Object.keys(line)).not.toContain("overhead_percent")
    expect(Object.keys(line)).not.toContain("vendor_id")
    expect(Object.keys((await records(mgr, "boqs")).items[0])).not.toContain("override_reason")
  })
})

// -------------------------------------------------------------------------------------------------------------- intents
describe("intents and draft confirmation", () => {
  const rec = async (token: string, kind: string, fn: string, params: unknown, key: string | null = null) =>
    (await one<{ r: J }>(db, "select public.ai_work_link_record_intent($1, $2, $3, $4::jsonb, $5) r", [token, kind, fn, JSON.stringify(params), key])).r
  const recErr = (token: string, kind: string, fn: string, params: unknown, key: string | null = null) =>
    failure(db, "select public.ai_work_link_record_intent($1, $2, $3, $4::jsonb, $5)", [token, kind, fn, JSON.stringify(params), key])
  const confirm = async (draft: string, token: string | null, actor: string) => (await one<{ r: J }>(db, "select public.ai_work_link_draft_confirm($1, $2, $3) r", [draft, token, actor])).r
  const P = { itemCode: "1.01", percent: 10 }

  test("a draft is recorded while writes are off: awaiting_confirmation, a one-time confirm token stored only as sha256, 48 hours", async () => {
    const l = await mint(A.mgr, "proj-a")
    const d = await rec(l.token, "draft", "record_work_progress", P, "draft-1")
    expect(d).toMatchObject({ kind: "draft", status: "awaiting_confirmation", function_id: "record_work_progress", replayed: false, submission_id: null })
    expect(d.confirm_token).toMatch(/^[0-9a-f]{64}$/)
    const row = await one<J>(db, "select confirm_token_hash, org_id, project_id, user_id, params, idempotency_key, round(extract(epoch from (expires_at - created_at)) / 3600)::int hours from platform.ai_work_link_intent where id = $1", [d.intent_id])
    expect(row).toMatchObject({ confirm_token_hash: sha256Hex(d.confirm_token), org_id: "org-a", project_id: "proj-a", user_id: "u-mgr", params: P, idempotency_key: "draft-1", hours: 48 })
    expect(JSON.stringify(row)).not.toContain(d.confirm_token)
    expect((await one<{ w: number }>(db, "select write_count w from platform.user_ai_links where id = $1", [l.link_id])).w).toBe(1)
  })

  test("a direct action needs the EFFECTIVE level 1: refused while writes are off, at level 0, and after a demotion; allowed once writes are on", async () => {
    const l1 = await mint(A.mem, "proj-a", { level: 1 })
    expect(await recErr(l1.token, "action", "record_work_progress", P)).toMatchObject({ message: "LEVEL_NOT_ALLOWED", code: "AW403" })
    await setWrites(true)
    try {
      const ok = await rec(l1.token, "action", "record_attendance", { rosterId: "ro-1", date: "2026-09-01" })
      expect(ok).toMatchObject({ kind: "action", status: "recorded", replayed: false, confirm_token: null })
      expect((await one<{ h: number }>(db, "select round(extract(epoch from (expires_at - created_at)) / 60)::int h from platform.ai_work_link_intent where id = $1", [ok.intent_id])).h).toBe(60)
      const level0 = await mint(A.tm, "proj-a", { level: 0 })
      expect(await recErr(level0.token, "action", "record_attendance", { rosterId: "ro-1" })).toMatchObject({ message: "LEVEL_NOT_ALLOWED" })
      // a level-2 function is only ever a draft, even at level 1
      expect(await recErr(l1.token, "action", "add_roster_entry", { name: "x", dailyRate: 1 })).toMatchObject({ message: "LEVEL_NOT_ALLOWED" })
      expect((await rec(l1.token, "draft", "add_roster_entry", { name: "x", dailyRate: 1 })).status).toBe("awaiting_confirmation")
      // demoted below rank 2 after the link was minted: the same call is now refused, and the function has left the list
      await db.exec("update compliance.users set role = 'viewer' where id = 'u-mem'")
      try {
        expect(await recErr(l1.token, "action", "record_attendance", { rosterId: "ro-1", date: "2026-09-02" })).toMatchObject({ message: "FUNCTION_NOT_ON_LINK", code: "AW403" })
        expect(await recErr(l1.token, "draft", "record_attendance", { rosterId: "ro-1", date: "2026-09-02" })).toMatchObject({ message: "FUNCTION_NOT_ON_LINK" })
      } finally {
        await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
      }
    } finally {
      await setWrites(false)
    }
  })

  test("refused: a function not on the link, a read function, a bad kind, bad params, a projectId of another project", async () => {
    const l = await mint(A.mem, "proj-a")
    expect(await recErr(l.token, "draft", "create_boq", { title: "x" })).toMatchObject({ message: "FUNCTION_NOT_ON_LINK" })
    expect(await recErr(l.token, "draft", "get_construction_budget_status", {})).toMatchObject({ message: "FUNCTION_NOT_ON_LINK" }) // above a member's rank
    expect(await recErr(l.token, "draft", "get_construction_project_dashboard", {})).toMatchObject({ message: "NOT_A_WRITE", code: "AW400" })
    expect(await recErr(l.token, "purge", "record_work_progress", P)).toMatchObject({ message: "BAD_KIND", code: "AW400" })
    expect(await recErr(l.token, "draft", "record_work_progress", [1])).toMatchObject({ message: "BAD_PARAMS", code: "AW400" })
    expect(await recErr(l.token, "draft", "record_work_progress", { note: "x".repeat(9000) })).toMatchObject({ message: "BAD_PARAMS" })
    expect((await failure(db, "select public.ai_work_link_record_intent($1, 'draft', 'record_work_progress', null)", [l.token])).message).toBe("BAD_PARAMS")
    expect(await recErr(l.token, "draft", "record_work_progress", P, "k".repeat(129))).toMatchObject({ message: "BAD_PARAMS" })
    expect(await recErr(l.token, "draft", "record_work_progress", { ...P, projectId: "proj-a2" })).toMatchObject({ message: "WRONG_PROJECT", code: "AW403" })
    expect(await recErr(l.token, "draft", "record_work_progress", { ...P, projectId: "proj-b" })).toMatchObject({ message: "WRONG_PROJECT" })
    expect((await rec(l.token, "draft", "record_work_progress", { ...P, projectId: "proj-a" }, "own-project")).status).toBe("awaiting_confirmation")
  })

  test("idempotency: the same key replays the stored intent and writes nothing; the default key is per function, params and UTC day", async () => {
    const l = await mint(A.mgr, "proj-a")
    const a = await rec(l.token, "draft", "record_work_progress", P, "same-key")
    const b = await rec(l.token, "draft", "record_work_progress", { itemCode: "OTHER", percent: 99 }, "same-key")
    expect(b).toMatchObject({ intent_id: a.intent_id, replayed: true, status: "awaiting_confirmation", confirm_token: null })
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_intent where link_id = $1 and idempotency_key = 'same-key'", [l.link_id])).n).toBe(1)
    // without a key: identical params on the same day are one intent, different params are two
    const c = await rec(l.token, "draft", "record_work_progress", { itemCode: "2.01", percent: 5 })
    const d = await rec(l.token, "draft", "record_work_progress", { percent: 5, itemCode: "2.01" }) // key order does not matter
    const e = await rec(l.token, "draft", "record_work_progress", { itemCode: "2.01", percent: 6 })
    expect(d).toMatchObject({ intent_id: c.intent_id, replayed: true })
    expect(e.intent_id).not.toBe(c.intent_id)
    const key = (await one<{ k: string }>(db, "select idempotency_key k from platform.ai_work_link_intent where id = $1", [c.intent_id])).k
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    // yesterday's identical entry does not hold today's key
    await db.exec(`update platform.ai_work_link_intent set idempotency_key = 'yesterday' where id = '${c.intent_id}'`)
    expect((await rec(l.token, "draft", "record_work_progress", { itemCode: "2.01", percent: 5 })).replayed).toBe(false)
    // the same key on another link is another key
    const other = await mint(A.sen, "proj-a2", { level: 0 })
    expect((await rec(other.token, "draft", "record_work_progress", P, "same-key")).replayed).toBe(false)
  })

  test("a failed, refused or expired intent frees its key, and an unexecuted intent past its expiry is expired on the next attempt (audit A-10)", async () => {
    const l = await mint(A.mgr, "proj-a")
    for (const status of ["failed", "refused", "expired"]) {
      const first = await rec(l.token, "draft", "record_work_progress", P, `free-${status}`)
      await db.exec(`update platform.ai_work_link_intent set status = '${status}' where id = '${first.intent_id}'`)
      const retry = await rec(l.token, "draft", "record_work_progress", P, `free-${status}`)
      expect({ status, replayed: retry.replayed, same: retry.intent_id === first.intent_id }).toEqual({ status, replayed: false, same: false })
    }
    const stale = await rec(l.token, "draft", "record_work_progress", P, "stale")
    await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${stale.intent_id}'`)
    const fresh = await rec(l.token, "draft", "record_work_progress", P, "stale")
    expect(fresh.replayed).toBe(false)
    expect((await one<{ s: string }>(db, "select status s from platform.ai_work_link_intent where id = $1", [stale.intent_id])).s).toBe("expired")
    // a done intent keeps its key, and a replay returns its stored outcome
    const done = await rec(l.token, "draft", "record_work_progress", P, "done-key")
    await db.exec(`update platform.ai_work_link_intent set status = 'done', submission_id = 'sub-9', result = '{"id":"r1","route":"/x"}' where id = '${done.intent_id}'`)
    expect(await rec(l.token, "draft", "record_work_progress", P, "done-key")).toMatchObject({ replayed: true, status: "done", submission_id: "sub-9", result: { id: "r1", route: "/x" } })
  })

  test("write caps: 30 intents in an hour and 200 in a day on one link", async () => {
    const l = await mint(A.tm, "proj-a")
    await db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, created_at)
      select 'cap-h-' || g, '${l.link_id}', 'org-a', 'proj-a', 'u-tm', 'record_work_progress', '{}', 'draft', 'cap-h-' || g, 'failed', now() + interval '1 day', now() - interval '10 minutes' from generate_series(1, 30) g`)
    expect(await recErr(l.token, "draft", "record_work_progress", P, "over-hour")).toMatchObject({ message: "WRITE_CAP_HOUR", code: "AW429" })
    const l2 = await mint(A.view, "proj-a", { level: 0, fns: ["get_construction_project_dashboard"] })
    const l3 = await mint(A.mem, "proj-a")
    await db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, created_at)
      select 'cap-d-' || g, '${l3.link_id}', 'org-a', 'proj-a', 'u-mem', 'record_work_progress', '{}', 'draft', 'cap-d-' || g, 'failed', now() + interval '1 day', now() - interval '5 hours' from generate_series(1, 200) g`)
    expect(await recErr(l3.token, "draft", "record_work_progress", P, "over-day")).toMatchObject({ message: "WRITE_CAP_DAY", code: "AW429" })
    expect(l2.link_id).toBeTruthy()
    // a replay is answered before the caps are looked at
    const ok = await mint(A.sen, "proj-a2")
    const first = await rec(ok.token, "draft", "record_work_progress", P, "k1")
    expect((await rec(ok.token, "draft", "record_work_progress", P, "k1")).intent_id).toBe(first.intent_id)
  })

  test("intent_status and history show only this link's own intents", async () => {
    const l = await mint(A.mgr, "proj-a")
    const other = await mint(A.sen, "proj-a2")
    const mine = await rec(l.token, "draft", "record_work_progress", P, "h1")
    const theirs = await rec(other.token, "draft", "record_work_progress", P, "h2")
    const s = (await one<{ r: J }>(db, "select public.ai_work_link_intent_status($1, $2) r", [l.token, mine.intent_id])).r
    expect(s).toMatchObject({ intent_id: mine.intent_id, kind: "draft", function_id: "record_work_progress", status: "awaiting_confirmation" })
    expect((await one<{ r: J | null }>(db, "select public.ai_work_link_intent_status($1, $2) r", [l.token, theirs.intent_id])).r).toBeNull()
    expect((await one<{ r: J | null }>(db, "select public.ai_work_link_intent_status($1, 'no-such') r", [l.token])).r).toBeNull()
    await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${mine.intent_id}'`)
    expect((await one<{ r: J }>(db, "select public.ai_work_link_intent_status($1, $2) r", [l.token, mine.intent_id])).r.status).toBe("expired")
    const h = (await one<{ r: J }>(db, "select public.ai_work_link_history($1, 50) r", [l.token])).r
    expect(h.items.every((i: J) => i.intent_id !== theirs.intent_id)).toBe(true)
    expect(h.items.map((i: J) => i.intent_id)).toContain(mine.intent_id)
    expect(Object.keys(h.items[0]).sort()).toEqual(["created_at", "failure", "function_id", "intent_id", "kind", "status", "submission_id"])
    expect((await one<{ r: J }>(db, "select public.ai_work_link_history($1, 1) r", [l.token])).r.items.length).toBe(1)
  })

  test("draft confirmation: nothing happens while writes are off", async () => {
    const l = await mint(A.mgr, "proj-a")
    const d = await rec(l.token, "draft", "record_work_progress", P, "c0")
    expect(await confirm(d.intent_id, d.confirm_token, "u-mgr")).toEqual({ status: "not_enabled" })
    expect((await one<{ s: string }>(db, "select status s from platform.ai_work_link_intent where id = $1", [d.intent_id])).s).toBe("awaiting_confirmation")
  })

  test("draft confirmation: the owner with the right token confirms once; another person, a wrong token, a second try and an expired draft are refused", async () => {
    const l = await mint(A.mgr, "proj-a")
    await setWrites(true)
    try {
      const d = await rec(l.token, "draft", "record_work_progress", P, "c1")
      expect(await confirm(d.intent_id, d.confirm_token, "u-mem")).toEqual({ status: "refused", reason: "not_owner" })
      expect(await confirm(d.intent_id, "0".repeat(64), "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
      expect(await confirm(d.intent_id, null, "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
      expect(await confirm("no-such-draft", d.confirm_token, "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
      const ok = await confirm(d.intent_id, d.confirm_token, "u-mgr")
      expect(ok).toEqual({
        status: "confirmed",
        intent: { id: d.intent_id, link_id: l.link_id, org_id: "org-a", project_id: "proj-a", user_id: "u-mgr", function_id: "record_work_progress", params: P },
      })
      const row = await one<J>(db, "select status, confirmed_by, confirmed_at is not null done from platform.ai_work_link_intent where id = $1", [d.intent_id])
      expect(row).toEqual({ status: "confirmed", confirmed_by: "u-mgr", done: true })
      // single use
      expect(await confirm(d.intent_id, d.confirm_token, "u-mgr")).toEqual({ status: "refused", reason: "not_pending" })
      // expired
      const late = await rec(l.token, "draft", "record_work_progress", P, "c2")
      await db.exec(`update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = '${late.intent_id}'`)
      expect(await confirm(late.intent_id, late.confirm_token, "u-mgr")).toEqual({ status: "refused", reason: "expired" })
      expect((await one<{ s: string }>(db, "select status s from platform.ai_work_link_intent where id = $1", [late.intent_id])).s).toBe("expired")
      // an action is not a draft and cannot be confirmed
      const action = await rec(l.token, "action", "record_attendance", { rosterId: "ro-1", date: "2026-09-05" }, "act-1")
      expect(await confirm(action.intent_id, "0".repeat(64), "u-mgr")).toEqual({ status: "refused", reason: "not_found" })
    } finally {
      await setWrites(false)
    }
  })

  test("two confirmations of one draft: exactly one wins (one UPDATE ... WHERE status = awaiting_confirmation)", async () => {
    const l = await mint(A.mgr, "proj-a")
    await setWrites(true)
    try {
      const d = await rec(l.token, "draft", "record_work_progress", P, "race")
      const [a, b] = await Promise.all([confirm(d.intent_id, d.confirm_token, "u-mgr"), confirm(d.intent_id, d.confirm_token, "u-mgr")])
      expect([a.status, b.status].sort()).toEqual(["confirmed", "refused"])
    } finally {
      await setWrites(false)
    }
  })
})
