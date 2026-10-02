// LIVE read-side check of the PROJEXA local-first sync (owner order 2026-10-02: "complete everything on local + Supabase + git, then TEST IT").
//
// What it runs: the REAL Edge handler (supabase/functions/projexa-sync/handler.ts) in this process, over the REAL SQL functions on the LIVE database
// (Supabase Management API, one read-only statement per call), for REAL people of real organisations. The only stand-in is the session verifier:
// the Edge function proves a bearer token against the PROJEXA Auth key set; here `tok:<sub>` stands for "this person's token was proved", exactly as
// the PGlite suites do, so no password and no token is ever handled. (The live token check itself is exercised by the unauthenticated probes of
// the deploy and, after sign-in, by scripts/verify/projexa-sync-smoke.mjs.)
//
// It WRITES NOTHING: every statement is a select of a function that is STABLE/read-only (manifest, heads, pull, changes, ids, org feeds).
// It never prints a token, a sub, an e-mail address or a row's data; only counts, ids of projects and pass/fail lines.
//
//   bun scripts/verify/projexa-sync-live-read-check.ts            run everything, exit 1 if anything FAILs
//   bun scripts/verify/projexa-sync-live-read-check.ts --list     only list the people and organisations chosen
import { readFileSync, existsSync } from "node:fs"
import { handleSync, RateLimiter, type Rpc, type RpcResult } from "../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../supabase/functions/ai-work-link/session"

const PROJECT = process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"
function token(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  for (const p of ["C:/ct/ct/.env.local", ".env.local"]) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  throw new Error("SUPABASE_ACCESS_TOKEN is not set (environment or .env.local)")
}
const TOKEN = token()

async function sql(query: string): Promise<unknown[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    })
    const text = await res.text()
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw Object.assign(new Error(text), { status: res.status })
    return JSON.parse(text) as unknown[]
  }
  throw new Error("Management API stayed unavailable")
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null"
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "true" : "false"
  if (Array.isArray(v)) return `array[${v.map(lit).join(",")}]::text[]`
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

let rpcCalls = 0
/** The handler's database seam over the live functions; an SQL error comes back the way supabase-js reports it: { message, code }. */
const rpc: Rpc = async (name, args = {}): Promise<RpcResult> => {
  rpcCalls++
  const keys = Object.keys(args)
  try {
    const rows = (await sql(`select public.${name}(${keys.map((k) => `${k} => ${lit(args[k])}`).join(", ")}) as r`)) as Array<{ r: unknown }>
    return { data: rows[0]?.r ?? null, error: null }
  } catch (e) {
    const m = String((e as Error).message).match(/ERROR:\s+(\w+):\s+([^\n"\\]*)/)
    return { data: null, error: { message: m ? m[2].trim() : String((e as Error).message).slice(0, 200), code: m?.[1] } }
  }
}

type J = Record<string, any>
const sessions = new Map<string, string>() // the bearer a person uses -> their sign-in id (never printed)
const session: SessionVerifier = async (tokenText) => {
  const sub = tokenText.startsWith("tok:") ? tokenText.slice(4) : ""
  return sub ? { ok: true, sub, email: null, issuer: "live-check", iat: null } : { ok: false, reason: "invalid" }
}
const limiter = new RateLimiter(1_000_000)
async function hit(who: string | null, path: string, body?: unknown): Promise<{ status: number; json: J }> {
  const headers: Record<string, string> = { "x-px-client": "live-check; protocol=2; schema=3" }
  if (who) headers.authorization = `Bearer tok:${who}`
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter })
  let json: J = {}
  try {
    json = (await res.json()) as J
  } catch {
    /* empty body */
  }
  return { status: res.status, json }
}

// ---------------------------------------------------------------------------------------------------------- the people (chosen at run time, from live data)
type Person = { label: string; org: string; role: string; sub: string }
const ORGS: Array<{ label: string; org: string; roles: string[] }> = [
  { label: "Meridian (E2E construction org)", org: "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d", roles: ["admin", "manager", "member", "client_viewer"] },
  { label: "R74-TEST-Tenant-A", org: "f384a4fc-7193-4296-929c-32646879173d", roles: ["admin", "member", "external_auditor"] },
  { label: "R74-TEST-Tenant-B", org: "1850e900-6b54-4108-b01c-cc42c00f3eb9", roles: ["admin", "member"] },
]

const results: Array<{ ok: boolean; name: string; note?: string }> = []
function check(ok: boolean, name: string, note?: string) {
  results.push({ ok, name, note })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `   (${note})` : ""}`)
}

async function choosePeople(): Promise<Person[]> {
  const out: Person[] = []
  for (const o of ORGS) {
    for (const role of o.roles) {
      const rows = (await sql(
        `select auth_user_id::text as sub from compliance.users where org_id = ${lit(o.org)} and role = ${lit(role)} and auth_user_id is not null and coalesce(is_active, true) order by created_at nulls last, id limit 1`,
      ).catch(() => sql(`select auth_user_id::text as sub from compliance.users where org_id = ${lit(o.org)} and role = ${lit(role)} and auth_user_id is not null order by id limit 1`))) as Array<{ sub: string }>
      if (rows[0]?.sub) out.push({ label: `${o.label} / ${role}`, org: o.org, role, sub: rows[0].sub })
    }
  }
  return out
}

async function main() {
  const people = await choosePeople()
  console.log(`people chosen (${people.length}):`, people.map((p) => p.label).join(" | "))
  if (process.argv.includes("--list")) return

  const orgProjects = new Map<string, string[]>() // org -> project ids in the database
  for (const o of ORGS) {
    const rows = (await sql(`select id from compliance.projects where org_id = ${lit(o.org)} order by id`)) as Array<{ id: string }>
    orgProjects.set(o.org, rows.map((r) => r.id))
  }
  console.log("projects in the database:", ORGS.map((o) => `${o.label}=${orgProjects.get(o.org)!.length}`).join(", "))

  // 0. no sign-in, no data
  const anon = await hit(null, "manifest")
  check(anon.status === 401, "no session -> 401 on /manifest", `status ${anon.status}`)

  const manifests = new Map<string, J>()
  const heads = new Map<string, J>()
  for (const p of people) {
    // 1. manifest
    const m = await hit(p.sub, "manifest")
    check(m.status === 200, `[${p.label}] /manifest answers 200`, `status ${m.status}`)
    if (m.status !== 200) continue
    manifests.set(p.sub, m.json)
    check(m.json.user?.org_id === p.org, `[${p.label}] the manifest names the person's own organisation`)
    check(m.json.user?.auth_user_id === p.sub, `[${p.label}] manifest user.auth_user_id equals the sign-in id (client identity check)`)
    const kinds = (m.json.kinds as J[] | undefined) ?? []
    check(kinds.length === 28, `[${p.label}] 28 project kinds in the manifest`, `got ${kinds.length}`)
    const orgKinds = (m.json.org_kinds as J[] | string[] | undefined) ?? []
    check(Array.isArray(orgKinds) && orgKinds.length >= 1 && orgKinds.length <= 9, `[${p.label}] organisation kinds listed (as per role)`, `got ${orgKinds.length}`)
    const mine = new Set(orgProjects.get(p.org) ?? [])
    const ids = ((m.json.projects as J[] | undefined) ?? []).map((x) => String(x.id)).filter((id) => id !== "__org__")
    const foreign = ids.filter((id) => !mine.has(id))
    check(foreign.length === 0, `[${p.label}] every project in the manifest belongs to the person's organisation`, `${ids.length} projects, ${foreign.length} foreign`)

    // 2. heads (the one-call poll)
    const h = await hit(p.sub, "heads")
    check(h.status === 200 && typeof h.json.heads === "object" && h.json.epoch !== undefined, `[${p.label}] GET /heads answers one call with heads + epoch`, `status ${h.status}`)
    heads.set(p.sub, h.json)
    const headIds = Object.keys(h.json.heads ?? {}).filter((id) => id !== "__org__")
    check(headIds.every((id) => mine.has(id)), `[${p.label}] /heads names only the person's own projects`)
    check(typeof h.json.role === "string" && typeof h.json.view_class === "string", `[${p.label}] /heads carries role + view class`, `role=${h.json.role} class=${h.json.view_class} orgclass=${h.json.org_view_class}`)
  }

  // 3. isolation: a person of org X asks for a project of org Y -> the same 404 as for a project that does not exist
  const pairs: Array<[Person, string]> = []
  for (const p of people) for (const o of ORGS) if (o.org !== p.org && (orgProjects.get(o.org) ?? []).length) pairs.push([p, orgProjects.get(o.org)![0]])
  for (const [p, foreignProject] of pairs) {
    const real = await hit(p.sub, "pull", { project_id: foreignProject, kind: "tasks", after: null, limit: 5 })
    const none = await hit(p.sub, "pull", { project_id: "does-not-exist-000", kind: "tasks", after: null, limit: 5 })
    check(real.status === 404 && none.status === 404 && JSON.stringify(real.json) === JSON.stringify(none.json), `[${p.label}] a project of another organisation answers the SAME 404 as a missing one (/pull)`, `${real.status}/${none.status}`)
  }
  for (const [p, foreignProject] of pairs.slice(0, 4)) {
    const ch = await hit(p.sub, "changes", { project_id: foreignProject, after_seq: null, limit: 5 })
    check(ch.status === 404, `[${p.label}] /changes of another organisation's project -> 404`, `status ${ch.status}`)
    const idr = await hit(p.sub, "ids", { project_id: foreignProject, kind: "tasks", after_id: null, limit: 5 })
    check(idr.status === 404, `[${p.label}] /ids of another organisation's project -> 404`, `status ${idr.status}`)
  }

  // 4. every project kind of one real project, per role: rows only of the person's organisation, paging has no duplicate, redaction differs by role
  const meridianAdmin = people.find((p) => p.org === ORGS[0].org && p.role === "admin")
  const mProjects = orgProjects.get(ORGS[0].org) ?? []
  const withData: Array<{ project: string; kind: string; n: number }> = []
  if (meridianAdmin) {
    const kinds = ((manifests.get(meridianAdmin.sub)?.kinds as J[]) ?? []).map((k) => String(k.kind))
    for (const project of mProjects.slice(0, 4)) {
      for (const kind of kinds) {
        const r = await hit(meridianAdmin.sub, "pull", { project_id: project, kind, after: null, limit: 3 })
        if (r.status !== 200) {
          check(false, `[admin] pull ${kind} of a real project answers 200`, `status ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
          continue
        }
        if ((r.json.items as J[]).length) withData.push({ project, kind, n: (r.json.items as J[]).length })
      }
    }
    check(withData.length > 0, "[admin] at least one kind of a real project returns rows (the data is really there)", `${withData.length} (project,kind) pairs with rows`)
    // one pair with rows: page with limit 1 vs limit 200 -> same ids, none twice, none of another organisation
    const pick = [...withData].sort((x, y) => y.n - x.n)[0] // the pair with the most rows, so paging by 1 really crosses pages
    if (pick) {
      const all = await hit(meridianAdmin.sub, "pull", { project_id: pick.project, kind: pick.kind, after: null, limit: 200 })
      const allIds = (all.json.items as J[]).map((i) => String(i.id))
      const paged: string[] = []
      let after: string | null = null
      for (let i = 0; i < 40; i++) {
        const pg = await hit(meridianAdmin.sub, "pull", { project_id: pick.project, kind: pick.kind, after, limit: 1 })
        for (const it of pg.json.items as J[]) paged.push(String(it.id))
        if (!pg.json.has_more) break
        after = pg.json.next_cursor
      }
      check(new Set(paged).size === paged.length && paged.length === allIds.length && paged.every((id) => allIds.includes(id)), `[admin] ${pick.kind}: paging by 1 equals one big page, no duplicate, nothing skipped`, `${paged.length} vs ${allIds.length}`)
      const foreignRows = (all.json.items as J[]).filter((i) => i.data && typeof i.data === "object" && (i.data.org_id ?? i.data.orgId) && (i.data.org_id ?? i.data.orgId) !== meridianAdmin.org)
      check(foreignRows.length === 0, `[admin] ${pick.kind}: no row names another organisation`, `${allIds.length} rows`)
    }
  }

  // 5. role visibility: same project, same kind, an admin and the lowest role -> the lower one never sees MORE (rows or non-null columns)
  const lowRoles = ["client_viewer", "member"]
  if (meridianAdmin) {
    for (const low of lowRoles) {
      const lp = people.find((p) => p.org === ORGS[0].org && p.role === low)
      if (!lp) continue
      let moreRows = 0
      let moreCols = 0
      let compared = 0
      for (const { project, kind } of withData.slice(0, 40)) {
        const a = await hit(meridianAdmin.sub, "pull", { project_id: project, kind, after: null, limit: 20 })
        const b = await hit(lp.sub, "pull", { project_id: project, kind, after: null, limit: 20 })
        if (b.status !== 200) continue // the lower role may be refused the whole project: that is the strictest answer
        compared++
        const ai = a.json.items as J[]
        const bi = b.json.items as J[]
        const aIds = new Set(ai.map((x) => String(x.id)))
        moreRows += bi.filter((x) => !aIds.has(String(x.id))).length
        for (const row of bi) {
          const arow = ai.find((x) => String(x.id) === String(row.id))
          if (!arow || !row.data || !arow.data) continue
          for (const [col, val] of Object.entries(row.data as J)) if (val !== null && (arow.data as J)[col] === null) moreCols++
        }
      }
      check(moreRows === 0 && moreCols === 0, `[${low}] never sees a row or a filled column the admin does not (role visibility)`, `${compared} (project,kind) compared`)
    }
  }

  // 6. organisation feed: org kinds readable per role; a client_viewer reads no more than a member than an admin
  const orgRead = new Map<string, number>()
  for (const p of people.filter((x) => x.org === ORGS[0].org)) {
    const man = manifests.get(p.sub)
    const okinds = ((man?.org_kinds as Array<J | string> | undefined) ?? []).map((k) => (typeof k === "string" ? k : String(k.kind)))
    let rows = 0
    for (const kind of okinds) {
      const r = await hit(p.sub, "pull", { project_id: "__org__", kind, after: null, limit: 50 })
      if (r.status === 200) {
        rows += (r.json.items as J[]).length
        const foreign = (r.json.items as J[]).filter((i) => i.data && (i.data.org_id ?? i.data.orgId) && (i.data.org_id ?? i.data.orgId) !== p.org)
        if (foreign.length) check(false, `[${p.label}] organisation kind ${kind} carries a row of another organisation`)
      }
    }
    orgRead.set(p.role, rows)
    console.log(`  ${p.label}: ${okinds.length} organisation kinds listed, ${rows} organisation rows readable`)
  }
  const a = orgRead.get("admin") ?? 0
  const m = orgRead.get("member") ?? 0
  const v = orgRead.get("client_viewer") ?? 0
  check(a >= m && m >= v, "organisation rows readable: admin >= member >= client_viewer", `admin ${a}, member ${m}, client_viewer ${v}`)

  // 7. the change feed: heads are monotonic and /changes from a head returns nothing, from null returns the history in order
  if (meridianAdmin) {
    const proj = Object.keys(heads.get(meridianAdmin.sub)?.heads ?? {}).filter((x) => x !== "__org__")[0]
    if (proj) {
      const head = heads.get(meridianAdmin.sub)!.heads[proj]
      const quiet = await hit(meridianAdmin.sub, "changes", { project_id: proj, after_seq: head, limit: 100 })
      check(quiet.status === 200 && (quiet.json.items ?? quiet.json.changes ?? []).length === 0, "/changes after the current head is empty", `status ${quiet.status}`)
      const hist = await hit(meridianAdmin.sub, "changes", { project_id: proj, after_seq: null, limit: 100 })
      const seqs = ((hist.json.items ?? hist.json.changes ?? []) as J[]).map((c) => Number(c.seq ?? c.change_seq)).filter((n) => !Number.isNaN(n))
      check(hist.status === 200, "/changes from the start answers 200", `status ${hist.status}, ${seqs.length} entries`)
      check(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), "/changes entries come in strictly increasing order")
    }
  }

  // 8. tracking health (the migration's own self-check)
  try {
    const h = (await sql(`select to_jsonb(t) as r from (select * from public.projexa_sync__health()) t`).catch(() => [])) as Array<{ r: J }>
    if (h.length) console.log("  tracking health:", JSON.stringify(h[0].r).slice(0, 400))
  } catch {
    /* optional */
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL  (${rpcCalls} database calls)`)
  if (failed.length) {
    for (const f of failed) console.log("  FAILED:", f.name, f.note ?? "")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("ERROR:", String(e?.message ?? e).slice(0, 600))
  process.exit(2)
})
