/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-21 (PMD-12): the exchange-rate refresh that moves off the Vercel cron. Three proofs, none touching a live
// database or the network:
//   1. PARITY: the Edge Function's rate maths (supabase/functions/projexa-timer/rates.ts) gives the same rows as the Vercel path's
//      buildLiveRatePairs (src/lib/exchange-rate-feed-client.ts) for the same feed, so the two cannot drift apart unnoticed.
//   2. HANDLER: the real request handler (handler.ts) with its RPC and fetch passed in: bearer refusal, job dispatch, one provider
//      call per base code, per-org failure isolation, dry run.
//   3. SQL on PGlite (real Postgres as WASM): drizzle/0615_build001_projexa_timer.sql and its down file, against the live shape of
//      compliance.erp_currencies and compliance.erp_exchange_rates (read from the live database 2026-09-25): the plan, the apply
//      (idempotent per org and day, never touches a manual rate, refuses another org's currency), the bearer check against a
//      stand-in vault view, the grants, and the down file.
// Lives under src/ because bunfig.toml sets [test] root = "src". Run: bun test --isolate src/lib/services/projexa-timer.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { buildLiveRatePairs as vercelBuildLiveRatePairs } from "@/lib/exchange-rate-feed-client"
import { buildLiveRatePairs, formatRate, parseFeedBody, ExchangeRateFeedError } from "../../../supabase/functions/projexa-timer/rates"
import { handleTimer, type TimerDeps, type RpcResult } from "../../../supabase/functions/projexa-timer/handler"

const REPO_ROOT = new URL("../../../", import.meta.url)
const FORWARD = readFileSync(new URL("drizzle/0615_build001_projexa_timer.sql", REPO_ROOT), "utf8")
const DOWN = readFileSync(new URL("drizzle/down/0615_build001_projexa_timer.down.sql", REPO_ROOT), "utf8")

// ------------------------------------------------------------------------------------------------ 1. parity
describe("rates.ts matches the Vercel path's buildLiveRatePairs", () => {
  const base = { id: "cur-aed", code: "AED" }
  const others = [
    { id: "cur-usd", code: "usd" },
    { id: "cur-inr", code: " INR " },
    { id: "cur-xxx", code: "XXX" },
    { id: "cur-zero", code: "ZZZ" },
    { id: "cur-nan", code: "NAN" },
    { id: "cur-none", code: "" },
  ]
  const live = { baseCode: "AED", rates: { USD: 0.2723, INR: 22.7, ZZZ: 0, NAN: Number.NaN }, lastUpdatedUtc: "Fri, 25 Sep 2026 00:02:31 +0000" }

  test("same pairs and same skipped list for the same feed", () => {
    expect(buildLiveRatePairs(base, others, live, "2026-09-25")).toEqual(vercelBuildLiveRatePairs(base, others, live, "2026-09-25"))
  })

  test("both directions per covered currency, inverse at 10 decimal places", () => {
    const { pairs, skipped } = buildLiveRatePairs(base, [others[0]], live, "2026-09-25")
    expect(pairs).toEqual([
      { fromCurrencyId: "cur-aed", toCurrencyId: "cur-usd", rate: "0.2723000000", rateDate: "2026-09-25" },
      { fromCurrencyId: "cur-usd", toCurrencyId: "cur-aed", rate: formatRate(1 / 0.2723), rateDate: "2026-09-25" },
    ])
    expect(skipped).toEqual([])
  })

  test("a currency the feed omits, a zero rate and a NaN rate are skipped with a reason, never inserted", () => {
    const { pairs, skipped } = buildLiveRatePairs(base, others, live, "2026-09-25")
    expect(pairs.length).toBe(4)
    expect(skipped.map((s) => s.code)).toEqual(["XXX", "ZZZ", "NAN", "cur-none"])
  })

  test("parseFeedBody refuses a provider error and a body with no rates", () => {
    expect(() => parseFeedBody("AED", { result: "error", "error-type": "unsupported-code" })).toThrow("unsupported-code")
    expect(() => parseFeedBody("AED", { result: "success" })).toThrow(ExchangeRateFeedError)
    expect(parseFeedBody("AED", { result: "success", rates: { USD: 1 }, base_code: "AED" }).baseCode).toBe("AED")
  })
})

// ------------------------------------------------------------------------------------------------ 2. handler
const BEARER = "b".repeat(48)
const NOW = new Date("2026-09-25T09:30:00.000Z")

type Call = { fn: string; args?: Record<string, unknown> }

function makeDeps(opts: {
  plan?: unknown
  planError?: string
  bearerOk?: boolean | "error"
  applyError?: (orgId: string) => string | null
  feed?: (url: string) => { ok: boolean; status: number; body: unknown }
}): { deps: TimerDeps; calls: Call[]; fetched: string[] } {
  const calls: Call[] = []
  const fetched: string[] = []
  const deps: TimerDeps = {
    now: () => NOW,
    rpc: async (fn, args): Promise<RpcResult> => {
      calls.push({ fn, args })
      if (fn === "projexa_timer_check_bearer") {
        if (opts.bearerOk === "error") return { data: null, error: { message: "rpc down" } }
        return { data: opts.bearerOk !== false, error: null }
      }
      if (fn === "projexa_timer_exchange_plan") {
        return opts.planError ? { data: null, error: { message: opts.planError } } : { data: opts.plan ?? [], error: null }
      }
      if (fn === "projexa_timer_apply_exchange_rates") {
        const err = opts.applyError?.(String(args?.p_org_id))
        return err ? { data: null, error: { message: err } } : { data: (args?.p_pairs as unknown[]).length, error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
    fetchImpl: async (url) => {
      fetched.push(url)
      const r = opts.feed?.(url) ?? { ok: true, status: 200, body: { result: "success", base_code: url.split("/").pop(), rates: { USD: 0.27, INR: 22.7 } } }
      return { ok: r.ok, status: r.status, json: async () => r.body }
    },
  }
  return { deps, calls, fetched }
}

function req(init: { method?: string; auth?: string | null; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (init.auth !== null) headers.Authorization = init.auth ?? `Bearer ${BEARER}`
  return new Request("https://example.test/functions/v1/projexa-timer", {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? JSON.stringify({ job: "exchange_rate_refresh" }) : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  })
}

const PLAN = [
  { orgId: "org-1", baseId: "c1-aed", baseCode: "AED", others: [{ id: "c1-usd", code: "USD" }, { id: "c1-inr", code: "INR" }] },
  { orgId: "org-2", baseId: "c2-aed", baseCode: "AED", others: [{ id: "c2-usd", code: "USD" }] },
  { orgId: "org-3", baseId: "c3-inr", baseCode: "INR", others: [] },
]

describe("handleTimer", () => {
  test("only POST is accepted", async () => {
    const { deps, calls } = makeDeps({})
    expect((await handleTimer(req({ method: "GET", body: "" }), deps)).status).toBe(405)
    expect(calls).toEqual([])
  })

  test("no bearer, a short bearer, a refused bearer and an RPC error all give 401 and never reach the plan", async () => {
    for (const [auth, bearerOk] of [[null, true], ["Bearer short", true], [undefined, false], [undefined, "error"]] as const) {
      const { deps, calls } = makeDeps({ plan: PLAN, bearerOk })
      const res = await handleTimer(req({ auth }), deps)
      expect(res.status).toBe(401)
      expect(calls.some((c) => c.fn === "projexa_timer_exchange_plan")).toBe(false)
    }
  })

  test("a body that is not JSON, and an unknown job, give 400", async () => {
    const { deps } = makeDeps({ plan: PLAN })
    expect((await handleTimer(req({ body: "not json" }), deps)).status).toBe(400)
    const unknown = await handleTimer(req({ body: { job: "legal_clocks" } }), deps)
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { supported: string[] }).supported).toEqual(["exchange_rate_refresh"])
  })

  test("one provider call per base code that has something to price, one apply per org, and the summary adds up", async () => {
    const { deps, calls, fetched } = makeDeps({ plan: PLAN })
    const res = await handleTimer(req(), deps)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(fetched).toEqual(["https://open.er-api.com/v6/latest/AED"])
    const applies = calls.filter((c) => c.fn === "projexa_timer_apply_exchange_rates")
    expect(applies.map((c) => [c.args?.p_org_id, c.args?.p_rate_date, (c.args?.p_pairs as unknown[]).length])).toEqual([
      ["org-1", "2026-09-25", 4],
      ["org-2", "2026-09-25", 2],
    ])
    expect(body).toMatchObject({ job: "exchange_rate_refresh", rateDate: "2026-09-25", dryRun: false, orgsRefreshed: 2, orgsSkipped: 1, orgsFailed: 0, totalRatesRefreshed: 6, failures: [] })
    expect(JSON.stringify(body)).not.toContain(BEARER)
  })

  test("dryRun fetches and counts but writes nothing", async () => {
    const { deps, calls } = makeDeps({ plan: PLAN })
    const body = (await (await handleTimer(req({ body: { job: "exchange_rate_refresh", dryRun: true } }), deps)).json()) as Record<string, unknown>
    expect(calls.filter((c) => c.fn === "projexa_timer_apply_exchange_rates")).toEqual([])
    expect(body).toMatchObject({ dryRun: true, orgsRefreshed: 2, totalRatesRefreshed: 6 })
  })

  test("a failing provider for one base fails only the orgs on that base", async () => {
    const plan = [...PLAN, { orgId: "org-4", baseId: "c4-inr", baseCode: "INR", others: [{ id: "c4-usd", code: "USD" }] }]
    const { deps } = makeDeps({ plan, feed: (url) => (url.endsWith("/INR") ? { ok: false, status: 503, body: {} } : { ok: true, status: 200, body: { result: "success", rates: { USD: 0.27, INR: 22.7 } } }) })
    const body = (await (await handleTimer(req(), deps)).json()) as { orgsRefreshed: number; orgsFailed: number; failures: Array<{ orgId: string; error: string }> }
    expect(body.orgsRefreshed).toBe(2)
    expect(body.orgsFailed).toBe(1)
    expect(body.failures[0].orgId).toBe("org-4")
    expect(body.failures[0].error).toContain("HTTP 503")
  })

  test("one org's apply error does not stop the next org", async () => {
    const { deps, calls } = makeDeps({ plan: PLAN, applyError: (orgId) => (orgId === "org-1" ? "pairs name a currency outside the org" : null) })
    const body = (await (await handleTimer(req(), deps)).json()) as { orgsRefreshed: number; orgsFailed: number; failures: Array<{ orgId: string }> }
    expect(body.orgsFailed).toBe(1)
    expect(body.orgsRefreshed).toBe(1)
    expect(body.failures[0].orgId).toBe("org-1")
    expect(calls.filter((c) => c.fn === "projexa_timer_apply_exchange_rates").length).toBe(2)
  })

  test("a plan RPC error is a 500, not a silent empty run", async () => {
    const { deps } = makeDeps({ planError: "permission denied" })
    const res = await handleTimer(req(), deps)
    expect(res.status).toBe(500)
  })
})

// ------------------------------------------------------------------------------------------------ 3. SQL on PGlite
const BASE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA compliance;
CREATE SCHEMA vault;

-- Stand-in for Supabase Vault's view (the real one is a view over vault.secrets).
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz NOT NULL DEFAULT now());

-- compliance.erp_currencies and compliance.erp_exchange_rates as they are live (2026-09-25); the org FKs point at a stub.
CREATE TABLE compliance.organisations (id text PRIMARY KEY);
CREATE TABLE compliance.erp_currencies (
  id text NOT NULL DEFAULT (gen_random_uuid())::text PRIMARY KEY,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  code text NOT NULL,
  name text NOT NULL,
  symbol text,
  is_base_currency boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE compliance.erp_exchange_rates (
  id text NOT NULL DEFAULT (gen_random_uuid())::text PRIMARY KEY,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  from_currency_id text NOT NULL REFERENCES compliance.erp_currencies(id),
  to_currency_id text NOT NULL REFERENCES compliance.erp_currencies(id),
  rate numeric NOT NULL,
  rate_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual'
);
`

const SEED_SQL = `
INSERT INTO compliance.organisations (id) VALUES ('org-a'), ('org-b'), ('org-c');
INSERT INTO compliance.erp_currencies (id, org_id, code, name, is_base_currency, created_at) VALUES
  ('a-aed', 'org-a', 'AED', 'Dirham', true,  '2026-01-01T00:00:00Z'),
  ('a-usd', 'org-a', 'USD', 'Dollar', false, '2026-01-02T00:00:00Z'),
  ('a-inr', 'org-a', 'INR', 'Rupee',  false, '2026-01-03T00:00:00Z'),
  ('b-inr', 'org-b', 'INR', 'Rupee',  true,  '2026-01-01T00:00:00Z'),
  ('c-aed', 'org-c', 'AED', 'Dirham', false, '2026-01-01T00:00:00Z');
`

async function one<T = Record<string, unknown>>(db: PGlite, sql: string): Promise<T> {
  const r = await db.query<T>(sql)
  return r.rows[0]
}

describe("drizzle/0615 on PGlite", () => {
  let db: PGlite
  const LIVE = { baseCode: "AED", rates: { USD: 0.2723, INR: 22.7 }, lastUpdatedUtc: "" }
  const pairsA = () => buildLiveRatePairs({ id: "a-aed", code: "AED" }, [{ id: "a-usd", code: "USD" }, { id: "a-inr", code: "INR" }], LIVE, "2026-09-25").pairs

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(BASE_SQL)
    await db.exec(SEED_SQL)
  })
  afterAll(async () => {
    await db.close()
  })

  test("the forward file applies, and a second run changes nothing", async () => {
    await db.exec(FORWARD)
    await db.exec(FORWARD)
    const r = await one<{ n: number }>(db, "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_timer\\_%'")
    expect(r.n).toBe(3)
  })

  test("the three functions are SECURITY DEFINER, service_role only, with an empty search_path (guard G-5 is 0)", async () => {
    const r = await one<{ definers: number; anon: number; auth: number; svc: number; pinned: number }>(
      db,
      `select count(*) filter (where p.prosecdef)::int definers,
              count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::int anon,
              count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::int auth,
              count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE'))::int svc,
              count(*) filter (where array_to_string(p.proconfig, ',') = 'search_path=""')::int pinned
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'projexa\\_timer\\_%'`,
    )
    expect(r).toEqual({ definers: 3, anon: 0, auth: 0, svc: 3, pinned: 3 })
  })

  test("projexa_timer_check_bearer: false with no secret, false for a wrong or short bearer, true only for the secret", async () => {
    const secret = "s".repeat(48)
    expect((await one<{ ok: boolean }>(db, `select public.projexa_timer_check_bearer('${secret}') ok`)).ok).toBe(false)
    await db.exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('dpdp_timer_secret', '${secret}')`)
    expect((await one<{ ok: boolean }>(db, `select public.projexa_timer_check_bearer('${secret}') ok`)).ok).toBe(false) // the DPDP secret is not PROJEXA's
    await db.exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('projexa_timer_secret', '${secret}')`)
    expect((await one<{ ok: boolean }>(db, `select public.projexa_timer_check_bearer('${secret}') ok`)).ok).toBe(true)
    expect((await one<{ ok: boolean }>(db, `select public.projexa_timer_check_bearer('${"x".repeat(48)}') ok`)).ok).toBe(false)
    expect((await one<{ ok: boolean }>(db, `select public.projexa_timer_check_bearer('short') ok`)).ok).toBe(false)
    expect((await one<{ ok: boolean }>(db, `select public.projexa_timer_check_bearer(null) ok`)).ok).toBe(false)
  })

  test("projexa_timer_exchange_plan: one entry per org that has a base, its other currencies sorted, orgs without a base left out", async () => {
    const plan = (await one<{ plan: Array<{ orgId: string; baseId: string; baseCode: string; others: Array<{ id: string; code: string }> }> }>(db, "select public.projexa_timer_exchange_plan() plan")).plan
    expect(plan.map((e) => e.orgId)).toEqual(["org-a", "org-b"])
    expect(plan[0]).toEqual({ orgId: "org-a", baseId: "a-aed", baseCode: "AED", others: [{ id: "a-inr", code: "INR" }, { id: "a-usd", code: "USD" }] })
    expect(plan[1].others).toEqual([])
  })

  test("projexa_timer_apply_exchange_rates writes both directions as source live, and re-running the same day changes nothing", async () => {
    const args = (pairs: unknown) => `select public.projexa_timer_apply_exchange_rates('org-a', '2026-09-25', '${JSON.stringify(pairs)}'::jsonb) n`
    expect((await one<{ n: number }>(db, args(pairsA()))).n).toBe(4)
    expect((await one<{ n: number }>(db, args(pairsA()))).n).toBe(4)
    const rows = await db.query<{ from_currency_id: string; to_currency_id: string; rate: string; source: string }>(
      "select from_currency_id, to_currency_id, rate::text, source from compliance.erp_exchange_rates where org_id = 'org-a' and rate_date = '2026-09-25' order by from_currency_id, to_currency_id",
    )
    expect(rows.rows.length).toBe(4)
    expect(rows.rows.every((r) => r.source === "live")).toBe(true)
    expect(rows.rows.find((r) => r.from_currency_id === "a-aed" && r.to_currency_id === "a-usd")?.rate).toBe("0.2723000000")
  })

  test("a manual rate and another day's live rows are never touched", async () => {
    await db.exec(`insert into compliance.erp_exchange_rates (org_id, from_currency_id, to_currency_id, rate, rate_date, source) values
      ('org-a', 'a-aed', 'a-usd', 0.5, '2026-09-25', 'manual'), ('org-a', 'a-aed', 'a-usd', 0.3, '2026-09-24', 'live')`)
    await db.exec(`select public.projexa_timer_apply_exchange_rates('org-a', '2026-09-25', '${JSON.stringify(pairsA())}'::jsonb)`)
    const manual = await one<{ n: number }>(db, "select count(*)::int n from compliance.erp_exchange_rates where source = 'manual' and rate_date = '2026-09-25'")
    const yesterday = await one<{ n: number }>(db, "select count(*)::int n from compliance.erp_exchange_rates where source = 'live' and rate_date = '2026-09-24'")
    expect(manual.n).toBe(1)
    expect(yesterday.n).toBe(1)
  })

  test("a pair naming another org's currency, a non-positive rate, or a non-array is refused and changes nothing", async () => {
    const before = await one<{ n: number }>(db, "select count(*)::int n from compliance.erp_exchange_rates")
    const bad = [
      JSON.stringify([{ fromCurrencyId: "a-aed", toCurrencyId: "b-inr", rate: "1", rateDate: "2026-09-25" }]),
      JSON.stringify([{ fromCurrencyId: "a-aed", toCurrencyId: "a-usd", rate: "0", rateDate: "2026-09-25" }]),
      JSON.stringify({ not: "an array" }),
    ]
    for (const b of bad) {
      await expect(db.query(`select public.projexa_timer_apply_exchange_rates('org-a', '2026-09-25', '${b}'::jsonb)`)).rejects.toThrow()
    }
    const after = await one<{ n: number }>(db, "select count(*)::int n from compliance.erp_exchange_rates")
    expect(after.n).toBe(before.n)
  })

  test("an empty pair list only clears that day's live rows (the org's currencies all skipped by the feed)", async () => {
    expect((await one<{ n: number }>(db, "select public.projexa_timer_apply_exchange_rates('org-a', '2026-09-25', '[]'::jsonb) n")).n).toBe(0)
    const live = await one<{ n: number }>(db, "select count(*)::int n from compliance.erp_exchange_rates where org_id = 'org-a' and rate_date = '2026-09-25' and source = 'live'")
    expect(live.n).toBe(0)
  })

  test("the down file removes the three functions, is safe to run twice, and the forward file applies again", async () => {
    await db.exec(DOWN)
    await db.exec(DOWN)
    const gone = await one<{ n: number }>(db, "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_timer\\_%'")
    expect(gone.n).toBe(0)
    const kept = await one<{ n: number }>(db, "select count(*)::int n from compliance.erp_exchange_rates where source = 'manual'")
    expect(kept.n).toBe(1)
    await db.exec(FORWARD)
    const back = await one<{ n: number }>(db, "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_timer\\_%'")
    expect(back.n).toBe(3)
  })
})
