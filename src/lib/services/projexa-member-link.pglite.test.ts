/// <reference types="bun-types" />
// EVERY MEMBER GETS THEIR OWN VERIDIAN USER (drizzle/0728 + supabase/functions/projexa-api/member-link.ts). The SQL is the REAL migration file on PGlite
// (real Postgres as WASM) on top of 0621..0624 (which define public.ai_work_link__role_rank, the rank the AI link level is decided by).
//   * the mapping: owner/admin -> admin, pm -> manager, site_engineer/member -> member, client_viewer -> client_viewer, anything else refused; no PROJEXA
//     role ever maps to a VERIDIAN rank above the one it had (only owner/admin reach rank 5), and the Edge copy of the table equals the SQL one
//   * idempotent: a second call writes nothing; concurrent calls create one row
//   * never upgrade: an already-linked person keeps their role; an existing more powerful row is never linked; nobody is revived or double-linked
// Run: bun test --isolate src/lib/services/projexa-member-link.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { PROJEXA_TO_VERIDIAN_ROLE, veridianRoleFor } from "../../../supabase/functions/projexa-api/member-link"
import { createAwlDb, forwardSql } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(120_000)

let db: PGlite
let n = 0
const sub = () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`

type Out = { outcome: string; user_id: string | null; role: string | null }
const ensure = (org: string, s: string, email: string, projexaRole: string | null, name: string | null = null) =>
  db.query<Out>("select * from public.projexa_ensure_member_user($1, $2::uuid, $3, $4, $5)", [org, s, email, name, projexaRole]).then((r) => r.rows[0])
const usersOf = (org: string) => db.query<Record<string, any>>("select * from compliance.users where org_id = $1 order by email", [org]).then((r) => r.rows)
const rank = (role: string | null) => db.query<{ r: number }>("select public.ai_work_link__role_rank($1) r", [role]).then((r) => r.rows[0].r)
const mapped = (role: string | null) => db.query<{ r: string | null }>("select public.projexa_member_veridian_role($1) r", [role]).then((r) => r.rows[0].r)

// The power each PROJEXA role has in PROJEXA, as a VERIDIAN rank ceiling: the mapped role must never exceed it.
const CEILING: Record<string, number> = { owner: 5, admin: 5, pm: 3, site_engineer: 2, member: 2, client_viewer: 1 }

beforeAll(async () => {
  db = await createAwlDb("0624")
  await db.exec(`
    create table if not exists compliance.organisations (id text primary key, name text, is_active boolean not null default true);
    create table if not exists compliance.api_keys (id text primary key default gen_random_uuid()::text, org_id text not null, is_active boolean not null default true, issued_for_application_id text);
    create table if not exists compliance.departments (id text primary key default gen_random_uuid()::text, org_id text not null, name text not null, created_at timestamptz not null default now());
    insert into compliance.organisations (id, name, is_active) values ('org-m', 'M', true), ('org-own', 'OWN', true), ('org-off', 'OFF', false), ('org-nokey', 'NOKEY', true), ('org-other', 'OTHER', true);
    insert into compliance.api_keys (org_id, issued_for_application_id) values ('org-m', 'app-1'), ('org-own', null), ('org-off', 'app-1'), ('org-other', 'app-1');
    insert into compliance.api_keys (org_id, is_active) values ('org-nokey', false);
    insert into compliance.departments (org_id, name, created_at) values ('org-m', 'Zeta', now() - interval '1 day'), ('org-m', 'General', now());
  `)
  await db.exec(forwardSql("0728_projexa_ensure_member_user"))
}, 240_000)
afterAll(async () => {
  await db.close()
})

describe("the role mapping (public.projexa_member_veridian_role)", () => {
  test("the exact table, and unknown roles are refused", async () => {
    const table: Record<string, string | null> = {}
    for (const r of ["owner", "admin", "pm", "site_engineer", "member", "client_viewer", "viewer", "manager", "veridian_admin", "", null as unknown as string]) table[String(r)] = await mapped(r)
    expect(table).toEqual({
      owner: "admin", admin: "admin", pm: "manager", site_engineer: "member", member: "member", client_viewer: "client_viewer",
      viewer: null, manager: null, veridian_admin: null, "": null, null: null,
    })
    expect(await mapped("  PM ")).toBe("manager")
  })

  test("no PROJEXA role maps above its ceiling; only owner/admin reach admin; client_viewer stays read-only (rank 1)", async () => {
    for (const [projexa, ceiling] of Object.entries(CEILING)) {
      const role = await mapped(projexa)
      expect(await rank(role)).toBeLessThanOrEqual(ceiling)
      expect(await rank(role)).toBeGreaterThanOrEqual(1)
      if (role === "admin") expect(["owner", "admin"]).toContain(projexa)
    }
    expect(await rank(await mapped("client_viewer"))).toBe(1)
  })

  test("the Edge copy of the table (member-link.ts) is the SQL table", async () => {
    for (const [projexa, veridian] of Object.entries(PROJEXA_TO_VERIDIAN_ROLE)) expect(await mapped(projexa)).toBe(veridian)
    expect(Object.keys(PROJEXA_TO_VERIDIAN_ROLE).sort()).toEqual(Object.keys(CEILING).sort())
    expect(veridianRoleFor("viewer")).toBeNull()
    expect(veridianRoleFor("constructor")).toBeNull()
    expect(veridianRoleFor(null)).toBeNull()
  })
})

describe("public.projexa_ensure_member_user", () => {
  test("creates one user per PROJEXA role with the mapped role, the session id, the General department", async () => {
    const dept = (await db.query<{ id: string }>("select id from compliance.departments where org_id='org-m' and name='General'")).rows[0].id
    for (const [projexa, veridian] of Object.entries(PROJEXA_TO_VERIDIAN_ROLE)) {
      const s = sub()
      const out = await ensure("org-m", s, ` ${projexa.toUpperCase()}@M.example.test `, projexa)
      expect(out).toMatchObject({ outcome: "created", role: veridian })
      const row = (await db.query<Record<string, any>>("select * from compliance.users where id = $1", [out.user_id])).rows[0]
      expect(row).toMatchObject({ email: `${projexa}@m.example.test`, name: projexa, role: veridian, auth_user_id: s, org_id: "org-m", department_id: dept, password_hash: "supabase-auth-managed", is_active: true, onboarding_completed: false })
    }
    expect(await usersOf("org-m")).toHaveLength(6)
  })

  test("idempotent: a second call answers already_linked, returns the same user and writes nothing", async () => {
    const s = sub()
    const a = await ensure("org-m", s, "twice@m.example.test", "pm")
    const before = await usersOf("org-m")
    const b = await ensure("org-m", s, "twice@m.example.test", "pm")
    expect(a.outcome).toBe("created")
    expect(b).toEqual({ outcome: "already_linked", user_id: a.user_id, role: "manager" })
    expect(await usersOf("org-m")).toEqual(before)
  })

  test("concurrent calls for one person create exactly one row", async () => {
    const s = sub()
    const outs = await Promise.all([1, 2, 3].map(() => ensure("org-m", s, "race@m.example.test", "member")))
    expect(outs.filter((o) => o.outcome === "created")).toHaveLength(1)
    expect((await db.query("select 1 from compliance.users where auth_user_id = $1", [s])).rows).toHaveLength(1)
  })

  test("never upgrade: a linked person keeps their role even when PROJEXA now says owner", async () => {
    const s = sub()
    const a = await ensure("org-m", s, "keep@m.example.test", "client_viewer")
    const b = await ensure("org-m", s, "keep@m.example.test", "owner")
    expect(b).toEqual({ outcome: "already_linked", user_id: a.user_id, role: "client_viewer" })
    expect((await db.query<{ role: string }>("select role::text role from compliance.users where id=$1", [a.user_id])).rows[0].role).toBe("client_viewer")
  })

  test("an existing unlinked row of this org is linked only when it is no more powerful than the PROJEXA role", async () => {
    await db.exec(`insert into compliance.users (id, name, email, password_hash, role, is_active, org_id) values
      ('u-low', 'Low', 'low@m.example.test', 'x', 'viewer', true, 'org-m'),
      ('u-high', 'High', 'high@m.example.test', 'x', 'admin', true, 'org-m'),
      ('u-x', 'X', 'x@other.example.test', 'x', 'member', true, 'org-other'),
      ('u-zero', 'Z', 'zero@m.example.test', 'x', 'stage_0', true, 'org-m')`)
    const sLow = sub()
    expect(await ensure("org-m", sLow, "LOW@m.example.test", "site_engineer")).toEqual({ outcome: "linked_existing", user_id: "u-low", role: "viewer" })
    expect((await db.query<Record<string, any>>("select role::text role, auth_user_id from compliance.users where id='u-low'")).rows[0]).toEqual({ role: "viewer", auth_user_id: sLow })
    // a PROJEXA pm must not inherit an existing VERIDIAN admin row
    expect((await ensure("org-m", sub(), "high@m.example.test", "pm")).outcome).toBe("email_taken")
    expect((await db.query<Record<string, any>>("select auth_user_id from compliance.users where id='u-high'")).rows[0].auth_user_id).toBeNull()
    // another organisation's row is never touched
    expect((await ensure("org-m", sub(), "x@other.example.test", "admin")).outcome).toBe("email_taken")
    // stage_0 (rank 1) and a mapped role of rank >= 1: still linked only within the ceiling
    expect((await ensure("org-m", sub(), "zero@m.example.test", "client_viewer")).outcome).toBe("linked_existing")
  })

  test("a person linked elsewhere, a deactivated person and a taken (linked) email write nothing", async () => {
    const s = sub()
    await db.query("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values ('u-el', 'E', 'el@other.example.test', 'x', 'member', true, 'org-other', $1)", [s])
    expect(await ensure("org-m", s, "new-el@m.example.test", "member")).toEqual({ outcome: "linked_elsewhere", user_id: null, role: null })
    const s2 = sub()
    await db.query("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values ('u-off', 'O', 'off@m.example.test', 'x', 'member', false, 'org-m', $1)", [s2])
    expect((await ensure("org-m", s2, "off@m.example.test", "admin")).outcome).toBe("deactivated")
    expect((await db.query<{ a: boolean }>("select is_active a from compliance.users where id='u-off'")).rows[0].a).toBe(false)
    expect((await ensure("org-m", sub(), "el@other.example.test", "member")).outcome).toBe("email_taken")
    expect((await db.query("select 1 from compliance.users where email = 'new-el@m.example.test'")).rows).toHaveLength(0)
  })

  test("guards: unknown org, inactive org, org without an active key, unmapped role, bad input", async () => {
    for (const org of ["nope", "org-off", "org-nokey"]) expect((await ensure(org, sub(), "g@x.example.test", "member")).outcome).toBe("not_eligible")
    expect((await ensure("org-own", sub(), "own@x.example.test", "member")).outcome).toBe("created") // a key is a key: PROJEXA reaches the org through it
    expect((await ensure("org-m", sub(), "r@x.example.test", "superuser")).outcome).toBe("role_not_mapped")
    expect((await ensure("org-m", sub(), "r@x.example.test", null)).outcome).toBe("role_not_mapped")
    expect((await ensure("org-m", sub(), "not-an-email", "member")).outcome).toBe("bad_input")
    expect((await ensure("", sub(), "e@x.example.test", "member")).outcome).toBe("bad_input")
    expect((await db.query("select 1 from compliance.users where email in ('g@x.example.test', 'r@x.example.test')")).rows).toHaveLength(0)
  })

  test("only service_role may run either function", async () => {
    for (const sig of ["public.projexa_ensure_member_user(text,uuid,text,text,text)", "public.projexa_member_veridian_role(text)"]) {
      const r = await db.query<{ role: string; ok: boolean }>(`select r.rolname role, has_function_privilege(r.rolname, '${sig}', 'execute') ok from pg_roles r where r.rolname in ('anon','authenticated','app_runtime','service_role') order by 1`)
      expect(Object.fromEntries(r.rows.map((x) => [x.role, x.ok]))).toEqual({ anon: false, app_runtime: false, authenticated: false, service_role: true })
    }
  })
})
