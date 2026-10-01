// PROJEXA USER-WIDE AI WORK LINK (drizzle/0668 and 0669): the PGlite database the tests of the user link share. It is built the way the live one is,
// in this order: the roles and the base snapshot (awl-pglite.ts), migrations 0621 to 0628, the base tables of the record kinds, then 0644, 0629, 0630, 0643,
// 0631, the seeds 0650 to 0651 and finally 0668 and 0669 themselves. Nothing touches a live database.
//
// The people and projects (organisation A: five people and four projects; organisation B: one person and two projects):
//   u-mgr manager (rank 3, may see cost), u-sen senior (rank 3, may NOT see cost), u-mem member (2), u-view viewer (1), u-adm admin (5), u-off inactive,
//   u-b manager of organisation B.
//   proj-a "Villa A" public, lead u-mgr          proj-a2 "Villa A2" public, lead u-sen
//   proj-priv "Secret A" private, lead u-sen     proj-b "Tower B" public, lead u-b (organisation B)   proj-b-priv "Secret B" private, lead u-b
import type { PGlite } from "@electric-sql/pglite"
import type { Rpc } from "../../../../supabase/functions/ai-work-link/reads"
import { forwardSql, one } from "./awl-pglite"
import { createRecordsDb } from "./awl-records-v2-db"
import { rpcFor } from "./awl-write-fixture"

export type J = Record<string, any>

export const USER_LINK_MIGRATIONS = ["0668_awl_user_wide_link", "0669_awl_seed_user_link_create_project"] as const

const SEEDS_BEFORE = [
  "0629_build001_awl_execution_sql",
  "0630_build001_awl_submissions_via",
  "0631_build001_awl_mint_for",
  "0650_build002_awl_seed_coverage_waves_1_2",
  "0647_build002_awl_seed_waves_3_4",
  "0648_build002_awl_seed_waves_5_6",
  "0649_build002_awl_seed_waves_7_9",
  "0651_build002_awl_seed_submit_timesheet",
] as const

export const PEOPLE_SQL = `
insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
  ('u-mgr',  'Mira Manager', 'mira@a.example.test', 'x', 'manager',             true,  'org-a', '11111111-1111-4111-8111-111111111111'),
  ('u-sen',  'Sam Senior',   'sam@a.example.test',  'x', 'senior_professional', true,  'org-a', '55555555-5555-4555-8555-555555555555'),
  ('u-mem',  'Mo Member',    'mo@a.example.test',   'x', 'member',              true,  'org-a', '22222222-2222-4222-8222-222222222222'),
  ('u-view', 'Vic Viewer',   'vic@a.example.test',  'x', 'viewer',              true,  'org-a', '66666666-6666-4666-8666-666666666666'),
  ('u-adm',  'Ada Admin',    'ada@a.example.test',  'x', 'admin',               true,  'org-a', '33333333-3333-4333-8333-333333333333'),
  ('u-off',  'Off Member',   'off@a.example.test',  'x', 'member',              false, 'org-a', null),
  ('u-b',    'Bo Manager',   'bo@b.example.test',   'x', 'manager',             true,  'org-b', '44444444-4444-4444-8444-444444444444');
insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level, project_value, status, created_at) values
  ('proj-a',      'prod', 'org-a', 'Villa A',   'u-mgr', 'public',  2500000, 'active',   now() - interval '3 days'),
  ('proj-a2',     'prod', 'org-a', 'Villa A2',  'u-sen', 'public',  900000,  'planning', now() - interval '2 days'),
  ('proj-priv',   'prod', 'org-a', 'Secret A',  'u-sen', 'private', 777000,  'active',   now() - interval '1 day'),
  ('proj-b',      'prod', 'org-b', 'Tower B',   'u-b',   'public',  5000000, 'active',   now() - interval '4 days'),
  ('proj-b-priv', 'prod', 'org-b', 'Secret B',  'u-b',   'private', 1,       'active',   now() - interval '5 days');
insert into compliance.cost_visibility_config (id, org_id, role, can_see_cost, changed_by_id) values
  ('cv1', 'org-a', 'manager', true, 'u-mgr'), ('cv3', 'org-a', 'senior_professional', false, 'u-mgr');
`

/** A database with 0621 .. 0651 as the live one has them, then 0668 and 0669 (unless `withForward` is false), and the people above. */
export async function createUserLinkDb(withForward = true): Promise<PGlite> {
  const db = await createRecordsDb(true)
  for (const name of SEEDS_BEFORE) await db.exec(forwardSql(name))
  await db.exec(PEOPLE_SQL)
  if (withForward) for (const name of USER_LINK_MIGRATIONS) await db.exec(forwardSql(name))
  return db
}

export const setWrites = (db: PGlite, on: boolean) => db.exec(`update platform.ai_work_link_settings set writes_enabled = ${on}`)

/** The SQL of the Edge function's calls, with named arguments, as the service-role client makes them. */
export const rpc = (db: PGlite, seen: string[] = []): Rpc => rpcFor(db, seen)

/**
 * The person's links made so far are moved two days into the past first, so a test that needs many links of one person does not meet the mint caps (10 an
 * hour, 30 a day) that are not what it is about; the caps have their own test, which passes `{ age: false }`.
 */
async function aged(db: PGlite, userId: string, age: boolean): Promise<void> {
  if (age) await db.query("update platform.user_ai_links set created_at = created_at - interval '2 days' where user_id = $1 and created_at > now() - interval '1 day'", [userId])
}

export async function mintUser(db: PGlite, userId: string, o: { days?: number; label?: string | null; age?: boolean } = {}): Promise<J> {
  await aged(db, userId, o.age ?? true)
  return (await one<{ r: J }>(db, "select public.ai_work_link_mint_user_for($1, $2, $3) r", [userId, o.days ?? 7, o.label ?? null])).r
}

export async function mintProject(db: PGlite, userId: string, projectId: string, o: { level?: number; fns?: string[] | null; age?: boolean } = {}): Promise<J> {
  await aged(db, userId, o.age ?? true)
  return (await one<{ r: J }>(db, "select public.ai_work_link_mint_for($1, $2, $3, $4::text[], 7, true, null) r", [userId, projectId, o.level ?? 0, o.fns ?? null])).r
}

/** The coded error of a call that must fail: {code, message}, or null when it did not fail. */
export async function refused(db: PGlite, sql: string, params: unknown[] = []): Promise<{ code: string; message: string } | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    const err = e as { message?: string; code?: string }
    return { code: String(err.code ?? ""), message: String(err.message ?? e) }
  }
}

export async function call<T = J>(db: PGlite, fn: string, args: unknown[]): Promise<T> {
  const marks = args.map((_, i) => `$${i + 1}`).join(", ")
  const r = await one<{ r: T }>(db, `select public.${fn}(${marks}) r`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)))
  return r.r
}
