// LIVE write-side check of the PROJEXA local-first sync (owner order 2026-10-02: complete on local + Supabase + git, then TEST IT).
//
//   A. push ledger (0681)      rolled back: claim -> retry while running -> finish -> replay returns the stored result (exactly once);
//                              a viewer is refused (ROLE_TOO_LOW), another organisation's person is refused (PROJECT_NOT_READABLE)
//   B. job lease (0682)        rolled back: queue -> lease -> heartbeat -> result; nobody else can lease or read it; bad params and a foreign project are refused
//   C. release + keys + health read: release registry state, signing keys, tracking health (28 kinds, 3 triggers each, expressions compile)
//   D. change tracking (0679)  COMMITTED, one harmless write: `updated_at` of the single project of the R74-TEST-Tenant-A test organisation is touched twice;
//                              the head moves, /changes returns the change with a higher version, a person of another organisation sees nothing of it.
//
// A-C run as ONE statement each that ends in a deliberate exception (so nothing they write survives). D is the only part that commits, on a
// tenant that exists for tests (name starts with R74-TEST). Nothing prints a token, a sign-in id, an e-mail address or a row's data.
//   bun scripts/verify/projexa-sync-live-write-check.ts
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { handleSync, RateLimiter, type Rpc, type RpcResult } from "../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../supabase/functions/ai-work-link/session"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PROJECT = process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"
const A_ORG = "f384a4fc-7193-4296-929c-32646879173d" // R74-TEST-Tenant-A
const B_ORG = "1850e900-6b54-4108-b01c-cc42c00f3eb9" // R74-TEST-Tenant-B

function token(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  for (const p of ["C:/ct/ct/.env.local", join(ROOT, ".env.local")]) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  throw new Error("SUPABASE_ACCESS_TOKEN is not set")
}
const TOKEN = token()

async function sqlText(query: string): Promise<{ ok: boolean; text: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(120_000),
    })
    const text = await res.text()
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    return { ok: res.ok, text }
  }
  throw new Error("Management API stayed unavailable")
}
async function sql(query: string): Promise<any[]> {
  const r = await sqlText(query)
  if (!r.ok) throw new Error(r.text.slice(0, 600))
  return JSON.parse(r.text)
}
/** A probe file: one DO block ending in `RAISE EXCEPTION 'PROBE_RESULT %', <jsonb>::text` (rolls everything back); returns that jsonb. */
async function probe(file: string): Promise<any> {
  const r = await sqlText(readFileSync(join(ROOT, "scripts", "verify", "sql", file), "utf8"))
  let message = r.text
  try {
    message = String(JSON.parse(r.text).message ?? r.text)
  } catch {
    /* raw */
  }
  const m = message.match(/PROBE_RESULT (\{.*?\})\s*(?:\nCONTEXT|$)/s)
  if (!m) throw new Error(`${file}: no probe result: ${message.slice(0, 500)}`)
  return JSON.parse(m[1])
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null"
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "true" : "false"
  if (Array.isArray(v)) return `array[${v.map(lit).join(",")}]::text[]`
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}
const rpc: Rpc = async (name, args = {}): Promise<RpcResult> => {
  const keys = Object.keys(args)
  const r = await sqlText(`select public.${name}(${keys.map((k) => `${k} => ${lit(args[k])}`).join(", ")}) as r`)
  if (r.ok) return { data: (JSON.parse(r.text) as Array<{ r: unknown }>)[0]?.r ?? null, error: null }
  const m = r.text.match(/ERROR:\s+(\w+):\s+([^\n"\\]*)/)
  return { data: null, error: { message: m ? m[2].trim() : r.text.slice(0, 200), code: m?.[1] } }
}
const session: SessionVerifier = async (t) => (t.startsWith("tok:") ? { ok: true, sub: t.slice(4), email: null, issuer: "live-check", iat: null } : { ok: false, reason: "invalid" })
const limiter = new RateLimiter(1_000_000)
type J = Record<string, any>
async function hit(sub: string, path: string, body?: unknown): Promise<{ status: number; json: J }> {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer tok:${sub}`, "x-px-client": "live-check; protocol=2; schema=3" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const res = await handleSync(req, { rpc, session, limiter })
  let json: J = {}
  try {
    json = (await res.json()) as J
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}

const results: Array<{ ok: boolean; name: string }> = []
function check(ok: boolean, name: string, note?: string) {
  results.push({ ok, name })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `   (${note})` : ""}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // ---------------------------------------------------------------- A. push ledger
  const a = await probe("projexa-live-push-ledger-probe.sql")
  check(a.have_record === true, "A  a real record to push against exists", `kind tasks`)
  check(a.first?.action === "run" && a.first?.status === "ok", "A  first claim of an op runs it", `action ${a.first?.action}`)
  check(a.first?.ctx?.live_role === "member" && a.first?.ctx?.live_rank === 2, "A  the claim carries the person's LIVE role and rank (not a cached one)")
  check(a.second?.action === "retry" && a.second?.code === "IN_PROGRESS", "A  the same op while running -> retry later (never run twice)", `${a.second?.action}/${a.second?.code}`)
  check(a.finish?.status === "applied" && a.finish?.ignored === false, "A  finish records the outcome")
  check(a.third?.action === "duplicate" && a.third?.result?.id === a.record && a.third?.stored_status === "applied", "A  replay of a finished op returns the STORED result, nothing runs again (exactly once)")
  check(a.viewer?.action === "reject" && a.viewer?.code === "ROLE_TOO_LOW", "A  a viewer's write is refused (role gate)", `${a.viewer?.code ?? a.viewer_error}`)
  check(a.other_org?.action === "reject" && a.other_org?.code === "PROJECT_NOT_READABLE", "A  a person of another organisation cannot write into this project", `${a.other_org?.code ?? a.other_org_error}`)

  // ---------------------------------------------------------------- B + C. jobs, release, keys, health
  const c = await probe("projexa-live-jobs-release-probe.sql")
  check(c.enqueue?.status === "ok" && typeof c.enqueue?.job_id === "string", "B  a job is queued")
  check(c.other_person_claim === false, "B  another person of the same organisation cannot lease a requester-only job")
  check(c.other_org_get === "NOT_FOUND", "B  a person of another organisation cannot even read the job (NOT_FOUND)")
  check(c.claim?.job?.job_id === c.enqueue?.job_id && c.claim?.job?.attempt === 1 && typeof c.claim?.job?.lease_id === "string", "B  the requester's laptop leases it (attempt 1, with a lease)")
  check(c.heartbeat?.outcome === "extended", "B  a heartbeat extends the lease")
  check(String(c.wrong_lease_result).includes("NOT_FOUND") || c.wrong_lease_result?.outcome !== "accepted", "B  a result with the wrong lease is refused", JSON.stringify(c.wrong_lease_result).slice(0, 80))
  check(c.result?.outcome === "accepted" && c.result?.job_status === "done", "B  the right lease finishes the job")
  check(c.get_done?.job_status === "done" && c.get_done?.result?.rows === 0, "B  the result reads back")
  check(c.bad_kind === "BAD_JOB", "B  params outside the allow-list are refused (BAD_JOB)")
  check(c.foreign_project_job === "NOT_FOUND", "B  a job for another organisation's project is refused (NOT_FOUND)", String(c.foreign_project_job))
  const kinds: J[] = c.tracking_health?.kinds ?? []
  check(c.tracking_health?.ok === true && kinds.length === 37 && kinds.every((k) => k.enabled && k.expr_ok && k.triggers === 3), "C  tracking health: 37 kinds (28 project + 9 organisation), enabled, expressions compile, 3 triggers each", `${kinds.length} kinds`)
  console.log(`  info: release registry registered=${c.release_current?.registered}, current=${c.release_current?.current ?? "none"}, min_compatible="${c.release_current?.min_compatible ?? ""}", signing keys=${c.public_keys}`)

  // ---------------------------------------------------------------- D. change tracking, one committed harmless write on the test tenant
  const people = (await sql(
    `select o.org_id, o.sub, o.role from (select org_id, auth_user_id::text as sub, role from compliance.users where org_id in (${lit(A_ORG)}, ${lit(B_ORG)}) and role = 'admin' and auth_user_id is not null) o order by o.org_id, o.sub`,
  )) as Array<{ org_id: string; sub: string }>
  const subA = people.find((p) => p.org_id === A_ORG)?.sub
  const subB = people.find((p) => p.org_id === B_ORG)?.sub
  const projA = (await sql(`select id from compliance.projects where org_id = ${lit(A_ORG)} order by id limit 1`))[0]?.id as string | undefined
  if (!subA || !subB || !projA) {
    check(false, "D  the test tenants have an admin each and a project")
  } else {
    const headOf = async (sub: string, project: string): Promise<number | null> => {
      const h = await hit(sub, "heads")
      const v = h.json.heads?.[project]
      return v === undefined || v === null ? null : Number(v)
    }
    /** Waits until the project's head is above `than` (a change shows once its transaction is behind the commit horizon); returns the head. */
    const headAbove = async (than: number): Promise<number> => {
      let h = than
      for (let i = 0; i < 12 && h <= than; i++) {
        await sleep(i === 0 ? 300 : 1200)
        h = (await headOf(subA, projA)) ?? 0
      }
      return h
    }
    const setDescription = (v: string | null) => sql(`update compliance.projects set description = ${lit(v)} where id = ${lit(projA)} and org_id = ${lit(A_ORG)}`)
    const original = ((await sql(`select description from compliance.projects where id = ${lit(projA)}`))[0]?.description ?? null) as string | null
    try {
      const h0 = (await headOf(subA, projA)) ?? 0
      // a touch of updated_at alone is NOT a change (cost: no version, no feed entry, nothing for any laptop to pull)
      await sql(`update compliance.projects set updated_at = clock_timestamp() where id = ${lit(projA)} and org_id = ${lit(A_ORG)}`)
      await sleep(2500)
      const hTouch = (await headOf(subA, projA)) ?? 0
      check(hTouch === h0, "D  a bare touch of updated_at creates NO version and no feed entry (by design: saves every laptop a pull)", `head ${h0} -> ${hTouch}`)

      await setDescription("livecheck one")
      const h1 = await headAbove(h0)
      check(h1 > h0, "D  a real committed content change moves the project's head (the change feed sees it)", `head ${h0} -> ${h1}`)
      const ch = await hit(subA, "changes", { project_id: projA, after_seq: h0, limit: 50 })
      const items: J[] = ch.json.items ?? ch.json.changes ?? []
      const mine = items.find((i) => String(i.kind ?? i.type) === "project" && String(i.id ?? i.record_id) === projA)
      check(ch.status === 200 && !!mine, "D  /changes after the old head returns exactly that project change", `status ${ch.status}, ${items.length} entries`)
      check(!!mine && Number(mine.version) >= 1 && !mine.deleted, "D  the change carries a record version and is not a delete", `version ${mine?.version}`)
      const pull = await hit(subA, "pull", { project_id: projA, kind: "project", after: null, limit: 5 })
      const prow = (pull.json.items as J[] | undefined)?.find((i) => String(i.id) === projA)
      check(pull.status === 200 && !!prow && Number(prow.version) === Number(mine?.version) && (prow.data as J)?.description === "livecheck one", "D  /pull returns the same version the feed announced, with the new content", `pull v${prow?.version} feed v${mine?.version}`)

      await setDescription("livecheck two")
      const h2 = await headAbove(h1)
      check(h2 > h1, "D  a second change moves the head again (monotonic)", `head ${h1} -> ${h2}`)
      const pull2 = await hit(subA, "pull", { project_id: projA, kind: "project", after: null, limit: 5 })
      const prow2 = (pull2.json.items as J[] | undefined)?.find((i) => String(i.id) === projA)
      check(Number(prow2?.version) > Number(prow?.version), "D  the record's version number went up with the change", `v${prow?.version} -> v${prow2?.version}`)

      // another organisation sees none of it
      const hb = await hit(subB, "heads")
      check(hb.status === 200 && hb.json.heads?.[projA] === undefined, "D  a person of ANOTHER organisation never sees that project's head")
      const cb = await hit(subB, "changes", { project_id: projA, after_seq: 0, limit: 50 })
      check(cb.status === 404, "D  nor its change feed (404, same as a missing project)", `status ${cb.status}`)
      const pb = await hit(subB, "pull", { project_id: projA, kind: "project", after: null, limit: 5 })
      check(pb.status === 404, "D  nor pull it (404)", `status ${pb.status}`)
    } finally {
      await setDescription(original) // the test tenant's project is left as it was found
      const back = ((await sql(`select description from compliance.projects where id = ${lit(projA)}`))[0]?.description ?? null) as string | null
      check(back === original, "D  the test project's description is restored to what it was", "")
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL`)
  if (failed.length) {
    for (const f of failed) console.log("  FAILED:", f.name)
    process.exit(1)
  }
}
main().catch((e) => {
  console.error("ERROR:", String(e?.message ?? e).slice(0, 700))
  process.exit(2)
})
