// NEW-ORGANISATION PROVISIONING INSIDE THE EDGE FUNCTION (AUDIT-100 G-09; SQL: drizzle/0729_projexa_org_credentials_and_provision.sql).
//
//   POST <projexa-api>/api/org/provision   {"orgName": "..."}   Authorization: Bearer <the person's own PROJEXA session token>
//   GET  <projexa-api>/api/org/repair      diagnosis, owner/admin only
//   POST <projexa-api>/api/org/repair      owner/admin only
//
// These are the contracts of PROJEXA's Next routes src/app/api/org/provision/route.ts and src/app/api/org/repair/route.ts (status, JSON body, error text,
// ORDER of the steps), moved here so no Vercel function, no platform application key (VERIDIAN_PLATFORM_APPLICATION_KEY) and no database password is
// needed to open a new workspace. What changed underneath, and only that:
//   * "provisionVeridianOrg" is one SQL call on the verdian-ai project (public.projexa_provision_org, ONE transaction: organisation, branches, currency,
//     fiscal year, chart, department, the key's HASH). The key itself is generated HERE (crypto, vk_ + 32 chars), kept in memory for the length of the
//     request, and stored only through public.projexa_org_credential_put (compliance.projexa_org_credentials), never logged, never returned.
//   * PROJEXA's own organizations / memberships rows are written with the CALLER'S OWN token against the PROJEXA project's REST: row level security
//     decides, exactly as the Next route's supabase client does (drizzle/0003_signup_insert_policies.sql).
//   * the credentials row goes to the compliance side (and, while PX_MIRROR_LEGACY_CREDENTIALS is not "false", also to the legacy PROJEXA
//     public.veridian_credentials so the routes that still run on Vercel keep resolving the key until their reader is switched; the new table is the
//     source of truth, the mirror is best effort and logged without a value).
// ORDER (deliberate, unchanged): VERIDIAN side FIRST. If it fails nothing is created on the PROJEXA side. The documented orphan tradeoff stays: a failure
// at the organizations / memberships / credentials step leaves a harmless VERIDIAN organisation nothing points at.
//
// Deliberate differences from the Next route, each an improvement and recorded in README.md:
//   * the idempotency lookup that FAILS answers 503 (the Next route read a failed lookup as "no membership" and could open a second organisation);
//   * the provisioning rate limit (20 per 60 s) is checked before any VERIDIAN write, per function instance (the Next one was per Vercel instance);
//   * provisioning is atomic on the VERIDIAN side (no orphan inside VERIDIAN).
// Nothing here logs a token, an email, a key or a body.
import type { SessionVerifier } from "../ai-work-link/session.ts"
import { ALLOWED_ORIGINS, CORS_ALLOW_HEADERS, CORS_EXPOSE_HEADERS, CORS_MAX_AGE_SECONDS, RETRY_AFTER_SECONDS, type MembershipLookup } from "./handler.ts"
import { checkApiWriteAccess, ROLE_GROUPS } from "./policy.generated.ts"

export const ORG_PATH_RE = /(^|\/)api\/org\/(provision|repair)\/?$/
export const PROVISION_MAX_PER_WINDOW = 20
export const PROVISION_WINDOW_MS = 60_000
const LOOKUP_TIMEOUT_MS = 8_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RpcResult = { data: unknown; error: unknown }
export type VeridianRpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>

export type OrgDeps = {
  session: SessionVerifier
  issuer: string
  membership: MembershipLookup
  /** the verdian-ai service-role rpc (public.projexa_* functions of drizzle/0729) */
  rpc: VeridianRpc
  /** PROJEXA project REST base ("https://<ref>.supabase.co") and its public anon key: used with the caller's own token */
  projexaUrl: string
  projexaAnonKey: string
  /** the legacy PROJEXA public.veridian_credentials (service role): the fallback READ for organisations not yet moved, and the transition mirror WRITE */
  legacy?: { serviceRoleKey: string; mirror: boolean }
  fetchImpl?: typeof fetch
  allowedOrigins?: readonly string[]
  /** tests inject these; production uses crypto */
  randomKey?: () => string
  randomSuffix?: () => string
  now?: () => number
  log?: (line: string) => void
}

// the in-process rate limit of POST /api/v1/platform/provision-org (per function instance, like the original per Vercel instance)
const provisionHits: number[] = []
export function resetOrgRateLimit() {
  provisionHits.length = 0
}
function overRateLimit(now: number): boolean {
  while (provisionHits.length && now - provisionHits[0] >= PROVISION_WINDOW_MS) provisionHits.shift()
  provisionHits.push(now)
  return provisionHits.length > PROVISION_MAX_PER_WINDOW
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org"
}

/** src/lib/api-keys.ts generateApiKey(): vk_ + 32 characters of [A-Za-z0-9] (here from crypto, with rejection sampling: no modulo bias). */
export function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  while (out.length < 32) {
    const buf = crypto.getRandomValues(new Uint8Array(64))
    for (const b of buf) {
      if (b < 248 && out.length < 32) out += chars[b % 62]
    }
  }
  return `vk_${out}`
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("")
}

function corsHeaders(req: Request, deps: OrgDeps): Record<string, string> {
  const origin = req.headers.get("origin")
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
  }
  if (origin && (deps.allowedOrigins ?? ALLOWED_ORIGINS).includes(origin)) h["Access-Control-Allow-Origin"] = origin
  return h
}

function json(req: Request, deps: OrgDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 204 ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...corsHeaders(req, deps), ...extra },
  })
}

function logLine(deps: OrgDeps, line: string) {
  try {
    ;(deps.log ?? ((l: string) => console.error(l)))(`projexa-api: org: ${line}`)
  } catch {
    // logging never breaks an answer
  }
}

export function isOrgRequest(req: Request): boolean {
  return ORG_PATH_RE.test(new URL(req.url).pathname)
}

/** An error the Next route would have caught as a VeridianApiError: its status and message. */
type ProvisionFailure = { status: number; message: string }

async function timed<T>(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<{ ok: true; res: Response } | { ok: false }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    return { ok: true, res: await fetchImpl(url, { ...init, signal: controller.signal }) }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

/** public.projexa_provision_org: the VERIDIAN side, in one transaction. */
async function provisionVeridianOrg(deps: OrgDeps, input: { name: string; country?: string | null }): Promise<{ ok: true; organisationId: string; apiKey: string } | { ok: false; failure: ProvisionFailure }> {
  if (overRateLimit((deps.now ?? Date.now)())) return { ok: false, failure: { status: 429, message: "Too many provisioning requests. Try again in a minute." } }
  const apiKey = (deps.randomKey ?? generateApiKey)()
  let out: RpcResult
  try {
    out = await deps.rpc("projexa_provision_org", {
      p_name: input.name,
      p_country: input.country ?? null,
      p_currency: null,
      p_key_hash: await sha256Hex(apiKey),
      p_key_prefix: apiKey.substring(0, 8) + "...",
    })
  } catch {
    return { ok: false, failure: { status: 502, message: "" } } // a non-upstream error: the route answers its generic 502 text
  }
  if (out.error) return { ok: false, failure: { status: 500, message: "Failed to provision organisation" } }
  const row = (Array.isArray(out.data) ? out.data[0] : out.data) as { outcome?: unknown; organisation_id?: unknown } | null | undefined
  if (row?.outcome === "created" && typeof row.organisation_id === "string") return { ok: true, organisationId: row.organisation_id, apiKey }
  if (row?.outcome === "bad_input") return { ok: false, failure: { status: 400, message: "customerOrgName is required" } }
  if (row?.outcome === "not_configured") return { ok: false, failure: { status: 503, message: "Organisation provisioning is not configured on this deployment." } }
  return { ok: false, failure: { status: 502, message: "VERIDIAN provision-org returned an unexpected response shape" } }
}

/** The organisation's credentials row: the compliance-side table first, the legacy PROJEXA table for an organisation not yet moved. */
export async function readCredential(deps: OrgDeps, projexaOrgId: string): Promise<{ veridianOrgId: string; apiKey: string } | null> {
  if (!UUID_RE.test(projexaOrgId)) return null
  try {
    const out = await deps.rpc("projexa_org_credential_get", { p_projexa_org_id: projexaOrgId })
    if (!out.error) {
      const row = (Array.isArray(out.data) ? out.data[0] : out.data) as { veridian_org_id?: unknown; api_key?: unknown } | null | undefined
      if (row && typeof row.veridian_org_id === "string" && typeof row.api_key === "string" && row.api_key) return { veridianOrgId: row.veridian_org_id, apiKey: row.api_key }
    }
  } catch {
    // fall through to the legacy table
  }
  if (!deps.legacy) return null
  const url = `${deps.projexaUrl.replace(/\/+$/, "")}/rest/v1/veridian_credentials?select=veridian_org_id,veridian_api_key&organization_id=eq.${encodeURIComponent(projexaOrgId)}&limit=1`
  const r = await timed(deps.fetchImpl ?? fetch, url, { headers: { apikey: deps.legacy.serviceRoleKey, Authorization: `Bearer ${deps.legacy.serviceRoleKey}`, Accept: "application/json" } })
  if (!r.ok || !r.res.ok) return null
  try {
    const rows = await r.res.json()
    const row = Array.isArray(rows) ? (rows[0] as { veridian_org_id?: unknown; veridian_api_key?: unknown } | undefined) : undefined
    return row && typeof row.veridian_org_id === "string" && typeof row.veridian_api_key === "string" && row.veridian_api_key ? { veridianOrgId: row.veridian_org_id, apiKey: row.veridian_api_key } : null
  } catch {
    return null
  }
}

/** Stores the credentials (compliance side, first writer wins) and mirrors them to the legacy table while the mirror is on. */
async function storeCredential(deps: OrgDeps, projexaOrgId: string, veridianOrgId: string, apiKey: string): Promise<boolean> {
  let stored = false
  try {
    const out = await deps.rpc("projexa_org_credential_put", { p_projexa_org_id: projexaOrgId, p_veridian_org_id: veridianOrgId, p_api_key: apiKey })
    stored = !out.error && (out.data === "stored" || out.data === "exists")
  } catch {
    stored = false
  }
  if (!stored) return false
  if (deps.legacy?.mirror) {
    const url = `${deps.projexaUrl.replace(/\/+$/, "")}/rest/v1/veridian_credentials?on_conflict=organization_id`
    const r = await timed(deps.fetchImpl ?? fetch, url, {
      method: "POST",
      headers: { apikey: deps.legacy.serviceRoleKey, Authorization: `Bearer ${deps.legacy.serviceRoleKey}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ organization_id: projexaOrgId, veridian_org_id: veridianOrgId, veridian_api_key: apiKey }),
    })
    if (!r.ok || !r.res.ok) logLine(deps, "legacy credentials mirror failed (non-fatal; the compliance-side row is the source of truth)")
  }
  return true
}

function bearer(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

function provisionError(req: Request, deps: OrgDeps, verb: string, f: ProvisionFailure): Response {
  // veridian-client's VeridianApiError message reaches the user; a non-upstream error gets the generic text and 502
  if (f.message === "") return json(req, deps, 502, { error: `Could not ${verb}. Please try again.` })
  return json(req, deps, f.status, { error: `Could not ${verb}: ${f.message}` })
}

export async function handleOrg(req: Request, deps: OrgDeps): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method.toUpperCase()
  if (method === "OPTIONS") return json(req, deps, 204, null)
  const isRepair = /\/repair\/?$/.test(url.pathname)
  if (isRepair ? method !== "GET" && method !== "POST" : method !== "POST") return json(req, deps, 405, { error: "Method not allowed" }, { Allow: isRepair ? "GET, POST, OPTIONS" : "POST, OPTIONS" })

  // the Next provision route reads and checks its body BEFORE it looks at the session
  let orgName = ""
  if (!isRepair) {
    const text = await req.text().catch(() => "")
    let body: { orgName?: unknown } | null = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    orgName = typeof body?.orgName === "string" ? body.orgName.trim() : ""
    if (!orgName) return json(req, deps, 400, { error: "orgName is required" })
  }

  const token = bearer(req)
  if (!token) return json(req, deps, 401, { error: "Unauthorized" })
  const verdict = await deps.session(token)
  if (!verdict.ok) return verdict.reason === "unavailable" ? json(req, deps, 503, { error: "Sign-in could not be checked just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) }) : json(req, deps, 401, { error: "Unauthorized" })
  if (verdict.issuer !== deps.issuer) return json(req, deps, 401, { error: "Unauthorized" })

  let found = await deps.membership(token, verdict.sub)
  if (!found.ok) found = await deps.membership(token, verdict.sub)
  if (!found.ok) {
    logLine(deps, "membership lookup failed twice")
    return json(req, deps, 503, { error: "Could not verify organization membership, please retry" })
  }

  return isRepair ? repair(req, deps, token, method, found.row) : provision(req, deps, token, verdict.sub, orgName, found.row)
}

async function provision(req: Request, deps: OrgDeps, token: string, userId: string, orgName: string, existing: { organization_id: string; role: string | null } | null): Promise<Response> {
  // idempotency: an existing membership is reported, never a second organisation
  if (existing) {
    const organizationId = existing.organization_id
    const veridianConnected = (await readCredential(deps, organizationId)) !== null
    return json(req, deps, 200, { organizationId, alreadyProvisioned: true, veridianConnected, ...(veridianConnected ? {} : { repairRequired: true, repairPath: "/api/org/repair" }) })
  }

  // step 1: the VERIDIAN side first
  const v = await provisionVeridianOrg(deps, { name: orgName, country: null })
  if (!v.ok) {
    logLine(deps, `VERIDIAN provisioning failed (${v.failure.status})`)
    return provisionError(req, deps, "provision your PROJEXA workspace", v.failure)
  }

  // step 2: PROJEXA's own organization + membership with the caller's own token (row level security decides)
  const fetchImpl = deps.fetchImpl ?? fetch
  const base = deps.projexaUrl.replace(/\/+$/, "")
  const userHeaders = { apikey: deps.projexaAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/vnd.pgrst.object+json", Prefer: "return=representation" }
  const slug = `${slugify(orgName)}-${(deps.randomSuffix ?? (() => Math.random().toString(36).slice(2, 7)))()}`
  const orgRes = await timed(fetchImpl, `${base}/rest/v1/organizations?select=*`, { method: "POST", headers: userHeaders, body: JSON.stringify({ name: orgName, slug }) })
  let org: { id?: unknown } | null = null
  let orgMessage: string | undefined
  if (orgRes.ok) {
    const parsed = await orgRes.res.json().catch(() => null)
    if (orgRes.res.ok) org = parsed
    else orgMessage = typeof parsed?.message === "string" ? parsed.message : undefined
  }
  if (!org || typeof org.id !== "string") {
    logLine(deps, "VERIDIAN org provisioned but creating the PROJEXA organization row failed")
    return json(req, deps, 500, { error: orgMessage ?? "Failed to create organization" })
  }
  const orgId = org.id

  const memRes = await timed(fetchImpl, `${base}/rest/v1/memberships`, { method: "POST", headers: { ...userHeaders, Accept: "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, organization_id: orgId, role: "owner" }) })
  if (!memRes.ok || !memRes.res.ok) {
    const parsed = memRes.ok ? await memRes.res.json().catch(() => null) : null
    logLine(deps, "VERIDIAN and PROJEXA organisation created but the membership insert failed")
    return json(req, deps, 500, { error: typeof parsed?.message === "string" ? parsed.message : "Failed to create membership" })
  }

  // step 3: the credentials
  if (!(await storeCredential(deps, orgId, v.organisationId, v.apiKey))) {
    logLine(deps, "VERIDIAN and PROJEXA organisations created but storing the credentials failed")
    return json(req, deps, 500, { error: "Your account was created but we couldn't finish connecting it to your workspace. Please contact support." })
  }
  return json(req, deps, 201, { organizationId: orgId })
}

async function repair(req: Request, deps: OrgDeps, token: string, method: string, membership: { organization_id: string; role: string | null } | null): Promise<Response> {
  const role = membership?.role ?? null
  // the middleware's write gate (POST /api/org/repair is ORG_ADMIN), then the handler's own requireAuth() "No organization" and requireRole(ORG_ADMIN)
  const gate = checkApiWriteAccess(method, "/api/org/repair", role)
  if (!gate.allowed) return json(req, deps, 403, { error: "Forbidden: your role does not permit this action" })
  if (!membership) return json(req, deps, 400, { error: "No organization" })
  if (!role || !(ROLE_GROUPS.ORG_ADMIN ?? []).includes(role)) return json(req, deps, 403, { error: "Forbidden: your role does not permit this action" })
  const organizationId = membership.organization_id

  const existing = await readCredential(deps, organizationId)
  if (method === "GET") return json(req, deps, 200, { organizationId, veridianConnected: existing !== null, repairAvailable: existing === null })

  if (existing) return json(req, deps, 200, { organizationId, repaired: false, alreadyHealthy: true, message: "This workspace is already connected to PROJEXA. Nothing to repair." })

  // the organisation's own name / country (the caller is an owner/admin of it: read with their own token, row level security decides)
  const base = deps.projexaUrl.replace(/\/+$/, "")
  const orgRes = await timed(deps.fetchImpl ?? fetch, `${base}/rest/v1/organizations?select=name,country&id=eq.${encodeURIComponent(organizationId)}&limit=1`, { headers: { apikey: deps.projexaAnonKey, Authorization: `Bearer ${token}`, Accept: "application/json" } })
  let rows: unknown = null
  if (orgRes.ok && orgRes.res.ok) rows = await orgRes.res.json().catch(() => null)
  if (!Array.isArray(rows)) {
    logLine(deps, "repair: could not read the organization")
    return json(req, deps, 503, { error: "Could not read your organisation. Please retry." })
  }
  const org = rows[0] as { name?: unknown; country?: unknown } | undefined
  if (!org || typeof org.name !== "string") return json(req, deps, 409, { error: "Your membership points at an organisation that no longer exists. This needs support, not a repair." })

  const v = await provisionVeridianOrg(deps, { name: org.name, country: typeof org.country === "string" && org.country ? org.country : null })
  if (!v.ok) {
    logLine(deps, `repair: VERIDIAN provisioning failed (${v.failure.status})`)
    return provisionError(req, deps, "connect your PROJEXA workspace", v.failure)
  }
  if (!(await storeCredential(deps, organizationId, v.organisationId, v.apiKey))) {
    logLine(deps, "repair: VERIDIAN org provisioned but storing the credentials failed")
    return json(req, deps, 500, { error: "We connected your workspace but couldn't save the connection. Please contact support." })
  }
  // prove it by the read path every call uses, not by assuming the write worked
  if (!(await readCredential(deps, organizationId))) {
    logLine(deps, "repair: post-write verification failed")
    return json(req, deps, 500, { error: "We connected your workspace but couldn't confirm it. Please contact support." })
  }
  return json(req, deps, 201, { organizationId, repaired: true })
}
