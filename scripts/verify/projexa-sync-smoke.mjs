#!/usr/bin/env node
// PROJEXA projexa-sync SMOKE (package lf-b4-runbook): the post-deploy check of the Edge function, run by the PM with a real PROJEXA access token.
//
//   SYNC_BASE=https://<project-ref>.supabase.co/functions/v1/projexa-sync PX_TOKEN=<PROJEXA access token> node scripts/verify/projexa-sync-smoke.mjs
//
// Calls, in order: GET /manifest, POST /pull (one kind, limit 1), POST /changes (after_seq null = head_seq), POST /ids (limit 5), POST /attest, GET /release/current,
// and prints a PASS / FAIL table with the HTTP status and latency of each. Exit 0 only when every call passed; a person with no readable project gets SKIP rows for the
// project calls (that is a data fact, not a deploy fault) and the exit is still 0 if the others passed.
//
// SAFETY. The token is read from the environment only (PX_TOKEN, or PROJEXA_ACCESS_TOKEN); it is never printed, never put in the table, and any error text is scrubbed of it.
// The script refuses to run against anything but an https `*.supabase.co` host whose path is /functions/v1/projexa-sync, so a mistyped variable cannot send a PROJEXA token to
// another server. It only reads (every POST here is a read route); nothing is written.
import { pathToFileURL } from "node:url"

export const EXPECTED_PATH = "/functions/v1/projexa-sync"
export const CLIENT_HEADER = "smoke; protocol=2; schema=3" // protocol 2 matches SERVER_PROTOCOL; "smoke" is not a release so the min_compatible floor never blocks the check

/** Returns the normalised base URL, or throws. Only https://<something>.supabase.co/functions/v1/projexa-sync is accepted. */
export function validateBase(raw) {
  let u
  try {
    u = new URL(String(raw ?? ""))
  } catch {
    throw new Error("SYNC_BASE is missing or not a URL")
  }
  if (u.protocol !== "https:") throw new Error("SYNC_BASE must be https")
  if (u.username || u.password || u.port) throw new Error("SYNC_BASE must not carry credentials or a port")
  if (!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)) throw new Error("SYNC_BASE host must be <project>.supabase.co")
  if (u.pathname.replace(/\/+$/, "") !== EXPECTED_PATH) throw new Error(`SYNC_BASE path must be ${EXPECTED_PATH}`)
  if (u.search || u.hash) throw new Error("SYNC_BASE must have no query or fragment")
  return `${u.origin}${EXPECTED_PATH}`
}

export const scrub = (text, token) => (token && token.length >= 8 ? String(text).split(token).join("[token]") : String(text))

/** One call. Never throws: a network error is a FAIL row. */
async function call(fetchImpl, base, token, route, method, body, check, nowMs) {
  const t0 = nowMs()
  let status = 0
  let detail = ""
  let ok = false
  try {
    const res = await fetchImpl(`${base}/${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "x-px-client": CLIENT_HEADER, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    status = res.status
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (res.status !== 200) detail = `HTTP ${res.status}${json && typeof json.code === "string" ? ` ${json.code}` : ""}`
    else {
      const problem = check(json)
      ok = problem === null
      detail = ok ? "" : problem
    }
    return { name: route, ok, status, ms: nowMs() - t0, detail, json }
  } catch (e) {
    return { name: route, ok: false, status, ms: nowMs() - t0, detail: `network: ${e instanceof Error ? e.name : "error"}`, json: null }
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

/** Runs the whole smoke. Pure apart from the injected fetch/clock. Returns the rows (no token in any field). */
export async function runSmoke({ base, token, fetchImpl = fetch, nowMs = () => Date.now() }) {
  const rows = []
  const push = (r) => rows.push({ name: r.name, status: r.ok ? "PASS" : r.skip ? "SKIP" : "FAIL", http: r.status ?? null, ms: r.ms ?? 0, detail: scrub(r.detail ?? "", token) })

  const m = await call(fetchImpl, base, token, "manifest", "GET", null, (j) => (isObj(j) && Array.isArray(j.projects) && Array.isArray(j.kinds) && isObj(j.release) ? null : "manifest shape (projects, kinds, release)"), nowMs)
  push(m)
  const project = m.ok ? m.json.projects.find((p) => isObj(p) && typeof p.id === "string")?.id : undefined
  const kind = m.ok ? (m.json.kinds.find((k) => isObj(k) && k.kind === "project") ?? m.json.kinds.find((k) => isObj(k) && typeof k.kind === "string"))?.kind : undefined

  if (project && kind) {
    push(await call(fetchImpl, base, token, "pull", "POST", { project_id: project, kind, after: null, limit: 1 }, (j) => (isObj(j) && Array.isArray(j.items) && typeof j.has_more === "boolean" ? null : "pull shape (items, has_more)"), nowMs))
    push(await call(fetchImpl, base, token, "changes", "POST", { project_id: project, after_seq: null, limit: 1 }, (j) => (isObj(j) && Number.isFinite(Number(j.head_seq)) ? null : "changes shape (head_seq)"), nowMs))
    push(await call(fetchImpl, base, token, "ids", "POST", { project_id: project, kind, after_id: null, limit: 5 }, (j) => (isObj(j) && Array.isArray(j.ids) ? null : "ids shape (ids)"), nowMs))
  } else {
    const why = m.ok ? "no readable project for this person" : "manifest failed"
    for (const name of ["pull", "changes", "ids"]) rows.push({ name, status: m.ok ? "SKIP" : "FAIL", http: null, ms: 0, detail: why })
  }
  push(await call(fetchImpl, base, token, "attest", "POST", {}, (j) => (isObj(j) && typeof j.token === "string" && Array.isArray(j.public_keys) && j.public_keys.length > 0 && typeof j.channel === "string" ? null : "attest shape (token, public_keys, channel)"), nowMs))
  push(await call(fetchImpl, base, token, "release/current", "GET", null, (j) => (isObj(j) && typeof j.registered === "boolean" && "min_compatible" in j && Number.isFinite(Number(j.protocol)) ? null : "release shape (registered, min_compatible, protocol)"), nowMs))
  return rows
}

export function table(rows) {
  const w = Math.max(...rows.map((r) => r.name.length), 5)
  const out = [`${"route".padEnd(w)}  result  http  ${"ms".padStart(6)}  detail`]
  for (const r of rows) out.push(`${r.name.padEnd(w)}  ${r.status.padEnd(6)}  ${String(r.http ?? "-").padEnd(4)}  ${String(Math.round(r.ms)).padStart(6)}  ${r.detail}`)
  const failed = rows.filter((r) => r.status === "FAIL").length
  out.push("", failed === 0 ? `SMOKE PASS (${rows.filter((r) => r.status === "PASS").length} passed, ${rows.filter((r) => r.status === "SKIP").length} skipped)` : `SMOKE FAIL (${failed} failed)`)
  return out.join("\n")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.PX_TOKEN || process.env.PROJEXA_ACCESS_TOKEN || ""
  try {
    if (!token) throw new Error("set PX_TOKEN (a PROJEXA access token) in the environment")
    const base = validateBase(process.env.SYNC_BASE)
    const rows = await runSmoke({ base, token })
    console.log(table(rows))
    process.exit(rows.some((r) => r.status === "FAIL") ? 1 : 0)
  } catch (e) {
    console.error(scrub(e instanceof Error ? e.message : String(e), token))
    process.exit(2)
  }
}
