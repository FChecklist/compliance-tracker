/// <reference types="bun-types" />
// FIRST-USER SELF-HEAL (drizzle/0675 + supabase/functions/ai-work-link/first-user.ts). The SQL is the REAL migration file on PGlite (real Postgres as
// WASM); the Edge-side helper runs for real with a fake fetch (the PROJEXA project) and a fake rpc that forwards to the same PGlite function.
//   * the SQL: creates the first user (admin, auth_user_id, General department) ONLY for an active, platform-provisioned org with ZERO users;
//     never for an org that has any user, a customer's own org, an inactive org, a taken email or an already-linked person; idempotent
//   * the helper: needs a PROJEXA-issued token, exactly one owned VERIDIAN org from the PROJEXA project, never an org the caller names
// Run: bun test --isolate src/lib/services/ai-work-link-first-user.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { ensureFirstUser, PROJEXA_ISSUER_FOR_HEAL } from "../../../supabase/functions/ai-work-link/first-user"
import { forwardSql, openAwlPglite } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(120_000)

const SUB = "e87962c9-067c-41b9-9472-5d7da8684f0a"
let db: PGlite

const fn = (org: string, sub: string, email: string, name: string | null = null) =>
  db.query<{ outcome: string; user_id: string | null }>("select * from public.projexa_ensure_first_user($1, $2::uuid, $3, $4)", [org, sub, email, name]).then((r) => r.rows[0])
const usersOf = (org: string) => db.query<Record<string, unknown>>("select * from compliance.users where org_id = $1", [org]).then((r) => r.rows)

beforeAll(async () => {
  db = await openAwlPglite()
  await db.exec(`
    create table compliance.organisations (id text primary key, name text, is_active boolean not null default true);
    create table compliance.api_keys (id text primary key default gen_random_uuid()::text, org_id text not null, is_active boolean not null default true, issued_for_application_id text);
    create table compliance.departments (id text primary key default gen_random_uuid()::text, org_id text not null, name text not null, created_at timestamptz not null default now());
    insert into compliance.organisations (id, name, is_active) values ('org-new', 'NEW', true), ('org-own', 'OWN', true), ('org-off', 'OFF', false), ('org-busy', 'BUSY', true), ('org-gone', 'GONE', true);
    insert into compliance.api_keys (org_id, issued_for_application_id) values ('org-new', 'app-1'), ('org-own', null), ('org-off', 'app-1'), ('org-busy', 'app-1'), ('org-gone', 'app-1');
    insert into compliance.departments (org_id, name, created_at) values ('org-new', 'Zeta', now() - interval '1 day'), ('org-new', 'General', now());
    insert into compliance.users (id, name, email, password_hash, role, is_active, org_id) values ('u-busy', 'B', 'busy@x.test', 'x', 'member', true, 'org-busy'), ('u-gone', 'G', 'gone@x.test', 'x', 'member', false, 'org-gone');
  `)
  await db.exec(forwardSql("0675_awl_first_user_self_heal"))
}, 240_000)
afterAll(async () => {
  await db.close()
})

describe("projexa_ensure_first_user (SQL)", () => {
  test("creates the first user: admin, the session id, the General department, onboarding not done; repeat is already_linked and writes nothing", async () => {
    const a = await fn("org-new", SUB, "  Sumeetds@Gmail.com ", "Sumeet")
    expect(a.outcome).toBe("created")
    const rows = await usersOf("org-new")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: a.user_id, email: "sumeetds@gmail.com", name: "Sumeet", role: "admin", auth_user_id: SUB, password_hash: "supabase-auth-managed", onboarding_completed: false, is_active: true })
    expect(rows[0].department_id).toBe((await db.query<{ id: string }>("select id from compliance.departments where org_id='org-new' and name='General'")).rows[0].id)
    const again = await fn("org-new", SUB, "sumeetds@gmail.com")
    expect(again).toEqual({ outcome: "already_linked", user_id: a.user_id })
    expect(await usersOf("org-new")).toHaveLength(1)
  })

  test("never a second person into an org that has a user (any user, active or not)", async () => {
    expect((await fn("org-new", "11111111-1111-4111-8111-111111111111", "second@x.test")).outcome).toBe("org_has_users")
    expect((await fn("org-busy", "22222222-2222-4222-8222-222222222222", "x@x.test")).outcome).toBe("org_has_users")
    expect((await fn("org-gone", "33333333-3333-4333-8333-333333333333", "y@x.test")).outcome).toBe("org_has_users")
    expect(await usersOf("org-busy")).toHaveLength(1)
    expect(await usersOf("org-gone")).toHaveLength(1)
  })

  test("not a customer's own org, not an inactive org, not an unknown org", async () => {
    for (const org of ["org-own", "org-off", "nope"]) expect((await fn(org, "44444444-4444-4444-8444-444444444444", "z@x.test")).outcome).toBe("not_eligible")
    expect(await usersOf("org-own")).toHaveLength(0)
  })

  test("a taken email and an already-linked person write nothing; bad input is refused", async () => {
    await db.exec("insert into compliance.organisations (id, name) values ('org-2', 'TWO'); insert into compliance.api_keys (org_id, issued_for_application_id) values ('org-2', 'app-1')")
    expect((await fn("org-2", "55555555-5555-4555-8555-555555555555", "busy@x.test")).outcome).toBe("email_taken")
    expect((await fn("org-2", SUB, "other@x.test")).outcome).toBe("email_taken")
    expect((await fn("org-2", "55555555-5555-4555-8555-555555555555", "not-an-email")).outcome).toBe("bad_input")
    expect(await usersOf("org-2")).toHaveLength(0)
  })

  test("only service_role may run it", async () => {
    const r = await db.query<{ role: string; ok: boolean }>("select r.rolname role, has_function_privilege(r.rolname, 'public.projexa_ensure_first_user(text,uuid,text,text)', 'execute') ok from pg_roles r where r.rolname in ('anon','authenticated','app_runtime','service_role') order by 1")
    expect(Object.fromEntries(r.rows.map((x) => [x.role, x.ok]))).toEqual({ anon: false, app_runtime: false, authenticated: false, service_role: true })
  })
})

describe("ensureFirstUser (Edge side)", () => {
  const rpcTo = (calls: unknown[][]) => async (name: string, args?: Record<string, unknown>) => {
    calls.push([name, args])
    const r = await db.query("select * from public.projexa_ensure_first_user($1, $2::uuid, $3, $4)", [args?.p_org_id, args?.p_auth_user_id, args?.p_email, args?.p_name])
    return { data: r.rows, error: null }
  }
  const fetchOwning = (ids: string[], seen: { url?: string; auth?: string } = {}) =>
    (async (url: string, init: RequestInit) => {
      seen.url = url
      seen.auth = (init.headers as Record<string, string>).Authorization
      return new Response(JSON.stringify(ids.map((veridian_org_id) => ({ veridian_org_id }))), { status: 200 })
    }) as unknown as typeof fetch
  const who = { sub: "66666666-6666-4666-8666-666666666666", email: "heal@x.test", issuer: PROJEXA_ISSUER_FOR_HEAL }
  const quiet = () => {}

  test("the org comes from the PROJEXA project with the person's own token, then the user is created", async () => {
    await db.exec("insert into compliance.organisations (id, name) values ('org-h1', 'H1'); insert into compliance.api_keys (org_id, issued_for_application_id) values ('org-h1', 'app-1')")
    const calls: unknown[][] = []
    const seen: { url?: string; auth?: string } = {}
    expect(await ensureFirstUser("tok-abc", who, { rpc: rpcTo(calls), fetch: fetchOwning(["org-h1"], seen), log: quiet })).toBe(true)
    expect(seen).toEqual({ url: "https://evpckeuxgvahguwsaeul.supabase.co/rest/v1/rpc/veridian_org_for_owner", auth: "Bearer tok-abc" })
    expect(calls).toEqual([["projexa_ensure_first_user", { p_org_id: "org-h1", p_auth_user_id: who.sub, p_email: "heal@x.test", p_name: null }]])
    expect((await usersOf("org-h1"))[0]).toMatchObject({ auth_user_id: who.sub, role: "admin" })
  })

  test("no call to SQL unless exactly one owned org, a PROJEXA-issued token and a real email", async () => {
    const calls: unknown[][] = []
    const deps = (ids: string[]) => ({ rpc: rpcTo(calls), fetch: fetchOwning(ids), log: quiet })
    expect(await ensureFirstUser("t", who, deps([]))).toBe(false)
    expect(await ensureFirstUser("t", who, deps(["org-a", "org-b"]))).toBe(false)
    expect(await ensureFirstUser("t", { ...who, issuer: "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1" }, deps(["org-new"]))).toBe(false)
    expect(await ensureFirstUser("t", { ...who, email: null }, deps(["org-new"]))).toBe(false)
    expect(await ensureFirstUser("t", who, { rpc: rpcTo(calls), fetch: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch, log: quiet })).toBe(false)
    expect(await ensureFirstUser("t", who, { rpc: rpcTo(calls), fetch: (async () => { throw new Error("down") }) as unknown as typeof fetch, log: quiet })).toBe(false)
    expect(calls).toEqual([])
  })

  test("an org that already has users is not healed: false, nothing written", async () => {
    expect(await ensureFirstUser("t", { ...who, sub: "77777777-7777-4777-8777-777777777777" }, { rpc: rpcTo([]), fetch: fetchOwning(["org-busy"]), log: quiet })).toBe(false)
    expect(await usersOf("org-busy")).toHaveLength(1)
  })
})
