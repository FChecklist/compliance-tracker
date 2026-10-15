// EVERY MEMBER GETS THEIR OWN VERIDIAN USER (AUDIT-100, audit100/link-invited-members; SQL: drizzle/0728_projexa_ensure_member_user.sql).
//
// POST <projexa-api>/link-member   Authorization: Bearer <the person's own PROJEXA session token>   (no body)
//   200 {"linked":true,  "outcome":"created"|"linked_existing"|"already_linked", "role":"<VERIDIAN role>"}
//   200 {"linked":false, "outcome":"<a guard of the SQL function>"}           nothing was written (see 0728 for the list)
//   401 no or bad token, or a token of another issuer; 400 {"error":"No organization"}; 503 a lookup failed (Retry-After)
//
// WHY. Only an organisation's FIRST person was ever linked to a VERIDIAN user (platform-first-user-service.ts, drizzle/0675). Everyone who joined through
// an invitation had none, so their AI work link mint, the in-app "Copy AI prompt" and the welcome e-mail all failed with USER_NOT_LINKED. PROJEXA calls
// this right after an invitation is accepted (src/app/api/org/invites/accept/route.ts) and, lazily, when a mint answers USER_NOT_LINKED
// (src/lib/ai-work-link-core.ts), so existing members heal the first time they use the AI link.
//
// THE TRUST CHAIN (nothing the caller sends decides the organisation or the role):
//   1. the token is verified (ai-work-link/session.ts: ES256, the PROJEXA Auth project only) -> sub and email;
//   2. the person's organisation and PROJEXA role come from PROJEXA's own `memberships`, read WITH THE PERSON'S OWN TOKEN (row level security decides),
//      oldest membership first: exactly the membership every other projexa-api route and PROJEXA's requireAuth() use (lookups.ts);
//   3. that organisation's VERIDIAN organisation id comes from PROJEXA `veridian_credentials`, read server-side with the PROJEXA service role (the same
//      row whose key every per-org VERIDIAN call uses; the key itself is not read here);
//   4. public.projexa_ensure_member_user maps the role (owner/admin -> admin, pm -> manager, site_engineer/member -> member, client_viewer ->
//      client_viewer, anything else refused), never raises anyone, never adds a second link, and is idempotent.
// Nothing here logs a token, an email, a key or an id: one line with the outcome.
import type { SessionVerifier } from "../ai-work-link/session.ts"
import { ALLOWED_ORIGINS, RETRY_AFTER_SECONDS, type MembershipLookup } from "./handler.ts"

export const MEMBER_LINK_PATH_RE = /(^|\/)link-member\/?$/

/** The outcomes of public.projexa_ensure_member_user that mean "this person now resolves to a VERIDIAN user". */
export const LINKED_OUTCOMES: ReadonlySet<string> = new Set(["created", "linked_existing", "already_linked"])

export type EnsureMemberRpc = (args: { p_org_id: string; p_auth_user_id: string; p_email: string; p_name: string | null; p_projexa_role: string }) => Promise<
  { ok: true; outcome: string; role: string | null } | { ok: false }
>

export type MemberLinkDeps = {
  session: SessionVerifier
  issuer: string
  membership: MembershipLookup
  /** PROJEXA organisation id -> its VERIDIAN organisation id (veridian_credentials), or null when it has none. */
  veridianOrgId: (organizationId: string) => Promise<string | null>
  ensure: EnsureMemberRpc
  allowedOrigins?: readonly string[]
  log?: (line: string) => void
}

/** The PROJEXA -> VERIDIAN role mapping, the same table as public.projexa_member_veridian_role (drizzle/0728). The SQL decides; this copy exists so a
 *  role the database would refuse is not even sent, and so the table is visible and unit-tested on this side too. Never admin unless owner/admin. */
export const PROJEXA_TO_VERIDIAN_ROLE: Readonly<Record<string, string>> = Object.freeze({
  owner: "admin",
  admin: "admin",
  pm: "manager",
  site_engineer: "member",
  member: "member",
  client_viewer: "client_viewer",
})

export function veridianRoleFor(projexaRole: string | null | undefined): string | null {
  if (typeof projexaRole !== "string") return null
  const key = projexaRole.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(PROJEXA_TO_VERIDIAN_ROLE, key) ? PROJEXA_TO_VERIDIAN_ROLE[key] : null
}

function cors(req: Request, deps: MemberLinkDeps): Record<string, string> {
  const origin = req.headers.get("origin")
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, accept",
    "Access-Control-Max-Age": "7200",
  }
  if (origin && (deps.allowedOrigins ?? ALLOWED_ORIGINS).includes(origin)) h["Access-Control-Allow-Origin"] = origin
  return h
}

function json(req: Request, deps: MemberLinkDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 204 ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors(req, deps), ...extra },
  })
}

function log(deps: MemberLinkDeps, line: string) {
  try {
    ;(deps.log ?? ((l: string) => console.error(l)))(`projexa-api: link-member: ${line}`)
  } catch {
    // logging never breaks an answer
  }
}

export function isMemberLinkRequest(req: Request): boolean {
  return MEMBER_LINK_PATH_RE.test(new URL(req.url).pathname)
}

export async function handleMemberLink(req: Request, deps: MemberLinkDeps): Promise<Response> {
  const method = req.method.toUpperCase()
  if (method === "OPTIONS") return json(req, deps, 204, null)
  if (method !== "POST") return json(req, deps, 405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" })

  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)
  const token = m ? m[1] : null
  if (!token) return json(req, deps, 401, { error: "Unauthorized" })
  const verdict = await deps.session(token)
  if (!verdict.ok) {
    return verdict.reason === "unavailable"
      ? json(req, deps, 503, { error: "Sign-in could not be checked just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
      : json(req, deps, 401, { error: "Unauthorized" })
  }
  if (verdict.issuer !== deps.issuer) return json(req, deps, 401, { error: "Unauthorized" })
  if (!verdict.email) {
    log(deps, "no email on the session -> no_email")
    return json(req, deps, 200, { linked: false, outcome: "no_email" })
  }

  let found = await deps.membership(token, verdict.sub)
  if (!found.ok) found = await deps.membership(token, verdict.sub)
  if (!found.ok) {
    log(deps, "membership lookup failed twice -> 503")
    return json(req, deps, 503, { error: "Could not verify organization membership, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
  }
  if (!found.row) return json(req, deps, 400, { error: "No organization" })

  const projexaRole = found.row.role ?? ""
  if (veridianRoleFor(projexaRole) === null) {
    log(deps, "role not mapped -> role_not_mapped")
    return json(req, deps, 200, { linked: false, outcome: "role_not_mapped" })
  }

  let orgId: string | null
  try {
    orgId = await deps.veridianOrgId(found.row.organization_id)
  } catch {
    orgId = null
  }
  if (!orgId) {
    log(deps, "organisation has no VERIDIAN organisation -> not_eligible")
    return json(req, deps, 200, { linked: false, outcome: "not_eligible" })
  }

  let out: Awaited<ReturnType<EnsureMemberRpc>>
  try {
    out = await deps.ensure({ p_org_id: orgId, p_auth_user_id: verdict.sub, p_email: verdict.email, p_name: null, p_projexa_role: projexaRole })
  } catch {
    out = { ok: false }
  }
  if (!out.ok) {
    log(deps, "ensure failed -> 503")
    return json(req, deps, 503, { error: "Your VERIDIAN user could not be made just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
  }
  log(deps, `-> ${out.outcome}`)
  return LINKED_OUTCOMES.has(out.outcome)
    ? json(req, deps, 200, { linked: true, outcome: out.outcome, role: out.role })
    : json(req, deps, 200, { linked: false, outcome: out.outcome })
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The two production dependencies (pure: fetch injected, so the tests run them against a fake PostgREST)
// ---------------------------------------------------------------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const LOOKUP_TIMEOUT_MS = 5_000

async function postOrGet(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!res.ok) return { ok: false }
    return { ok: true, body: await res.json() }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

/** PROJEXA public.veridian_credentials.veridian_org_id for one PROJEXA organisation (service role; the key column is never selected). */
export function createVeridianOrgIdLookup(o: {
  projexaUrl: string
  serviceRoleKey: string
  /** G-09: the compliance-side credentials table first (public.projexa_org_veridian_id_get); the legacy PROJEXA table answers for an organisation not moved yet */
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  fetchImpl?: typeof fetch
}): (organizationId: string) => Promise<string | null> {
  return async (organizationId) => {
    if (!UUID_RE.test(organizationId)) return null
    if (o.rpc) {
      try {
        const r = await o.rpc("projexa_org_veridian_id_get", { p_projexa_org_id: organizationId })
        if (!r.error && typeof r.data === "string" && r.data !== "") return r.data
      } catch {
        // fall through to the legacy table
      }
    }
    if (!o.projexaUrl || !o.serviceRoleKey) return null
    const url = `${o.projexaUrl.replace(/\/+$/, "")}/rest/v1/veridian_credentials?select=veridian_org_id&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`
    const out = await postOrGet(o.fetchImpl ?? fetch, url, { headers: { apikey: o.serviceRoleKey, Authorization: `Bearer ${o.serviceRoleKey}`, Accept: "application/json" } })
    if (!out.ok || !Array.isArray(out.body)) return null
    const id = (out.body[0] as { veridian_org_id?: unknown } | undefined)?.veridian_org_id
    return typeof id === "string" && id !== "" ? id : null
  }
}

/** public.projexa_ensure_member_user on THIS project (verdian-ai), through the platform-injected service-role client's rpc. */
export function createEnsureMemberRpc(rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>): EnsureMemberRpc {
  return async (args) => {
    const { data, error } = await rpc("projexa_ensure_member_user", args)
    if (error) return { ok: false }
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; role?: unknown } | null | undefined
    if (!row || typeof row.outcome !== "string") return { ok: false }
    return { ok: true, outcome: row.outcome, role: typeof row.role === "string" ? row.role : null }
  }
}
