// PROJEXA-BUILD-002 WP-09a: the small database the write-path tests of the Universal AI Work Link share (drafts, effective level, caps and replay,
// the confirm route, the claim/finish state machine). It is the PGlite database of awl-pglite.ts with migrations 0621 to 0630 applied plus a
// few people and two projects, and the same call the Edge function's service-role client makes for a database function (`rpcFor`).
//
// The people: a manager (rank 3), a member (rank 2), a viewer (rank 1), an admin of organisation A, an inactive member, and a manager of
// organisation B. Projects: "proj-a" and "proj-a2" (organisation A, public) and "proj-b" (organisation B).
import type { PGlite } from "@electric-sql/pglite"
import type { Rpc } from "../../../../supabase/functions/ai-work-link/reads"
import { createAwlDb, one } from "./awl-pglite"

export type J = Record<string, any>

export const AUTH = {
  mgr: "11111111-1111-4111-8111-111111111111",
  mem: "22222222-2222-4222-8222-222222222222",
  adm: "33333333-3333-4333-8333-333333333333",
  b: "44444444-4444-4444-8444-444444444444",
  view: "66666666-6666-4666-8666-666666666666",
} as const

export const FIXTURE_SQL = `
insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
  ('u-mgr',  'Mira Manager', 'mira@a.example.test', 'x', 'manager', true,  'org-a', '${AUTH.mgr}'),
  ('u-mem',  'Mo Member',    'mo@a.example.test',   'x', 'member',  true,  'org-a', '${AUTH.mem}'),
  ('u-view', 'Vic Viewer',   'vic@a.example.test',  'x', 'viewer',  true,  'org-a', '${AUTH.view}'),
  ('u-adm',  'Ada Admin',    'ada@a.example.test',  'x', 'admin',   true,  'org-a', '${AUTH.adm}'),
  ('u-off',  'Off Member',   'off@a.example.test',  'x', 'member',  false, 'org-a', null),
  ('u-b',    'Bo Manager',   'bo@b.example.test',   'x', 'manager', true,  'org-b', '${AUTH.b}');
insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level) values
  ('proj-a',  'prod', 'org-a', 'Villa A',  'u-mgr', 'public'),
  ('proj-a2', 'prod', 'org-a', 'Villa A2', 'u-mgr', 'public'),
  ('proj-b',  'prod', 'org-b', 'Tower B',  'u-b',   'public');
`

/** A database with migrations 0621 to 0630 and the fixture above. */
export async function openWriteDb(): Promise<PGlite> {
  const db = await createAwlDb()
  await db.exec(FIXTURE_SQL)
  return db
}

export const setWrites = (db: PGlite, on: boolean) => db.exec(`update platform.ai_work_link_settings set writes_enabled = ${on}`)

/** A link for the person on the project (the SQL minting function of migration 0624): its token is returned once. */
export async function mintLink(db: PGlite, userId: string, projectId: string, o: { level?: number; fns?: string[] | null } = {}): Promise<J> {
  return (await one<{ r: J }>(db, "select public.ai_work_link_create_for($1, $2, $3, $4::text[], $5, $6, $7) r", [userId, projectId, o.level ?? 1, o.fns ?? null, 7, true, null])).r
}

/** ai_work_link_record_intent as the Edge function calls it. */
export async function recordIntent(db: PGlite, token: string, kind: "draft" | "action", fn: string, params: unknown, key: string | null = null): Promise<J> {
  return (await one<{ r: J }>(db, "select public.ai_work_link_record_intent($1, $2, $3, $4::jsonb, $5) r", [token, kind, fn, JSON.stringify(params), key])).r
}

export const intentRow = (db: PGlite, id: string) => one<J>(db, "select * from platform.ai_work_link_intent where id = $1", [id])
export const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await one<{ n: number }>(db, `select count(*)::int n from ${sql}`, params)).n

/** The same call the service-role client makes: a public function with named arguments. Counts what it was asked for in `seen`. */
export function rpcFor(db: PGlite, seen: string[] = []): Rpc {
  return async (fn, args = {}) => {
    seen.push(fn)
    const names = Object.keys(args)
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}${typeof args[n] === "object" && args[n] !== null ? "::jsonb" : ""}`).join(", ")})`
    try {
      if (fn === "projexa_read_resolve_user") {
        const r = await db.query(`select * from ${call}`, names.map((n) => args[n]))
        return { data: r.rows, error: null }
      }
      const r = await db.query<{ r: unknown }>(`select ${call} as r`, names.map((n) => (typeof args[n] === "object" && args[n] !== null ? JSON.stringify(args[n]) : args[n])))
      return { data: r.rows[0]?.r ?? null, error: null }
    } catch (e) {
      const err = e as { message?: string; code?: string }
      return { data: null, error: { message: String(err.message ?? e), code: err.code } }
    }
  }
}
