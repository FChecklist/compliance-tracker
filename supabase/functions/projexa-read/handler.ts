// PROJEXA-BUILD-001 U-25 (PMD-01): the request handler of the projexa-read Edge Function (the identity gateway), with its I/O
// passed in (`deps`) so bun can run the real handler in src/lib/services/projexa-read-gateway.test.ts. index.ts only wires
// Deno.serve, jose and the service-role client.
//
// SECURITY MODEL
//   * Deployed with verify_jwt false: the caller is a PROJEXA browser session whose access token is signed by the PROJEXA Auth
//     project, not by verdian-ai, so the platform's own JWT check would refuse it. The token is verified here instead (jwt.ts:
//     ES256 only, PROJEXA's published key set, issuer, audience, expiry). No token, or any failure of those checks, is 401 with
//     the same body every time, so a caller learns nothing about why.
//   * The function holds only the platform-injected service-role client and reaches compliance.* through two public.projexa_read_*
//     wrappers (drizzle/0618, service_role only), never through a table. The organisation is never taken from the request: the
//     wrapper resolves it from the verified sub (compliance.users.auth_user_id), and returns rows of that organisation only.
//   * Fail closed: the switch platform.projexa_gateway_settings.enabled (default off) is read through projexa_read_enabled();
//     off, missing, or an RPC error is 503. The data wrapper checks the same switch again on its own.
//   * Another organisation's project is 404, exactly like a project that does not exist (never 403, never an empty 200).
//   * The token is never logged and never returned. Log lines carry an outcome and a status only.
//
// ENDPOINT
//   GET ?fn=boq_lines&projectId=<id>[&after=<line id>][&limit=1..500, default 100]
//   200 {"fn":"boq_lines","projectId":"...","rows":[...],"nextAfter":"<line id>"|null}: that project's BOQ line items across all
//   of its BOQs, ordered by line id (byte order), one page per call; pass nextAfter back as `after` for the next page.
//   Project-side cost fields (qtyProject, rateProject) are never returned: cost-visibility-service.ts is the one gate for them and
//   this gateway, like every API-key caller today, has no cost grant. The SQL wrapper does not select them, and the handler strips
//   every name in PROJECT_SIDE_COST_FIELDS from each row as well, so a later change to the wrapper cannot leak them.
import type { VerifyResult } from "./jwt.ts"

export type RpcResult = { data: unknown; error: { message: string } | null }

export type GatewayDeps = {
  verify: (token: string) => Promise<VerifyResult>
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
  log?: (line: string) => void
}

// The PROJEXA browser origins (production and the local dev server on port 3100, see CLAUDE.md). Any other origin gets no
// Access-Control-Allow-Origin header, so a browser on another site cannot read a response.
export const ALLOWED_ORIGINS = ["https://projexa-ai.com", "https://www.projexa-ai.com", "http://localhost:3100"] as const

export const SUPPORTED_FNS = ["boq_lines"] as const

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

// Same sentence as src/lib/supabase/auth-guard.ts USER_NOT_LINKED_MESSAGE (the test holds the two equal).
export const USER_NOT_LINKED_MESSAGE = "Your PROJEXA account is not linked to a VERIDIAN user - ask your admin"

// The names src/lib/services/cost-visibility-service.ts PROJECT_SIDE_COST_FIELDS redacts for a caller without a cost grant (the
// test holds this list to be a superset of that one).
export const PROJECT_SIDE_COST_FIELDS: ReadonlySet<string> = new Set([
  "qtyProject", "rateProject", "projectValue", "variance", "variancePercent", "quantityVariance", "rateVariance",
  "coveredContractValue", "coverageRatio", "projectValueDelta",
])

// Reason codes the wrappers return for a caller who cannot be mapped to exactly one active user of one organisation.
const NOT_LINKED_REASONS = new Set(["not_linked", "deactivated", "ambiguous"])

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/

function baseHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    Vary: "Authorization, Origin",
    "X-Content-Type-Options": "nosniff",
  }
  if (origin && (ALLOWED_ORIGINS as readonly string[]).includes(origin)) h["Access-Control-Allow-Origin"] = origin
  return h
}

function json(origin: string | null, body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...baseHeaders(origin), ...extra } })
}

function unauthorized(origin: string | null): Response {
  return json(origin, { error: "Unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="projexa-read"' })
}

function bearerOf(req: Request): string | null {
  const header = req.headers.get("authorization") ?? ""
  const m = /^Bearer[ ]+([^\s]+)$/i.exec(header.trim())
  return m ? m[1] : null
}

export function preflight(req: Request): Response {
  const origin = req.headers.get("origin")
  const headers: Record<string, string> = { ...baseHeaders(origin), "Access-Control-Max-Age": "600" }
  delete headers["Content-Type"]
  if (headers["Access-Control-Allow-Origin"]) {
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, x-client-info, content-type"
  }
  return new Response(null, { status: 204, headers })
}

type BoqQuery = { projectId: string; after: string | null; limit: number }

function parseBoqQuery(url: URL): BoqQuery | { error: string } {
  const projectId = url.searchParams.get("projectId") ?? ""
  if (!ID_RE.test(projectId)) return { error: "projectId is required (letters, digits, - and _, at most 128)" }
  const afterRaw = url.searchParams.get("after")
  if (afterRaw !== null && afterRaw !== "" && !ID_RE.test(afterRaw)) return { error: "after must be a line id returned as nextAfter" }
  const limitRaw = url.searchParams.get("limit")
  let limit = DEFAULT_LIMIT
  if (limitRaw !== null && limitRaw !== "") {
    if (!/^[0-9]{1,3}$/.test(limitRaw)) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}` }
    limit = Number(limitRaw)
    if (limit < 1 || limit > MAX_LIMIT) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}` }
  }
  return { projectId, after: afterRaw ? afterRaw : null, limit }
}

type WrapperResult = { status?: unknown; rows?: unknown; nextAfter?: unknown }
type Log = (line: string) => void

async function rpcSafe(deps: GatewayDeps, fn: string, args?: Record<string, unknown>): Promise<RpcResult> {
  try {
    return await deps.rpc(fn, args)
  } catch {
    return { data: null, error: { message: "rpc threw" } }
  }
}

/** The verified caller, or the 401 / 503 to send. No I/O at all when there is no bearer. */
async function authenticate(req: Request, origin: string | null, deps: GatewayDeps, log: Log): Promise<{ sub: string; email: string | null } | Response> {
  const token = bearerOf(req)
  if (!token) return unauthorized(origin)
  let who: VerifyResult
  try {
    who = await deps.verify(token)
  } catch {
    who = { ok: false, reason: "invalid" }
  }
  if (who.ok) return { sub: who.sub, email: who.email }
  if (who.reason === "unavailable") {
    log("projexa-read: key set unavailable -> 503")
    return json(origin, { error: "Service unavailable" }, 503)
  }
  log("projexa-read: token refused -> 401")
  return unauthorized(origin)
}

function stripProjectSide(row: unknown): unknown {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return row
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([k]) => !PROJECT_SIDE_COST_FIELDS.has(k)))
}

/** Maps the data wrapper's answer to the HTTP answer. Only status "ok" ever carries rows out. */
function boqResponse(origin: string | null, projectId: string, res: RpcResult, log: Log): Response {
  if (res.error) {
    log("projexa-read: boq_lines wrapper error -> 500")
    return json(origin, { error: "Internal error" }, 500)
  }
  const out = (res.data ?? {}) as WrapperResult
  const status = typeof out.status === "string" ? out.status : ""
  if (status === "disabled") return json(origin, { error: "Service unavailable" }, 503)
  if (NOT_LINKED_REASONS.has(status)) {
    log(`projexa-read: caller not linked (${status}) -> 403`)
    return json(origin, { error: USER_NOT_LINKED_MESSAGE, code: "USER_NOT_LINKED" }, 403)
  }
  if (status === "not_found") return json(origin, { error: "Not found" }, 404)
  if (status !== "ok" || !Array.isArray(out.rows)) {
    log("projexa-read: boq_lines wrapper returned an unknown shape -> 500")
    return json(origin, { error: "Internal error" }, 500)
  }
  const nextAfter = typeof out.nextAfter === "string" ? out.nextAfter : null
  return json(origin, { fn: "boq_lines", projectId, rows: out.rows.map(stripProjectSide), nextAfter }, 200)
}

export async function handleProjexaRead(req: Request, deps: GatewayDeps): Promise<Response> {
  const log: Log = deps.log ?? ((line: string) => console.log(line))
  const origin = req.headers.get("origin")
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "GET") return json(origin, { error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" })

  const who = await authenticate(req, origin, deps, log)
  if (who instanceof Response) return who

  const sw = await rpcSafe(deps, "projexa_read_enabled")
  if (sw.error || sw.data !== true) return json(origin, { error: "Service unavailable" }, 503)

  const url = new URL(req.url)
  if (url.searchParams.get("fn") !== "boq_lines") return json(origin, { error: "Unknown fn", supported: SUPPORTED_FNS }, 400)
  const q = parseBoqQuery(url)
  if ("error" in q) return json(origin, { error: q.error }, 400)

  const res = await rpcSafe(deps, "projexa_read_boq_lines", { p_sub: who.sub, p_email: who.email, p_project_id: q.projectId, p_after: q.after, p_limit: q.limit })
  return boqResponse(origin, q.projectId, res, log)
}
