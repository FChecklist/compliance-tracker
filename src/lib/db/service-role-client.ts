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

// ---------------------------------------------------------------------------
// platform.capability_improvement_proposals (C-14, external review
// 2026-09-10 / finding F-2026-0910-006): this table has NO org_id column at
// all -- every row is unconditionally platform-wide, by schema, not by
// convention. It already had ONLY a service_role_bypass policy and no
// app_runtime policy of any kind (not even SELECT), so capability-audit-
// service.ts's reads AND writes against it were already failing before
// P2.6 touched anything -- see drizzle/0578_p2_6_capability_improvement_proposals_registry.sql,
// which adds an app_runtime SELECT-only policy (listImprovementProposals()
// is a read surface for a human review UI) and leaves writes service-role-only,
// same shape as task_capabilities. Reads in capability-audit-service.ts
// switch to the service-role client rather than wait for that migration to
// be applied (it is authored+proven but left unapplied, same as 0577) --
// once it lands, app_runtime SELECT would also work, but there is no reason
// to have two working read paths for one table.
// ---------------------------------------------------------------------------

export async function serviceRoleUpsertImprovementProposal(
  values: Record<string, unknown>,
  conflictColumns: string[]
): Promise<void> {
  const { error } = await getServiceRoleClient()
    .from("capability_improvement_proposals")
    .upsert(values, { onConflict: conflictColumns.join(",") })
  if (error) throw new Error(`serviceRoleUpsertImprovementProposal failed: ${error.message}`)
}

export async function serviceRoleUpdateImprovementProposal(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getServiceRoleClient().from("capability_improvement_proposals").update(patch).eq("id", id)
  if (error) throw new Error(`serviceRoleUpdateImprovementProposal(${id}) failed: ${error.message}`)
}

export async function serviceRoleFindImprovementProposalById(id: string): Promise<Record<string, unknown> | undefined> {
  const { data, error } = await getServiceRoleClient().from("capability_improvement_proposals").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(`serviceRoleFindImprovementProposalById(${id}) failed: ${error.message}`)
  return data ?? undefined
}

export async function serviceRoleFindImprovementProposalByCapabilityVersion(
  capabilityId: string,
  capabilityVersion: number
): Promise<Record<string, unknown> | undefined> {
  const { data, error } = await getServiceRoleClient()
    .from("capability_improvement_proposals")
    .select("*")
    .eq("capability_id", capabilityId)
    .eq("capability_version", capabilityVersion)
    .maybeSingle()
  if (error) throw new Error(`serviceRoleFindImprovementProposalByCapabilityVersion(${capabilityId}, ${capabilityVersion}) failed: ${error.message}`)
  return data ?? undefined
}

export async function serviceRoleListImprovementProposals(status?: string): Promise<Record<string, unknown>[]> {
  let query = getServiceRoleClient().from("capability_improvement_proposals").select("*").order("updated_at", { ascending: false })
  if (status) query = query.eq("status", status)
  const { data, error } = await query
  if (error) throw new Error(`serviceRoleListImprovementProposals failed: ${error.message}`)
  return data ?? []
}
