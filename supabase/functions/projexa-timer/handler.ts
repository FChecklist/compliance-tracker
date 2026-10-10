// PROJEXA-BUILD-001 U-21 (PMD-12): the request handler of the projexa-timer Edge Function, with its I/O passed in (`deps`) so bun can
// run the real handler in src/lib/services/projexa-timer.test.ts. index.ts only wires Deno.serve and the service-role client.
//
// SECURITY MODEL (same as supabase/functions/dpdp-monday-email)
//   * Deployed with verify_jwt false: pg_cron sends a Vault secret, not a Supabase JWT. The bearer is checked here through
//     public.projexa_timer_check_bearer (drizzle/0615, service_role only), which compares sha256 digests against the Vault secret
//     'projexa_timer_secret' the cron reads. A missing or short bearer, an RPC error, or no secret refuses everything (fail closed).
//   * The function holds only the platform-injected service-role client. It reaches compliance.* through the two
//     public.projexa_timer_* wrappers, never through a table.
//
// JOB exchange_rate_refresh (body {"job":"exchange_rate_refresh"}, optional "dryRun":true)
//   The Vercel route /api/internal/exchange-rate-refresh/run did this once a day: for every org with a base currency, fetch the
//   provider's rates for that base and replace today's source='live' rows with both directions per other currency. Here the plan
//   (one entry per org) comes from projexa_timer_exchange_plan, the provider is called once per distinct base code, and the rows
//   are written by projexa_timer_apply_exchange_rates. One org's or one base's failure never blocks the rest. Idempotent per
//   (org, day): the apply function deletes and re-inserts only that day's source='live' rows and never touches a manual rate.
import { EXCHANGE_RATE_FEED_BASE, ExchangeRateFeedError, buildLiveRatePairs, parseFeedBody, type CurrencyRef, type LiveRatesResult } from "./rates.ts"

export type RpcResult = { data: unknown; error: { message: string } | null }

export type TimerDeps = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
  fetchImpl: (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  now: () => Date
  feedTimeoutMs?: number
}

export const SUPPORTED_JOBS = ["exchange_rate_refresh"] as const

type PlanEntry = { orgId: string; baseId: string; baseCode: string; others: CurrencyRef[] }

type Failure = { orgId: string | null; error: string }

export type ExchangeRefreshSummary = {
  job: "exchange_rate_refresh"
  ranAt: string
  rateDate: string
  dryRun: boolean
  orgsRefreshed: number
  orgsSkipped: number
  orgsFailed: number
  totalRatesRefreshed: number
  failures: Failure[]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function short(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.length > 300 ? m.slice(0, 300) : m
}

async function bearerOk(req: Request, deps: TimerDeps): Promise<boolean> {
  const header = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  const presented = m?.[1]?.trim() ?? ""
  if (presented.length < 24) return false
  try {
    const { data, error } = await deps.rpc("projexa_timer_check_bearer", { p_bearer: presented })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

async function fetchFeed(code: string, deps: TimerDeps): Promise<LiveRatesResult> {
  const upper = code.trim().toUpperCase()
  if (!upper) throw new ExchangeRateFeedError("A base currency code is required to fetch live exchange rates")
  let res: Awaited<ReturnType<TimerDeps["fetchImpl"]>>
  try {
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(deps.feedTimeoutMs ?? 20000) : undefined
    res = await deps.fetchImpl(`${EXCHANGE_RATE_FEED_BASE}/${encodeURIComponent(upper)}`, { headers: { Accept: "application/json" }, signal })
  } catch (err) {
    throw new ExchangeRateFeedError(`Could not reach the exchange-rate feed (open.er-api.com) for base ${upper}: ${short(err)}`)
  }
  if (!res.ok) throw new ExchangeRateFeedError(`Exchange-rate feed returned HTTP ${res.status} for base ${upper} -- cannot refresh live rates`)
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new ExchangeRateFeedError(`Exchange-rate feed returned a non-JSON body for base ${upper}`)
  }
  return parseFeedBody(upper, (data ?? {}) as Parameters<typeof parseFeedBody>[1])
}

function readPlan(data: unknown): PlanEntry[] {
  if (!Array.isArray(data)) throw new Error("projexa_timer_exchange_plan returned something other than an array")
  return data.map((row) => {
    const r = row as Partial<PlanEntry>
    if (typeof r.orgId !== "string" || typeof r.baseId !== "string" || typeof r.baseCode !== "string" || !Array.isArray(r.others)) {
      throw new Error("projexa_timer_exchange_plan returned a malformed entry")
    }
    return { orgId: r.orgId, baseId: r.baseId, baseCode: r.baseCode, others: r.others as CurrencyRef[] }
  })
}

export async function runExchangeRateRefresh(deps: TimerDeps, dryRun: boolean): Promise<ExchangeRefreshSummary> {
  const now = deps.now()
  const rateDate = now.toISOString().slice(0, 10)
  const summary: ExchangeRefreshSummary = {
    job: "exchange_rate_refresh", ranAt: now.toISOString(), rateDate, dryRun,
    orgsRefreshed: 0, orgsSkipped: 0, orgsFailed: 0, totalRatesRefreshed: 0, failures: [],
  }

  const planRes = await deps.rpc("projexa_timer_exchange_plan")
  if (planRes.error) throw new Error(`projexa_timer_exchange_plan failed: ${planRes.error.message}`)
  const plan = readPlan(planRes.data)

  // One provider call per distinct base code, made only when some org with that base has another currency to price.
  const feed = new Map<string, { live?: LiveRatesResult; error?: string }>()
  for (const entry of plan) {
    if (entry.others.length === 0) continue
    const code = entry.baseCode.trim().toUpperCase()
    if (feed.has(code)) continue
    try {
      feed.set(code, { live: await fetchFeed(code, deps) })
    } catch (err) {
      feed.set(code, { error: short(err) })
    }
  }

  for (const entry of plan) {
    if (entry.others.length === 0) { summary.orgsSkipped++; continue }
    const code = entry.baseCode.trim().toUpperCase()
    const got = feed.get(code)
    if (!got || !got.live) {
      summary.orgsFailed++
      summary.failures.push({ orgId: entry.orgId, error: got?.error ?? "no feed result" })
      continue
    }
    try {
      const { pairs } = buildLiveRatePairs({ id: entry.baseId, code: entry.baseCode }, entry.others, got.live, rateDate)
      if (!dryRun) {
        const applied = await deps.rpc("projexa_timer_apply_exchange_rates", { p_org_id: entry.orgId, p_rate_date: rateDate, p_pairs: pairs })
        if (applied.error) throw new Error(applied.error.message)
      }
      summary.orgsRefreshed++
      summary.totalRatesRefreshed += pairs.length
    } catch (err) {
      summary.orgsFailed++
      summary.failures.push({ orgId: entry.orgId, error: short(err) })
    }
  }
  return summary
}

export async function handleTimer(req: Request, deps: TimerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!(await bearerOk(req, deps))) return json({ error: "Unauthorized" }, 401)

  let body: { job?: unknown; dryRun?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: "Body must be JSON such as {\"job\":\"exchange_rate_refresh\"}" }, 400)
  }
  if (typeof body.job !== "string" || !(SUPPORTED_JOBS as readonly string[]).includes(body.job)) {
    return json({ error: "Unknown job", supported: SUPPORTED_JOBS }, 400)
  }

  try {
    const summary = await runExchangeRateRefresh(deps, body.dryRun === true)
    return json(summary)
  } catch (err) {
    console.error("projexa-timer exchange_rate_refresh failed:", short(err))
    return json({ error: "exchange_rate_refresh failed", detail: short(err) }, 500)
  }
}
