// PROJEXA "automatic error and action log" (owner request 2026-10-20) -- the storage side.
//
// In plain words: the person's own phone or laptop notices an error or a step they took, packs the last few steps
// around it into a small report, and posts a batch of reports here. This file only CHECKS, CLEANS and STORES them
// (two inserts per batch, no processing, no AI, no outbound calls), so it adds almost nothing to our server's load.
// Later the owner asks Claude Code (run by the owner, not part of the app) to read the open issues, fix the code,
// and write the fix back on the issue (summary, files, commit) -- which is what PATCH does. If a "fixed" issue
// happens again AFTER the fix time, it flips to "reopened" automatically so a regression cannot hide.
//
// Tables: drizzle/0754_client_log_events.sql (compliance.client_log_events, compliance.client_error_issues).
// Raw SQL on purpose (no schema.ts entry): both tables are append/upsert-only and read back as plain rows; see
// docs/client-log.md.
//
// Everything that takes a database handle takes an EXISTING TenantDb (the *WithDb convention) so the route opens
// exactly one withTenantContext and nothing here can nest a second one.
import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { scrubText, scrubValue } from "@/lib/client-log-scrub"
export { scrubText, scrubValue, REDACTED } from "@/lib/client-log-scrub"

// ---------------------------------------------------------------- limits
export const MAX_EVENTS_PER_REQUEST = 50
export const MAX_EVENTS_PER_MINUTE = 120
export const MAX_MESSAGE = 2000
export const MAX_STACK = 8000
export const MAX_BREADCRUMBS = 40
export const MAX_CONTEXT_BYTES = 4096
const MAX_BREADCRUMBS_BYTES = 16384
const MAX_ROUTES_PER_ISSUE = 20
const MAX_PROJECTS_PER_ISSUE = 50

export const EVENT_KINDS = ["error", "unhandled_rejection", "render_error", "api_failure", "action"] as const
export type ClientLogKind = (typeof EVENT_KINDS)[number]
export const SEVERITIES = ["error", "warning", "info"] as const
export const ISSUE_STATUSES = ["open", "fixed", "reopened", "ignored"] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

// ---------------------------------------------------------------- validation
export type CleanEvent = {
  id: string
  userId: string | null
  projectId: string | null
  sessionId: string | null
  kind: ClientLogKind
  severity: "error" | "warning" | "info"
  fingerprint: string | null
  message: string | null
  stack: string | null
  route: string | null
  apiPath: string | null
  httpMethod: string | null
  httpStatus: number | null
  requestId: string | null
  durationMs: number | null
  actionName: string | null
  outcome: "ok" | "failed" | null
  breadcrumbs: unknown[] | null
  context: Record<string, unknown> | null
  occurredAt: string
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null
  const t = scrubText(v).trim()
  return t ? t.slice(0, max) : null
}
const int = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  const n = Math.round(v)
  return n >= min && n <= max ? n : null
}

/** Keep the LAST items (the steps just before the failure) that fit the byte budget. */
function capBreadcrumbs(v: unknown): unknown[] | null {
  if (!Array.isArray(v)) return null
  const items = v.slice(-MAX_BREADCRUMBS).map((b) => scrubValue(b))
  while (items.length > 0 && JSON.stringify(items).length > MAX_BREADCRUMBS_BYTES) items.shift()
  return items
}
function capContext(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const scrubbed = scrubValue(v) as Record<string, unknown>
  if (JSON.stringify(scrubbed).length <= MAX_CONTEXT_BYTES) return scrubbed
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(scrubbed)) {
    const next = { ...out, [k]: val }
    if (JSON.stringify(next).length > MAX_CONTEXT_BYTES - 20) continue
    out[k] = val
  }
  out._truncated = true
  return out
}

export function serverFingerprint(e: Pick<CleanEvent, "kind" | "message" | "route" | "apiPath" | "httpStatus">): string {
  const firstLine = (e.message ?? "").split("\n")[0].replace(/\d+/g, "#").slice(0, 200)
  const h = createHash("sha1").update([e.kind, firstLine, e.route ?? "", e.apiPath ?? "", e.httpStatus ?? ""].join("|")).digest("hex")
  return `srv:${h.slice(0, 16)}`
}

export function validateEvent(raw: unknown, now: Date = new Date()): { ok: true; event: CleanEvent } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "event must be an object" }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== "string" || r.id.length < 8 || r.id.length > 100) return { ok: false, reason: "id must be a string of 8-100 characters (a uuid)" }
  if (typeof r.kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(r.kind)) return { ok: false, reason: `kind must be one of ${EVENT_KINDS.join(", ")}` }
  const kind = r.kind as ClientLogKind
  const occ = typeof r.occurred_at === "string" || typeof r.occurred_at === "number" ? new Date(r.occurred_at) : null
  if (!occ || Number.isNaN(occ.getTime())) return { ok: false, reason: "occurred_at must be a valid timestamp" }
  // A device clock a day ahead (or years behind) is a broken clock; store with the server's time rather than lose the report.
  const skewed = occ.getTime() > now.getTime() + 86_400_000 || occ.getTime() < now.getTime() - 400 * 86_400_000
  const occurredAt = (skewed ? now : occ).toISOString()

  const sev = typeof r.severity === "string" && (SEVERITIES as readonly string[]).includes(r.severity) ? (r.severity as CleanEvent["severity"]) : kind === "action" ? "info" : "error"
  const outcome = r.outcome === "ok" || r.outcome === "failed" ? r.outcome : null

  const event: CleanEvent = {
    id: r.id,
    userId: null, // filled from the authenticated caller by the route, never trusted from the body
    projectId: str(r.project_id, 100),
    sessionId: str(r.session_id, 100),
    kind,
    severity: sev,
    fingerprint: str(r.fingerprint, 128),
    message: str(r.message, MAX_MESSAGE),
    stack: str(r.stack, MAX_STACK),
    route: str(r.route, 500),
    apiPath: str(r.api_path, 500),
    httpMethod: str(r.http_method, 12),
    httpStatus: int(r.http_status, 100, 599),
    requestId: str(r.request_id, 100),
    durationMs: int(r.duration_ms, 0, 3_600_000),
    actionName: str(r.action_name, 200),
    outcome,
    breadcrumbs: capBreadcrumbs(r.breadcrumbs),
    context: capContext(r.context),
    occurredAt,
  }
  if (kind !== "action" && !event.fingerprint) event.fingerprint = serverFingerprint(event)
  return { ok: true, event }
}

// ---------------------------------------------------------------- rate limit (per instance, in memory: no database load)
const hits = new Map<string, number[]>()
/** How many of `wanted` events this caller may still send in the current minute; records what it grants. */
export function takeRateAllowance(key: string, wanted: number, now = Date.now()): number {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000)
  const room = Math.max(0, MAX_EVENTS_PER_MINUTE - recent.length)
  const granted = Math.min(room, wanted)
  for (let i = 0; i < granted; i++) recent.push(now)
  if (recent.length > 0) hits.set(key, recent)
  else hits.delete(key)
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= 60_000)) hits.delete(k)
  return granted
}
export function resetRateLimitForTests() {
  hits.clear()
}

// ---------------------------------------------------------------- ingest
const rowsOf = <T = Record<string, unknown>>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : (((r as { rows?: T[] })?.rows ?? []) as T[]))

const SEV_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 }

export type IssueGroup = {
  id: string
  fingerprint: string
  title: string
  first_seen_at: string
  last_seen_at: string
  occurrences: number
  severity: string
  sample_event_id: string
  project_ids: string[]
  routes: string[]
}

/** Fold newly stored (non-action) events into one record per fingerprint. */
export function groupIssues(events: CleanEvent[], newId: () => string): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const e of events) {
    if (e.kind === "action" || !e.fingerprint) continue
    const g = groups.get(e.fingerprint)
    const title = ((e.message ?? "").split("\n")[0] || `${e.kind}${e.apiPath ? ` ${e.apiPath}` : ""}`).slice(0, 200)
    if (!g) {
      groups.set(e.fingerprint, {
        id: newId(),
        fingerprint: e.fingerprint,
        title,
        first_seen_at: e.occurredAt,
        last_seen_at: e.occurredAt,
        occurrences: 1,
        severity: e.severity,
        sample_event_id: e.id,
        project_ids: e.projectId ? [e.projectId] : [],
        routes: e.route ? [e.route] : [],
      })
      continue
    }
    g.occurrences += 1
    if (e.occurredAt < g.first_seen_at) g.first_seen_at = e.occurredAt
    if (e.occurredAt >= g.last_seen_at) {
      g.last_seen_at = e.occurredAt
      g.sample_event_id = e.id
    }
    if ((SEV_RANK[e.severity] ?? 0) > (SEV_RANK[g.severity] ?? 0)) g.severity = e.severity
    if (e.projectId && !g.project_ids.includes(e.projectId)) g.project_ids.push(e.projectId)
    if (e.route && !g.routes.includes(e.route)) g.routes.push(e.route)
  }
  return [...groups.values()]
}

export async function ingestClientLogEventsWithDb(
  db: TenantDb,
  ctx: { orgId: string; userId: string | null },
  events: CleanEvent[],
  newId: () => string = () => crypto.randomUUID()
): Promise<{ stored: number; duplicates: number }> {
  if (events.length === 0) return { stored: 0, duplicates: 0 }
  const unique = [...new Map(events.map((e) => [e.id, e])).values()]
  const payload = unique.map((e) => ({
    id: e.id, user_id: ctx.userId, project_id: e.projectId, session_id: e.sessionId, kind: e.kind, severity: e.severity,
    fingerprint: e.fingerprint, message: e.message, stack: e.stack, route: e.route, api_path: e.apiPath, http_method: e.httpMethod,
    http_status: e.httpStatus, request_id: e.requestId, duration_ms: e.durationMs, action_name: e.actionName, outcome: e.outcome,
    breadcrumbs: e.breadcrumbs, context: e.context, occurred_at: e.occurredAt,
  }))
  const inserted = rowsOf<{ id: string }>(
    await db.execute(sql`
      INSERT INTO compliance.client_log_events
        (id, org_id, user_id, project_id, session_id, kind, severity, fingerprint, message, stack, route, api_path, http_method,
         http_status, request_id, duration_ms, action_name, outcome, breadcrumbs, context, occurred_at)
      SELECT e.id, ${ctx.orgId}, e.user_id, e.project_id, e.session_id, e.kind, e.severity, e.fingerprint, e.message, e.stack, e.route,
             e.api_path, e.http_method, e.http_status, e.request_id, e.duration_ms, e.action_name, e.outcome, e.breadcrumbs, e.context, e.occurred_at
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS e(
        id text, user_id text, project_id text, session_id text, kind text, severity text, fingerprint text, message text, stack text,
        route text, api_path text, http_method text, http_status int, request_id text, duration_ms int, action_name text, outcome text,
        breadcrumbs jsonb, context jsonb, occurred_at timestamptz)
      ON CONFLICT (id) DO NOTHING
      RETURNING id`)
  )
  const newIds = new Set(inserted.map((r) => r.id))

  // Only events stored NOW count toward an issue: a re-sent batch (same ids) must not inflate occurrences.
  const groups = groupIssues(unique.filter((e) => newIds.has(e.id)), newId)
  if (groups.length > 0) {
    await db.execute(sql`
      INSERT INTO compliance.client_error_issues AS i
        (id, org_id, fingerprint, title, first_seen_at, last_seen_at, occurrences, status, severity, sample_event_id, project_ids, routes)
      SELECT g.id, ${ctx.orgId}, g.fingerprint, g.title, g.first_seen_at, g.last_seen_at, g.occurrences, 'open', g.severity, g.sample_event_id,
             ARRAY(SELECT jsonb_array_elements_text(g.project_ids)), ARRAY(SELECT jsonb_array_elements_text(g.routes))
      FROM jsonb_to_recordset(${JSON.stringify(groups)}::jsonb) AS g(
        id text, fingerprint text, title text, first_seen_at timestamptz, last_seen_at timestamptz, occurrences int, severity text,
        sample_event_id text, project_ids jsonb, routes jsonb)
      ON CONFLICT (org_id, fingerprint) DO UPDATE SET
        occurrences = i.occurrences + EXCLUDED.occurrences,
        first_seen_at = LEAST(i.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(i.last_seen_at, EXCLUDED.last_seen_at),
        sample_event_id = CASE WHEN EXCLUDED.last_seen_at >= i.last_seen_at THEN EXCLUDED.sample_event_id ELSE i.sample_event_id END,
        severity = CASE WHEN i.severity = 'error' OR EXCLUDED.severity = 'error' THEN 'error'
                        WHEN i.severity = 'warning' OR EXCLUDED.severity = 'warning' THEN 'warning' ELSE i.severity END,
        project_ids = ARRAY(SELECT DISTINCT x FROM unnest(i.project_ids || EXCLUDED.project_ids) AS x ORDER BY x LIMIT ${MAX_PROJECTS_PER_ISSUE}),
        routes = ARRAY(SELECT DISTINCT x FROM unnest(i.routes || EXCLUDED.routes) AS x ORDER BY x LIMIT ${MAX_ROUTES_PER_ISSUE}),
        -- THE REGRESSION RULE: a fixed issue whose new event happened AFTER the fix time is reopened.
        -- (An event that merely ARRIVES late from an offline device but happened before the fix does not reopen it.)
        status = CASE WHEN i.status = 'fixed' AND i.fixed_at < EXCLUDED.last_seen_at THEN 'reopened' ELSE i.status END,
        reopened_count = i.reopened_count + CASE WHEN i.status = 'fixed' AND i.fixed_at < EXCLUDED.last_seen_at THEN 1 ELSE 0 END`)
  }
  return { stored: newIds.size, duplicates: unique.length - newIds.size }
}

// ---------------------------------------------------------------- owner reads
export async function listIssuesWithDb(
  db: TenantDb,
  orgId: string,
  opts: { status: string; projectId?: string | null; limit: number }
): Promise<Record<string, unknown>[]> {
  const statusFilter = opts.status === "all" ? sql`TRUE` : sql`i.status = ${opts.status}`
  const projectFilter = opts.projectId ? sql`${opts.projectId} = ANY(i.project_ids)` : sql`TRUE`
  const issues = rowsOf(
    await db.execute(sql`
      SELECT i.*, to_jsonb(e) AS sample_event
      FROM compliance.client_error_issues i
      LEFT JOIN compliance.client_log_events e ON e.id = i.sample_event_id AND e.org_id = i.org_id
      WHERE i.org_id = ${orgId} AND ${statusFilter} AND ${projectFilter}
      ORDER BY i.last_seen_at DESC
      LIMIT ${opts.limit}`)
  )
  if (issues.length === 0) return issues
  // people + last_event_at for the whole page in ONE grouped query (never one query per issue).
  const fingerprints = issues.map((r) => r.fingerprint as string)
  const stats = rowsOf<{ fingerprint: string; people: number; last_event_at: unknown }>(
    await db.execute(sql`
      SELECT fingerprint, count(DISTINCT user_id)::int AS people, max(occurred_at) AS last_event_at
      FROM compliance.client_log_events
      WHERE org_id = ${orgId} AND fingerprint IN (${sql.join(fingerprints.map((f) => sql`${f}`), sql`, `)})
      GROUP BY fingerprint`)
  )
  const byFingerprint = new Map(stats.map((s) => [s.fingerprint, s]))
  return issues.map((r) => {
    const s = byFingerprint.get(r.fingerprint as string)
    return { ...r, people: s ? Number(s.people) : 0, last_event_at: s ? s.last_event_at : null }
  })
}
export type IssueDetail = { issue: Record<string, unknown>; events: Record<string, unknown>[] }

export async function getIssueWithDb(db: TenantDb, orgId: string, id: string): Promise<IssueDetail | null> {
  const issue = rowsOf(await db.execute(sql`SELECT * FROM compliance.client_error_issues WHERE org_id = ${orgId} AND id = ${id}`))[0]
  if (!issue) return null
  const events = rowsOf(
    await db.execute(sql`
      SELECT * FROM compliance.client_log_events
      WHERE org_id = ${orgId} AND fingerprint = ${issue.fingerprint as string}
      ORDER BY occurred_at DESC LIMIT 20`)
  )
  return { issue, events }
}

export async function timelineWithDb(
  db: TenantDb,
  orgId: string,
  opts: { projectId: string; limit: number; order: "asc" | "desc"; after?: string | null }
): Promise<Record<string, unknown>[]> {
  const afterFilter = opts.after ? (opts.order === "asc" ? sql`AND occurred_at > ${opts.after}::timestamptz` : sql`AND occurred_at < ${opts.after}::timestamptz`) : sql``
  const dir = opts.order === "asc" ? sql`ASC` : sql`DESC`
  return rowsOf(
    await db.execute(sql`
      SELECT id, user_id, project_id, session_id, kind, severity, fingerprint, message, route, api_path, http_method, http_status,
             request_id, duration_ms, action_name, outcome, occurred_at, received_at
      FROM compliance.client_log_events
      WHERE org_id = ${orgId} AND project_id = ${opts.projectId} ${afterFilter}
      ORDER BY occurred_at ${dir}, id
      LIMIT ${opts.limit}`)
  )
}

// ---------------------------------------------------------------- write the fix back
export type FixFile = { path: string; change: string }
export type IssuePatch = {
  status?: IssueStatus
  fix_summary?: string
  fix_files?: FixFile[]
  fix_commit?: string
  fixed_by?: string
}

export function validatePatch(body: unknown): { ok: true; patch: IssuePatch } | { ok: false; field: string; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "body", error: "body must be a JSON object" }
  const b = body as Record<string, unknown>
  const patch: IssuePatch = {}
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !(ISSUE_STATUSES as readonly string[]).includes(b.status)) return { ok: false, field: "status", error: `status must be one of ${ISSUE_STATUSES.join(", ")}` }
    patch.status = b.status as IssueStatus
  }
  if (b.fix_summary !== undefined) {
    if (typeof b.fix_summary !== "string" || !b.fix_summary.trim()) return { ok: false, field: "fix_summary", error: "fix_summary must be a non-empty string" }
    patch.fix_summary = b.fix_summary.trim().slice(0, 4000)
  }
  if (b.fix_files !== undefined) {
    if (!Array.isArray(b.fix_files) || b.fix_files.length > 50) return { ok: false, field: "fix_files", error: "fix_files must be an array of up to 50 {path, change}" }
    const files: FixFile[] = []
    for (const f of b.fix_files) {
      const o = f as Record<string, unknown> | null
      if (!o || typeof o.path !== "string" || !o.path.trim() || typeof o.change !== "string" || !o.change.trim()) {
        return { ok: false, field: "fix_files", error: "every fix_files entry needs a non-empty path and change" }
      }
      files.push({ path: o.path.trim().slice(0, 500), change: o.change.trim().slice(0, 2000) })
    }
    patch.fix_files = files
  }
  for (const k of ["fix_commit", "fixed_by"] as const) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== "string" || !(b[k] as string).trim()) return { ok: false, field: k, error: `${k} must be a non-empty string` }
      patch[k] = (b[k] as string).trim().slice(0, k === "fix_commit" ? 100 : 200)
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, field: "body", error: "send at least one of status, fix_summary, fix_files, fix_commit, fixed_by" }
  // Marking something fixed without saying what was done is exactly the unreviewable state this log exists to prevent.
  if (patch.status === "fixed") {
    if (!patch.fix_summary) return { ok: false, field: "fix_summary", error: "fix_summary is required when status is 'fixed'" }
    if (!patch.fix_files || patch.fix_files.length === 0) return { ok: false, field: "fix_files", error: "fix_files needs at least one {path, change} when status is 'fixed'" }
  }
  return { ok: true, patch }
}

export async function patchIssueWithDb(db: TenantDb, orgId: string, id: string, patch: IssuePatch, defaultFixedBy: string | null): Promise<Record<string, unknown>> {
  const fixed = patch.status === "fixed"
  const rows = rowsOf(
    await db.execute(sql`
      UPDATE compliance.client_error_issues SET
        status = COALESCE(${patch.status ?? null}, status),
        fix_summary = COALESCE(${patch.fix_summary ?? null}, fix_summary),
        fix_files = COALESCE(${patch.fix_files ? JSON.stringify(patch.fix_files) : null}::jsonb, fix_files),
        fix_commit = COALESCE(${patch.fix_commit ?? null}, fix_commit),
        fixed_by = COALESCE(${patch.fixed_by ?? (fixed ? defaultFixedBy : null)}, fixed_by),
        fixed_at = CASE WHEN ${fixed}::boolean THEN now() ELSE fixed_at END
      WHERE org_id = ${orgId} AND id = ${id}
      RETURNING *`)
  )
  if (!rows[0]) throw new ServiceError("Issue not found", 404)
  return rows[0]
}