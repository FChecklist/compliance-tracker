// P2.6 (W-ENV, R81-ADDENDUM-B phase S5) companion change. `db` from
// "@/lib/db" (index.ts) connects as the `app_runtime` Postgres role -- see
// that file and connection-string.ts. Once
// drizzle/0577_p2_6_task_capabilities_registry_write_lockdown.sql is
// applied, app_runtime loses write access to platform.task_capabilities'
// platform-wide (org_id IS NULL) rows on purpose (that migration's whole
// point). capability-audit-service.ts writes exactly those rows -- the
// table has no single owning org (see that file's own
// PLATFORM_AUDIT_QUERY_ORG_ID comment) -- so it needs a connection that is
// allowed to, i.e. service_role.
//
// Uses the Supabase JS client with the service role key (bypasses RLS by
// Supabase's own design, the standard mechanism for exactly this kind of
// server-only administrative write) rather than a second raw Postgres
// connection string, because SUPABASE_SERVICE_ROLE_KEY is already the
// credential this repo keeps for admin-style access (see e.g. the P2.2
// test-tenant-scoping checker in the sibling repo) and a raw Postgres
// `service_role` login is not how Supabase provisions that role (it has no
// direct-login password; PostgREST assumes it internally via `SET ROLE`,
// which a plain postgres.js connection cannot do without first
// authenticating as a role that's allowed to assume it).
//
// Deliberately lazy (same reasoning as db/index.ts's own lazy proxy): most
// requests never call into this file, and importing it must not require
// SUPABASE_SERVICE_ROLE_KEY to be set.
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// `any` generics deliberately: this repo has no generated Database type for
// the `platform` schema (schema.ts is drizzle, not the Supabase CLI's
// generated types), and this client only ever calls .from("task_capabilities")
// with a plain object patch -- not worth hand-rolling a Database type for
// one table and one call site.
let _client: SupabaseClient<any, any, any> | null = null

function getServiceRoleClient(): SupabaseClient<any, any, any> {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        "getServiceRoleClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set -- this client is only for server-only, admin-style writes (see this file's own header)."
      )
    }
    _client = createClient(url, key, { db: { schema: "platform" }, auth: { persistSession: false } }) as SupabaseClient<any, any, any>
  }
  return _client
}

/**
 * Updates platform.task_capabilities by id, via the service_role connection.
 * Only for writes to platform-wide (org_id IS NULL) rows -- an ordinary
 * org-scoped write should still go through the regular `db` export from
 * "@/lib/db", which keeps full access to its own org's rows under
 * drizzle/0577.
 *
 * Callers that need the post-write state (e.g. recordExecutionOutcome()
 * deriving `status` from freshly-incremented counters) read it themselves
 * via the normal (camelCase, drizzle-typed) app_runtime SELECT path before
 * calling this, rather than trust this function's own raw (snake_case)
 * return shape -- same reasoning as serviceRoleInsertTaskCapabilityIfAbsent
 * below. This is NOT transactional the way the original db.transaction()
 * was (a single service-role call, not a Postgres transaction spanning a
 * read and a write) -- accepted tradeoff: supabase-js's REST surface has no
 * multi-statement transaction, and a crash between the read and this write
 * leaves counters incremented with a stale `status` until the next
 * execution recomputes it, which is a self-healing inconsistency in a
 * bookkeeping counter, not a correctness bug in tenant data.
 */
export async function serviceRoleUpdateTaskCapability(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getServiceRoleClient().from("task_capabilities").update(patch).eq("id", id)
  if (error) throw new Error(`serviceRoleUpdateTaskCapability(${id}) failed: ${error.message}`)
}

/**
 * Insert-or-do-nothing on platform.task_capabilities by service_role, for
 * capability-learning-service.ts's findOrCreateCapability() -- the same
 * find-or-create shape as the original db.insert(...).onConflictDoNothing(),
 * just over the service-role connection since every real call site passes
 * orgId: null (verified: task-execution-engine.ts, team-service.ts,
 * dialogue-script-executor.ts, and the internal exploreUnknownPrompt() call
 * all pass orgId: null explicitly -- there is no live caller that inserts
 * an org-scoped row here today). Does not return the inserted row -- the
 * caller re-fetches through the normal (camelCase, drizzle-typed) read path
 * instead of trusting this function's own raw (snake_case) shape, which
 * also folds the "another caller won the race" case into the same
 * read-after-write rather than a separate branch.
 */
export async function serviceRoleInsertTaskCapabilityIfAbsent(values: Record<string, unknown>, conflictColumn: string): Promise<void> {
  const { error } = await getServiceRoleClient()
    .from("task_capabilities")
    .upsert(values, { onConflict: conflictColumn, ignoreDuplicates: true })
  if (error) throw new Error(`serviceRoleInsertTaskCapabilityIfAbsent failed: ${error.message}`)
}
