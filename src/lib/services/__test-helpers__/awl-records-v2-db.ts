// PROJEXA-BUILD-002 WP-06: what the two record-kind test files share (ai-work-link-records-v2.test.ts and
// ai-work-link-records-documents.test.ts): the PGlite database of the Universal AI Work Link with drizzle/0643 applied, small helpers
// to write fixture rows, and the rpc that lets the real Edge handler run over the real SQL functions.
//
// The database is built in this order: the roles and the base snapshot of the tables the link reads (awl-pglite.ts), migrations 0621 to
// 0628, the base snapshot of the tables 0643 adds kinds for (scripts/verify/fixtures/0643_build002_record_kinds.base.sql, read from the
// live catalog, schema only), then 0643 itself. Nothing touches a live database.
import type { PGlite } from "@electric-sql/pglite"
import type { Rpc } from "../../../../supabase/functions/ai-work-link/handler"
import { createAwlDb, forwardSql, one, read } from "./awl-pglite"

export const RECORDS_MIGRATION = "0643_build002_record_kinds"
export const EXTRA_BASE_SQL = () => read("scripts/verify/fixtures/0643_build002_record_kinds.base.sql")

/** A database with migrations 0621 to 0628 and 0644, the extra base tables, and (unless `withForward` is false) 0643. */
export async function createRecordsDb(withForward = true): Promise<PGlite> {
  const db = await createAwlDb("0628")
  await db.exec(EXTRA_BASE_SQL())
  // the live order: 0644 (the whole registry, from the coverage work) is applied before 0643
  await db.exec(forwardSql("0644_build002_awl_seed_project_boq"))
  if (withForward) await db.exec(forwardSql(RECORDS_MIGRATION))
  return db
}

export type Val = string | number | boolean | null
const lit = (v: Val | undefined) => (v === undefined ? "default" : v === null ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${v.replace(/'/g, "''")}'`)

/** One insert into a table of schema compliance; a column that a row leaves out takes its default (rows may name different columns). */
export function insert(table: string, rows: Array<Record<string, Val>>): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return `insert into compliance.${table} (${cols.join(", ")}) values ${rows.map((r) => `(${cols.map((c) => lit(r[c])).join(", ")})`).join(", ")};`
}

// The scopes of a decoy: another project of the same organisation, another organisation with its own project, and a row of another
// organisation that names the link's project (its own org_id disagrees with the project's).
export const S = (over: Record<string, Val> = {}) => ({ org_id: "org-a", project_id: "proj-a", ...over })
export const A2 = (over: Record<string, Val> = {}) => ({ org_id: "org-a", project_id: "proj-a2", ...over })
export const B = (over: Record<string, Val> = {}) => ({ org_id: "org-b", project_id: "proj-b", ...over })
export const BW = (over: Record<string, Val> = {}) => ({ org_id: "org-b", project_id: "proj-a", ...over })

/** Five people, three projects and the cost-visibility rows every test of the two files starts from. */
export const BASE_PEOPLE_SQL = [
  `insert into compliance.users (id, name, email, password_hash, role, is_active, org_id) values
    ('u-mgr', 'Mira Manager', 'mira@a.example.test', 'x', 'manager', true, 'org-a'),
    ('u-sen', 'Sam Senior', 'sam@a.example.test', 'x', 'senior_professional', true, 'org-a'),
    ('u-mem', 'Mo Member', 'mo@a.example.test', 'x', 'member', true, 'org-a'),
    ('u-tm', 'Tia Team', 'tia@a.example.test', 'x', 'team_member', true, 'org-a'),
    ('u-b', 'Bo Manager', 'bo@b.example.test', 'x', 'manager', true, 'org-b');`,
  `insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level) values
    ('proj-a', 'prod', 'org-a', 'Villa A', 'u-mgr', 'public'), ('proj-a2', 'prod', 'org-a', 'Villa A2', 'u-sen', 'public'),
    ('proj-b', 'prod', 'org-b', 'Tower B', 'u-b', 'public');`,
  `insert into compliance.cost_visibility_config (id, org_id, role, can_see_cost, changed_by_id) values
    ('cv1', 'org-a', 'manager', true, 'u-mgr'), ('cv3', 'org-a', 'senior_professional', false, 'u-mgr');`,
].join("\n")

/** Mints a level-1 link of `userId` on `projectId` and returns the token. */
export async function mintLink(db: PGlite, userId: string, projectId: string): Promise<string> {
  const r = await one<{ r: { token: string } }>(db, "select public.ai_work_link_create_for($1, $2, 1, null, 7, true, null) r", [userId, projectId])
  return r.r.token
}

/** An rpc that calls the PGlite database, so the real Edge handler runs over the real SQL functions. */
export function pgRpc(pg: PGlite): Rpc {
  return async (name, args = {}) => {
    const keys = Object.keys(args)
    const values = keys.map((k) => (k === "p_filters" ? JSON.stringify(args[k] ?? {}) : (args[k] as never)))
    try {
      const r = await pg.query<{ r: unknown }>(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values)
      return { data: r.rows[0]?.r ?? null, error: null }
    } catch (e) {
      const err = e as { message?: string; code?: string }
      return { data: null, error: { message: String(err.message ?? e), code: err.code } }
    }
  }
}
