// CRR-027 / CRR-028 (platform.crr_spec) -- EXPAND step 3 (R-CRR-14
// expand-then-contract). The SECURITY DEFINER functions this file calls
// (compliance.lookup_user_by_email / compliance.lookup_api_key_by_hash) were
// created and EXECUTE-granted to app_runtime in migration
// crr027_028_expand_preauth_lookup_functions (2026-08-27, R58) -- purely
// additive, the pre-existing blanket app_runtime_preauth_read_users /
// app_runtime_preauth_read_api_keys RLS policies (qual=true) were left
// untouched by that migration and remain untouched by this file too.
//
// This module is the code-side half of the expand step: the two genuinely
// preauth call sites (requireAuth()'s email lookup in auth-guard.ts,
// validateApiKey()'s key-hash lookup in api-key-auth.ts) now go through the
// narrow function instead of an unrestricted `select *`. This does NOT by
// itself reduce what app_runtime can currently read -- the blanket policies
// are still there and still permissive, so today this is a no-op from a
// pure-privilege standpoint. What it does do: once every remaining direct
// `db.query.users.findFirst(...)` / `db.query.apiKeys.findFirst(...)` call
// site in this codebase (grep for those two patterns -- as of 2026-08-28
// there are 13 other files beyond auth-guard.ts/api-key-auth.ts, several
// keyed by `id` rather than `email`/`keyHash`, which these two functions do
// not cover) is either migrated to a narrow function of its own or proven to
// run inside a real tenant context (`withTenantContext`, where
// app_runtime_tenant_isolation already applies), dropping the blanket
// qual=true policies becomes safe. Until then, do NOT drop
// app_runtime_preauth_read_users / app_runtime_preauth_read_api_keys /
// app_runtime_preauth_update_users / app_runtime_preauth_update_api_keys_last_used
// -- every one of those other 13 call sites relies on them today (all read
// via the plain `db` client, which authenticates as app_runtime with no org
// context set -- see src/lib/db/index.ts / src/lib/db/tenant-scoped.ts's own
// comments -- so compliance.current_org_id() is null for every one of them
// and app_runtime_tenant_isolation's `org_id = current_org_id()` can never
// match; the blanket policy is the ONLY thing currently allowing them to
// read anything).
//
// Field mapping below is hand-written and verified against schema.ts's own
// `users`/`apiKeys` column lists (verified live 2026-08-28: `to_jsonb(direct
// row) = to_jsonb(function row)` for 5 real users across 4 orgs and 3 real
// api_keys, all `identical=true` -- see platform.crr_spec CRR-027/CRR-028
// evidence). The explicit `: UserRow` / `: ApiKeyRow` return-type annotations
// on the object literals below mean `bun run build`'s typecheck fails loudly
// if a field is ever missing or misnamed here -- this is exactly the
// "getting the field mapping subtly wrong" risk the prior session (R58)
// flagged as its reason for stopping before this step; this is that step,
// done and type-checked.
import { db, type users, type apiKeys, type reportShareLinks } from "@/lib/db"
import { sql } from "drizzle-orm"

type UserRow = typeof users.$inferSelect
type ApiKeyRow = typeof apiKeys.$inferSelect
type ReportShareLinkRow = typeof reportShareLinks.$inferSelect

// Timestamp fields are typed `string` here, NOT `Date` -- verified live
// 2026-08-28 that `db.execute(sql\`select * from
// compliance.lookup_user_by_email(...)\`)` (a SETOF-returning function call,
// unlike a plain table SELECT) comes back with timestamp columns as raw
// Postgres text (`"2026-07-07 09:04:20.580147+00"`), not pre-parsed JS Date
// objects the way postgres.js parses a normal `select * from
// compliance.users` result. Caught by scripts/tmp-verify-crr027-028.ts
// diffing the old vs new path for real rows -- exactly the "field mapping
// subtly wrong" risk the R58 evidence flagged, caught before merge instead
// of in production. mapUserRow/mapApiKeyRow below explicitly `new Date(...)`
// every timestamp field so the returned shape genuinely matches
// `typeof users.$inferSelect` / `typeof apiKeys.$inferSelect` (real Date
// objects), not just the type annotation lying about it.
type RawUserRow = {
  id: string
  name: string
  email: string
  password_hash: string
  role: UserRow["role"]
  avatar_url: string | null
  is_active: boolean
  last_login_at: string | null
  org_id: string | null
  department_id: string | null
  onboarding_completed: boolean
  onboarding_stage: string
  auth_user_id: string | null
  reporting_to_id: string | null
  account_stage: string | null
  passcode_hash: string | null
  passcode_set_at: string | null
  created_at: string
  updated_at: string
}

type RawApiKeyRow = {
  id: string
  name: string
  key_hash: string
  key_prefix: string
  org_id: string
  scopes: string
  is_active: boolean
  last_used_at: string | null
  domain_scope: string | null
  rate_limit_per_minute: number | null
  issued_for_application_id: string | null
  created_at: string
  updated_at: string
}

function toDate(v: string): Date
function toDate(v: string | null): Date | null
function toDate(v: string | null): Date | null {
  return v === null ? null : new Date(v)
}

function mapUserRow(row: RawUserRow): UserRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    avatarUrl: row.avatar_url,
    isActive: row.is_active,
    lastLoginAt: toDate(row.last_login_at),
    orgId: row.org_id,
    departmentId: row.department_id,
    onboardingCompleted: row.onboarding_completed,
    onboardingStage: row.onboarding_stage,
    authUserId: row.auth_user_id,
    reportingToId: row.reporting_to_id,
    accountStage: row.account_stage,
    passcodeHash: row.passcode_hash,
    passcodeSetAt: toDate(row.passcode_set_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  }
}

function mapApiKeyRow(row: RawApiKeyRow): ApiKeyRow {
  return {
    id: row.id,
    name: row.name,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    orgId: row.org_id,
    scopes: row.scopes,
    isActive: row.is_active,
    lastUsedAt: toDate(row.last_used_at),
    domainScope: row.domain_scope,
    rateLimitPerMinute: row.rate_limit_per_minute,
    issuedForApplicationId: row.issued_for_application_id,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  }
}

/**
 * Preauth user lookup by email, via the SECURITY DEFINER
 * compliance.lookup_user_by_email(text) function instead of an unrestricted
 * `select * from compliance.users where email = ...`. Same result shape and
 * semantics as the `db.query.users.findFirst({ where: eq(users.email, ...) })`
 * call it replaces (single row, or null if no match) -- see this file's
 * header comment for the RLS context.
 */
export async function lookupUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await db.execute(sql`select * from compliance.lookup_user_by_email(${email})`)
  const row = rows[0] as unknown as RawUserRow | undefined
  return row ? mapUserRow(row) : null
}

/**
 * Preauth API-key lookup by key_hash, via the SECURITY DEFINER
 * compliance.lookup_api_key_by_hash(text) function instead of an
 * unrestricted `select * from compliance.api_keys where key_hash = ...`.
 * Same result shape/semantics as the `db.query.apiKeys.findFirst({ where:
 * eq(apiKeys.keyHash, ...) })` call it replaces -- see this file's header
 * comment for the RLS context.
 */
export async function lookupApiKeyByHash(keyHash: string): Promise<ApiKeyRow | null> {
  const rows = await db.execute(sql`select * from compliance.lookup_api_key_by_hash(${keyHash})`)
  const row = rows[0] as unknown as RawApiKeyRow | undefined
  return row ? mapApiKeyRow(row) : null
}

// ─── CRR-027/028 CONTRACT phase: the 6 NEEDS_NEW_NARROW_FUNCTION sites ────
// (pm/CRR027_028_CONTRACT_AUDIT_2026-09-10.md §6). Each function below is a
// thin wrapper around one of the SECURITY DEFINER functions already applied
// live (crr027_028_expand_two_tables + p2_6_security_definer_registry_functions
// migrations, verified live via pg_proc this session: all `security_definer:
// true`, all EXECUTE-granted to app_runtime). Same discipline as
// lookupUserByEmail/lookupApiKeyByHash above: explicit Raw*Row type per
// function, explicit field-by-field mapping (never spread), timestamps
// re-Date()'d because a SETOF-returning function call comes back with raw
// Postgres text for timestamp columns, not pre-parsed Date objects the way a
// plain `select * from <table>` does through postgres.js.

type RawReportShareLinkRow = {
  id: string
  org_id: string
  report_type: string
  report_ref: string
  token: string
  created_by_id: string | null
  expires_at: string
  revoked_at: string | null
  created_at: string
}

function mapReportShareLinkRow(row: RawReportShareLinkRow): ReportShareLinkRow {
  return {
    id: row.id,
    orgId: row.org_id,
    reportType: row.report_type,
    reportRef: row.report_ref,
    token: row.token,
    createdById: row.created_by_id,
    expiresAt: toDate(row.expires_at),
    revokedAt: toDate(row.revoked_at),
    createdAt: toDate(row.created_at),
  }
}

/**
 * Existence check by id only, via SECURITY DEFINER compliance.user_exists(text).
 * Replaces `db.query.users.findFirst({ where: eq(users.id, ...) })` at
 * prompt-governance-service.ts:193, where the caller only ever does
 * `if (!owner) throw` -- no row data is read, so a plain boolean is the
 * narrowest correct surface (not a full-row fetch of data nothing touches).
 */
export async function userExists(id: string): Promise<boolean> {
  const rows = await db.execute(sql`select compliance.user_exists(${id}) as exists`)
  return Boolean((rows[0] as unknown as { exists: boolean } | undefined)?.exists)
}

/**
 * id+org-scoped lookup returning only (id, name), via SECURITY DEFINER
 * compliance.lookup_user_by_id_in_org(text, text). Replaces
 * `db.query.users.findFirst({ where: eq(users.id,...) and eq(users.orgId,...) })`
 * at support-session-service.ts:96, where the caller only ever reads
 * `.name` off the result (both call sites, l.110/l.129) -- narrowed to match,
 * per the audit doc's own §6 recommendation.
 */
export async function lookupUserByIdInOrg(id: string, orgId: string): Promise<{ id: string; name: string } | null> {
  const rows = await db.execute(sql`select * from compliance.lookup_user_by_id_in_org(${id}, ${orgId})`)
  const row = rows[0] as unknown as { id: string; name: string } | undefined
  return row ?? null
}

/**
 * Cross-org (by construction -- a cron has no per-request org context)
 * lookup of the oldest active admin for one org/role, via SECURITY DEFINER
 * compliance.lookup_oldest_active_admin_by_role(text, text). Replaces
 * `db.query.users.findFirst({ where: eq(users.orgId,...) and role='veridian_admin' and
 * isActive, orderBy: createdAt })` at
 * dispatch-completion-monitor/run/route.ts:66. The function itself does the
 * ordering/filtering server-side (SETOF, but this call site only ever wants
 * one row, same as the findFirst() it replaces); the caller needs the FULL
 * row (passed onward as `dbUser: typeof users.$inferSelect`), so this
 * returns the same mapped UserRow shape as lookupUserByEmail.
 */
export async function lookupOldestActiveAdminByRole(orgId: string, role: string): Promise<UserRow | null> {
  const rows = await db.execute(sql`select * from compliance.lookup_oldest_active_admin_by_role(${orgId}, ${role})`)
  const row = rows[0] as unknown as RawUserRow | undefined
  return row ? mapUserRow(row) : null
}

/**
 * Full-row lookup by id, deliberately cross-org, via SECURITY DEFINER
 * compliance.lookup_user_by_id(text). Replaces
 * `db.query.users.findFirst({ where: eq(users.id, ...) })` at
 * support-sessions/whoami-target/route.ts:31, whose result is passed
 * straight to `logActivity({ dbUser: initiator, ... })`, which requires
 * `typeof users.$inferSelect` -- the caller genuinely needs the full row,
 * not a narrowed projection, matching the audit doc's own §6 note. This is
 * the SAME named residual flagged in kt/handover/HANDOVER_W-ENV_2026-09-10T2230.json
 * (compliance.lookup_user_by_id returns SETOF compliance.users for ANY id,
 * cross-org, SECURITY DEFINER -- correct and necessary today because
 * logActivity's signature requires the full row; narrowing this further is
 * its own follow-up, not done here).
 */
export async function lookupUserById(id: string): Promise<UserRow | null> {
  const rows = await db.execute(sql`select * from compliance.lookup_user_by_id(${id})`)
  const row = rows[0] as unknown as RawUserRow | undefined
  return row ? mapUserRow(row) : null
}

/**
 * Pre-auth rate-limit count (no row data, just count(*)), via SECURITY
 * DEFINER compliance.count_recent_api_key_requests(text, timestamptz).
 * Replaces the raw `db.select({count:...}).from(apiKeyRequestLog).where(...)`
 * at api-key-auth.ts:166-168, keyed by the already-resolved apiKeyId (not
 * org) -- runs before any org context exists, the same pre-auth posture as
 * validateApiKey()'s key-hash lookup this file already covers.
 */
export async function countRecentApiKeyRequests(apiKeyId: string, since: Date): Promise<number> {
  const rows = await db.execute(sql`select compliance.count_recent_api_key_requests(${apiKeyId}, ${since.toISOString()}) as count`)
  const row = rows[0] as unknown as { count: string | number } | undefined
  return row ? Number(row.count) : 0
}

/**
 * Full-row lookup by token, via SECURITY DEFINER
 * compliance.lookup_report_share_link_by_token(text). Replaces
 * `db.query.reportShareLinks.findFirst({ where: eq(reportShareLinks.token, ...) })`
 * at report-share-service.ts:120. Deliberately does ONLY the exact-token-
 * equality lookup and returns the unfiltered full row -- usability
 * (isShareLinkUsable()) stays in application code, unchanged, per the
 * design rationale recorded in kt/handover/HANDOVER_W-ENV_2026-09-10T2230.json's
 * report_share_links_shape_divergence note (baking the usability check into
 * SQL would fork a rule shared by 7 other public token surfaces).
 */
export async function lookupReportShareLinkByToken(token: string): Promise<ReportShareLinkRow | null> {
  const rows = await db.execute(sql`select * from compliance.lookup_report_share_link_by_token(${token})`)
  const row = rows[0] as unknown as RawReportShareLinkRow | undefined
  return row ? mapReportShareLinkRow(row) : null
}
