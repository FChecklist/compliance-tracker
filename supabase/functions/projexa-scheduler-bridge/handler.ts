// PROJEXA-BUILD-001 U-40 (PMD-05, PMD-39): the request handler of the projexa-scheduler-bridge Edge Function, with its I/O passed in
// (`deps`) so bun can run the real handler in src/lib/services/projexa-scheduler-bridge.test.ts. index.ts only wires Deno.serve, the
// service-role client and the two Edge Function secrets.
//
// WHAT IT IS. The middle hop of the scheduler bridge: pg_cron (job projexa-scheduler-bridge, every 5 minutes, drizzle/0642) ->
// pg_net -> THIS function -> POST /api/internal/scheduler-bridge/run on the deployed app, which runs each due schedule as the
// schedule's owner and stores proposals for a person to approve (src/lib/pipeline/scheduler-bridge.ts). The cron command never
// names the app route: this function is the only caller of it (register row BR-516).
//
// SECURITY MODEL (same as supabase/functions/projexa-timer)
//   * Deployed with verify_jwt false: pg_cron sends a Vault secret, not a Supabase JWT. The bearer is checked here through
//     public.projexa_scheduler_bridge_check_bearer (drizzle/0642, service_role only), which compares sha256 digests against the
//     Vault secret 'projexa_scheduler_bridge_secret' the cron reads. A missing or short bearer, an RPC error, or no secret refuses
//     everything (fail closed).
//   * The function holds only the platform-injected service-role client and two Edge Function secrets it reads by name:
//     SCHEDULER_BRIDGE_APP_URL (the deployed app's origin) and SCHEDULER_BRIDGE_INTERNAL_SECRET (the bearer the app route wants).
//     Neither value is written in any file, response or log line. The path it calls is fixed here; nothing in a request chooses it.
//
// COST GUARD. Before it calls the app it asks the database how many active schedules are due
// (public.projexa_scheduler_bridge_due_count). With none due it answers without calling the app, so an idle five-minute tick makes
// no request to Vercel (288 a day otherwise). The count is a hint: the app route reads the due schedules itself and claims each one
// atomically, so a stale count only means one call too many or one tick late, never a schedule run twice.
export type RpcResult = { data: unknown; error: { message: string } | null }

export type BridgeDeps = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
  fetchImpl: (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  now: () => Date
  /** the two Edge Function secrets, read by name in index.ts; null when unset */
  config: { appBaseUrl: string | null; internalSecret: string | null }
  appTimeoutMs?: number
}

/** The app route this function calls. Fixed: no request chooses it. */
export const APP_ROUTE_PATH = "/api/internal/scheduler-bridge/run"
export const SUPPORTED_JOBS = ["scheduler_bridge"] as const
export const DEFAULT_APP_TIMEOUT_MS = 100_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function short(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.length > 300 ? m.slice(0, 300) : m
}

async function bearerOk(req: Request, deps: BridgeDeps): Promise<boolean> {
  const header = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  const presented = m?.[1]?.trim() ?? ""
  if (presented.length < 24) return false
  try {
    const { data, error } = await deps.rpc("projexa_scheduler_bridge_check_bearer", { p_bearer: presented })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

/** The app route URL from the configured origin, or null when the origin is unset or is not a plain https origin. */
export function appRouteUrl(appBaseUrl: string | null): string | null {
  if (!appBaseUrl) return null
  let url: URL
  try {
    url = new URL(appBaseUrl.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null
  return new URL(APP_ROUTE_PATH, url.origin).toString()
}

export async function handleBridge(req: Request, deps: BridgeDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!(await bearerOk(req, deps))) return json({ error: "Unauthorized" }, 401)

  let body: { job?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: "Body must be JSON such as {\"job\":\"scheduler_bridge\"}" }, 400)
  }
  if (typeof body.job !== "string" || !(SUPPORTED_JOBS as readonly string[]).includes(body.job)) {
    return json({ error: "Unknown job", supported: SUPPORTED_JOBS }, 400)
  }

  const ranAt = deps.now().toISOString()
  const routeUrl = appRouteUrl(deps.config.appBaseUrl)
  const secret = deps.config.internalSecret
  if (!routeUrl || !secret || secret.length < 24) {
    return json({ error: "not_configured", detail: "Set the Edge Function secrets SCHEDULER_BRIDGE_APP_URL (an https origin) and SCHEDULER_BRIDGE_INTERNAL_SECRET (24 characters or more)." }, 503)
  }

  let dueRes: RpcResult
  try {
    dueRes = await deps.rpc("projexa_scheduler_bridge_due_count")
  } catch (err) {
    dueRes = { data: null, error: { message: short(err) } }
  }
  if (dueRes.error) {
    console.error("projexa-scheduler-bridge due count failed:", short(dueRes.error.message))
    return json({ error: "due_count_failed", detail: short(dueRes.error.message) }, 500)
  }
  if (typeof dueRes.data !== "number" || !Number.isFinite(dueRes.data)) {
    console.error("projexa-scheduler-bridge due count was not a number")
    return json({ error: "due_count_failed", detail: "The due count was not a number." }, 500)
  }
  const due = dueRes.data
  if (due <= 0) return json({ job: "scheduler_bridge", ranAt, due: 0, called: false })

  try {
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(deps.appTimeoutMs ?? DEFAULT_APP_TIMEOUT_MS) : undefined
    const res = await deps.fetchImpl(routeUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ trigger: "scheduler_bridge" }),
      signal,
    })
    let app: unknown = null
    try {
      app = await res.json()
    } catch {
      app = null
    }
    if (!res.ok) {
      console.error("projexa-scheduler-bridge app call refused with HTTP", res.status)
      return json({ job: "scheduler_bridge", ranAt, due, called: true, error: "app_call_failed", appStatus: res.status }, 502)
    }
    return json({ job: "scheduler_bridge", ranAt, due, called: true, appStatus: res.status, app })
  } catch (err) {
    console.error("projexa-scheduler-bridge could not reach the app:", short(err))
    return json({ job: "scheduler_bridge", ranAt, due, called: true, error: "app_unreachable", detail: short(err) }, 502)
  }
}
