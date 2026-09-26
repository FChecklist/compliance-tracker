// PROJEXA-BUILD-002 WP-08 (register rows AW-401 to AW-404 and AW-406): the shared setup of the mint-route tests
// (ai-work-link-mint.test.ts, -links, -mint-limits, -warning, -shell-project). Everything that decides an answer is REAL: the handler
// (supabase/functions/ai-work-link/handler.ts and mint.ts), the token verifier with the real jose package and real ES256 key pairs, and the
// SQL of drizzle/0618, 0621 to 0628 and 0631 on PGlite (real Postgres as WASM). Only the failure cases are faked, by wrapping the same rpc
// so one function errors, throws or answers a shape nobody knows.
//
// The database is the one of awl-pglite.ts plus what these routes read: compliance.products (a live table the base snapshot leaves out,
// because no function before 0631 reads it) and the fixture below.
import type { PGlite } from "@electric-sql/pglite"
import * as jose from "jose"
import { configFromEnv } from "../../../../supabase/functions/ai-work-link/config"
import { handleAwl } from "../../../../supabase/functions/ai-work-link/handler"
import { PROJEXA_ISSUER, VERIDIAN_ISSUER } from "../../../../supabase/functions/ai-work-link/jwt"
import { resetMintLimits } from "../../../../supabase/functions/ai-work-link/mint"
import type { AwlConfig, Rpc, RpcResult } from "../../../../supabase/functions/ai-work-link/reads"
import { createSessionVerifier, type JoseLike, type KeyResolver } from "../../../../supabase/functions/ai-work-link/session"
import { createAwlDb, forwardSql } from "./awl-pglite"

export type J = Record<string, any>

export const F = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"
export const MINT_MIGRATION = "0631_build001_awl_mint_for"

/** Supabase Auth user ids of the people below. `email` has no auth_user_id at all: only the gateway's e-mail fallback can find them. */
export const AUTH = {
  mgr: "11111111-1111-4111-8111-111111111111",
  mem: "22222222-2222-4222-8222-222222222222",
  adm: "33333333-3333-4333-8333-333333333333",
  b: "44444444-4444-4444-8444-444444444444",
  view: "55555555-5555-4555-8555-555555555555",
  sen: "66666666-6666-4666-8666-666666666666",
  off: "77777777-7777-4777-8777-777777777777",
  nobody: "88888888-8888-4888-8888-888888888888",
  email: "99999999-9999-4999-8999-999999999999",
}

const FIXTURE_SQL = `
create table if not exists compliance.products (
  id text primary key default (gen_random_uuid())::text, org_id text not null, name text not null, slug text not null, description text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into compliance.products (id, org_id, name, slug, created_at) values
  ('prod',   'org-a', 'Interiors',  'interiors', '2026-01-01T00:00:00Z'),
  ('prod-2', 'org-a', 'Fit-out',    'fit-out',   '2026-02-01T00:00:00Z'),
  ('prod-b', 'org-b', 'Tower work', 'tower',     '2026-01-01T00:00:00Z');
insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
  ('u-mgr',   'Mira Manager', 'mira@a.example.test',  'x', 'manager', true,  'org-a', '${AUTH.mgr}'),
  ('u-mem',   'Mo Member',    'mo@a.example.test',    'x', 'member',  true,  'org-a', '${AUTH.mem}'),
  ('u-adm',   'Ada Admin',    'ada@a.example.test',   'x', 'admin',   true,  'org-a', '${AUTH.adm}'),
  ('u-view',  'Vic Viewer',   'vic@a.example.test',   'x', 'viewer',  true,  'org-a', '${AUTH.view}'),
  ('u-sen',   'Sam Senior',   'sam@a.example.test',   'x', 'senior_professional', true, 'org-a', '${AUTH.sen}'),
  ('u-off',   'Off Member',   'off@a.example.test',   'x', 'member',  false, 'org-a', '${AUTH.off}'),
  ('u-email', 'Eli Email',    'eli@a.example.test',   'x', 'manager', true,  'org-a', null),
  ('u-b',     'Bo Manager',   'bo@b.example.test',    'x', 'manager', true,  'org-b', '${AUTH.b}');
insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level) values
  ('proj-a',    'prod',   'org-a', 'Villa A',  'u-mgr', 'public'),
  ('proj-a2',   'prod',   'org-a', 'Villa A2', 'u-sen', 'public'),
  ('proj-priv', 'prod',   'org-a', 'Secret A', 'u-sen', 'private'),
  ('proj-b',    'prod-b', 'org-b', 'Tower B',  'u-b',   'public');
insert into compliance.construction_boqs (id, org_id, project_id, version, title, created_by_id, contract_value_override) values
  ('boq-a1', 'org-a', 'proj-a', 1, 'A original', 'u-mgr', 5000);
insert into compliance.construction_boq_line_items (id, boq_id, org_id, description, unit, quantity, rate, amount, item_code, category, material_cost, labour_cost, equipment_cost, budget_percentage, vendor_amount, material_amount, manpower_amount, rate_project, rate_contract) values
  ('la-1', 'boq-a1', 'org-a', 'A line 1', 'm3', 2, 10, 20, '1.01', 'civil', 4, 5, 1, 10, 3, 2, 1, 7, 9),
  ('la-2', 'boq-a1', 'org-a', 'A line 2', 'm3', 3, 11, 33, '1.02', 'civil', 4, 5, 1, 20, 3, 2, 1, 8, 10);
insert into compliance.pms_issues (id, org_id, project_id, type_id, status_id, number, title, description, assignee_id, created_by_id, priority) values
  ('is-1', 'org-a', 'proj-a', 'ty', 'st-open', 1, 'Set out', 'd1', 'u-mem', 'u-mgr', 'high'),
  ('is-2', 'org-a', 'proj-a', 'ty', 'st-open', 2, 'Shuttering', 'd2', 'u-mem', 'u-mgr', 'low'),
  ('is-3', 'org-a', 'proj-a', 'ty', 'st-done', 3, 'Cure', 'd3', 'u-mem', 'u-mem', 'medium');
`

/** A database with 0618, 0621 to 0628, 0631 and the fixture. Writes are OFF (the migrations' own default). */
export async function openMintDb(): Promise<PGlite> {
  const db = await createAwlDb("0628")
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(FIXTURE_SQL)
  await db.exec(forwardSql(MINT_MIGRATION))
  return db
}

export const one = async <T = J>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0]

// ---------------------------------------------------------------------------------------------------------------------------------- keys
type Pair = { privateKey: CryptoKey; publicKey: CryptoKey }
const KID = "test-key"
const newPair = async () => (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as Pair

async function localSet(pair: Pair): Promise<KeyResolver> {
  const jwk = await jose.exportJWK(pair.publicKey)
  return jose.createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] }) as unknown as KeyResolver
}

export type SignOpts = { sub?: string; iss?: string; iatAgoSeconds?: number; noIat?: boolean; email?: string | null; key?: "projexa" | "veridian" | "stranger" }

const brokenKey: KeyResolver = async () => {
  throw Object.assign(new Error("timeout"), { code: "ERR_JWKS_TIMEOUT" })
}

export type Harness = {
  db: PGlite
  /** Signs a session token as the PROJEXA (default) or verdian-ai Auth project. `iatAgoSeconds` sets how old it is (default 60). */
  sign: (o?: SignOpts) => Promise<string>
  /** One request through the REAL handler. */
  call: (method: string, path: string, o?: CallOpts) => Promise<Answer>
  setWrites: (on: boolean) => Promise<unknown>
  sqlCalls: () => string[]
  logs: () => string[]
  bodies: () => string[]
  reset: () => void
}

export type CallOpts = {
  token?: string | null
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
  /** Wraps the real rpc: a function name mapped to a replacement. */
  over?: Partial<Record<string, (args: Record<string, unknown>) => Promise<RpcResult>>>
  now?: () => number
  config?: AwlConfig
  session?: "real" | "none"
  /** The PROJEXA key set cannot be read (a timeout): the verifier must answer unavailable, not invalid. */
  brokenKeyset?: boolean
}

export type Answer = { res: Response; json: J; text: string }

export async function makeHarness(db: PGlite): Promise<Harness> {
  const projexa = await newPair()
  const veridian = await newPair()
  const stranger = await newPair()
  const keys: Record<string, KeyResolver> = { [PROJEXA_ISSUER]: await localSet(projexa), [VERIDIAN_ISSUER]: await localSet(veridian) }
  const joseLike = jose as unknown as JoseLike
  let sqlCallsSeen: string[] = []
  let logLines: string[] = []
  let bodiesSeen: string[] = []

  /** The same call the service-role client makes: a public function with named arguments. */
  const realRpc: Rpc = async (fn, args = {}) => {
    sqlCallsSeen.push(fn)
    const names = Object.keys(args)
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}${Array.isArray(args[n]) ? "::text[]" : ""}`).join(", ")})`
    try {
      if (fn === "projexa_read_resolve_user") {
        const r = await db.query(`select * from ${call}`, names.map((n) => args[n]))
        return { data: r.rows, error: null }
      }
      const r = await db.query<{ r: unknown }>(`select ${call} as r`, names.map((n) => args[n]))
      return { data: r.rows[0]?.r ?? null, error: null }
    } catch (e) {
      const err = e as { message?: string; code?: string }
      return { data: null, error: { message: String(err.message ?? e), code: err.code } }
    }
  }

  const sign = async (o: SignOpts = {}): Promise<string> => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const jwt = new jose.SignJWT({ role: "authenticated", ...(o.email === null ? {} : { email: o.email ?? "person@example.test" }) })
      .setProtectedHeader({ alg: "ES256", kid: KID })
      .setIssuer(o.iss ?? PROJEXA_ISSUER)
      .setAudience("authenticated")
      .setSubject(o.sub ?? AUTH.mgr)
      .setExpirationTime(nowSeconds + 3600)
    if (!o.noIat) jwt.setIssuedAt(nowSeconds - (o.iatAgoSeconds ?? 60))
    const pair = o.key === "veridian" ? veridian : o.key === "stranger" ? stranger : projexa
    return jwt.sign(pair.privateKey)
  }

  const call: Harness["call"] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...(o.body !== undefined || o.rawBody !== undefined ? { "content-type": "application/json" } : {}), ...(o.headers ?? {}) }
    if (o.token) headers.authorization = `Bearer ${o.token}`
    const over = o.over ?? {}
    const rpc: Rpc = async (fn, args = {}) => {
      const f = over[fn]
      if (f) {
        sqlCallsSeen.push(fn)
        return f(args)
      }
      return realRpc(fn, args)
    }
    const init: RequestInit = { method, headers }
    if (method !== "GET" && method !== "HEAD") init.body = o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body))
    const res = await handleAwl(new Request(`${F}${path}`, init), {
      config: o.config ?? configFromEnv(() => undefined),
      rpc,
      ...(o.session === "none"
        ? {}
        : { session: createSessionVerifier({ jose: joseLike, keys: o.brokenKeyset ? { ...keys, [PROJEXA_ISSUER]: brokenKey } : keys }) }),
      log: (l) => logLines.push(l),
      now: o.now,
    })
    const text = await res.text()
    bodiesSeen.push(text)
    let json: J = {}
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON
    }
    return { res, json, text }
  }

  return {
    db, sign, call,
    setWrites: (on) => db.exec(`update platform.ai_work_link_settings set writes_enabled = ${on}`),
    sqlCalls: () => sqlCallsSeen,
    logs: () => logLines,
    bodies: () => bodiesSeen,
    reset: () => {
      sqlCallsSeen = []
      logLines = []
      bodiesSeen = []
      resetMintLimits()
    },
  }
}

/** Every row of the person's links, straight from the table (never through a route), token columns included so a test can prove they are empty. */
export const linkRows = (db: PGlite, userId: string) =>
  db.query<J>("select id, user_id, project_id, status, token, token_hash, authority_level, allowed_functions, label, expires_at, created_at from platform.user_ai_links where user_id = $1 and product = 'projexa' order by created_at, id", [userId]).then((r) => r.rows)
