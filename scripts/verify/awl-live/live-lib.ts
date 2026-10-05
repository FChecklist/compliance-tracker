// Audit 100 (lane 2): shared helper of the LIVE tests of the AI work link (scripts/verify/awl-live/*.live.test.ts).
//
// These tests call the DEPLOYED Edge Function over real HTTPS with a THROWAWAY link, so they are not part of the CI `bun test` run (bunfig
// root is `src`; these files live outside it on purpose). Run them by hand:
//   bun test --isolate scripts/verify/awl-live/
// With no Supabase access token available every live test skips itself (it never fails for lack of a credential).
//
// SECRETS. The access token is read from the process environment (SUPABASE_ACCESS_TOKEN) or from the owner's C:\ct\ct\.env.local /
// the repository's .env.local. It is never printed. A throwaway link token is a credential too: every message built here passes through
// redact(), and the tests must not put a link URL into an assertion message.
//
// WHAT IT CHANGES. mintThrowaway() calls public.ai_work_link_mint_user_for (the repository's own mint function, drizzle/0668) through the
// Supabase Management API, which makes ONE short-lived (1 day), level-0-or-1 link for a named test person. revoke() sets that link to
// 'revoked'. Callers MUST revoke in afterAll. Minting a user link stops the person's previous user link (drizzle/0668), so the callers use
// people of the e2e test organisation that nobody else is using (never the person whose link a retest is running on).
import { existsSync, readFileSync } from "node:fs"

export const PROJECT_REF = "pcrjmlpuqsbocqfwoxod"
export const AWL_BASE = process.env.AWL_LIVE_BASE || `https://${PROJECT_REF}.supabase.co/functions/v1/ai-work-link`
const MGMT_QUERY = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
const ENV_FILES = ["C:\\ct\\ct\\.env.local", ".env.local"]

let cachedToken: string | null | undefined
export function accessToken(): string | null {
  if (cachedToken !== undefined) return cachedToken
  let tok = (process.env.SUPABASE_ACCESS_TOKEN || "").trim()
  if (!tok) {
    for (const f of ENV_FILES) {
      if (!existsSync(f)) continue
      const line = readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="))
      if (line) { tok = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""); break }
    }
  }
  cachedToken = tok || null
  return cachedToken
}

/** True when the live tests can run: a management token is available and AWL_LIVE is not "0". */
export const liveEnabled = (): boolean => process.env.AWL_LIVE !== "0" && accessToken() !== null

const secrets = new Set<string>()
export function redact(text: string): string {
  let out = String(text)
  for (const s of [...secrets, accessToken() ?? ""]) if (s && s.length >= 8) out = out.split(s).join("[redacted]")
  return out.replace(/pxa_[0-9a-f]{16,}/g, "pxa_[redacted]")
}

/**
 * One statement through the Management API. The live database is sometimes saturated (answers 544 "connection timeout" or 5xx), so the call
 * is retried up to 4 times with a growing pause. Every statement used by these tests is safe to repeat: a second mint only stops the first
 * link of the same person, and a revoke or a read changes nothing the second time.
 */
export async function mgmtSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const tok = accessToken()
  if (!tok) throw new Error("no Supabase access token available")
  let last = ""
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((res) => setTimeout(res, 3000 * attempt))
    try {
      const r = await fetch(MGMT_QUERY, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(60_000) })
      const text = await r.text()
      if (r.status < 300) return JSON.parse(text) as T[]
      last = redact(`management query failed ${r.status}: ${text.slice(0, 300)}`)
      if (r.status < 500 && r.status !== 429) break // a 4xx is our mistake: do not repeat it
    } catch (e) {
      last = redact(`management query not sent: ${String((e as Error)?.message ?? e)}`)
    }
  }
  throw new Error(last)
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export type Throwaway = { id: string; token: string; url: string; userId: string; level: number; scope: string }

/** Make one 1-day user link for a test person. The token is registered for redaction. */
export async function mintThrowaway(userId: string, label: string): Promise<Throwaway> {
  if (!ID_RE.test(userId)) throw new Error("bad user id")
  const safeLabel = label.replace(/[^A-Za-z0-9 _.:-]/g, "").slice(0, 60)
  const rows = await mgmtSql<{ ai_work_link_mint_user_for: { link_id: string; token: string; level: number; scope: string } }>(
    `select public.ai_work_link_mint_user_for('${userId}', 1, '${safeLabel}')`,
  )
  const j = rows[0]?.ai_work_link_mint_user_for
  if (!j?.token) throw new Error("mint returned no token")
  secrets.add(j.token)
  return { id: j.link_id, token: j.token, url: `${AWL_BASE}/${j.token}`, userId, level: j.level, scope: j.scope }
}

/** Make one 1-day link for ONE project (level 0: read, check, draft). Used for the card-data page, which is project-only. */
export async function mintProjectLink(userId: string, projectId: string, label: string): Promise<Throwaway> {
  if (!ID_RE.test(userId) || !ID_RE.test(projectId)) throw new Error("bad id")
  const safeLabel = label.replace(/[^A-Za-z0-9 _.:-]/g, "").slice(0, 60)
  const rows = await mgmtSql<{ r: { link_id: string; token: string; level: number; scope?: string } }>(
    `select public.ai_work_link_mint_for('${userId}', '${projectId}', 0, null, 1, true, '${safeLabel}') as r`,
  )
  const j = rows[0]?.r
  if (!j?.token) throw new Error("mint returned no token")
  secrets.add(j.token)
  return { id: j.link_id, token: j.token, url: `${AWL_BASE}/${j.token}`, userId, level: j.level, scope: j.scope ?? "project" }
}

/** Revoke a link (the same update the owner's runbook uses). Safe to call twice. */
export async function revoke(id: string): Promise<void> {
  if (!ID_RE.test(id)) throw new Error("bad link id")
  await mgmtSql(`update platform.user_ai_links set status = 'revoked', revoked_at = now() where id = '${id}' and status <> 'revoked'`)
}

export async function linkStatus(id: string): Promise<string | null> {
  if (!ID_RE.test(id)) throw new Error("bad link id")
  const rows = await mgmtSql<{ status: string }>(`select status from platform.user_ai_links where id = '${id}'`)
  return rows[0]?.status ?? null
}

/** The people of the e2e test organisation used by the lane-2 tests (checked at run time, so a renamed person fails loudly). */
export const PEOPLE = {
  // manager, many projects; used for the speed run and the read tests
  manager: "316f9970-cf01-4904-9641-3fa861ce9e7f",
  // client_viewer: must never be able to write
  viewer: "12109ea8-44c7-4162-be8a-c664d910b071",
  // member: money is hidden, no admin actions
  member: "d0a96fdb-28b0-4ef8-a270-89936fc90156",
  // a second manager and member for the files that run after (or beside) the ones above: minting a user link stops that person's previous
  // user link, so two files must never use the same person at the same time
  manager2: "ed6981cf-9033-44ec-8099-7d9888402159",
  member2: "9734a8bc-a273-4e91-a5be-c76a6c0fc7dc",
  // for the files that only read and do not care about the role: the database caps minting at 10 links an hour and 30 a day PER PERSON, so each
  // file spends its mints on its own person instead of exhausting one
  reader: "240a62e7-c92f-4958-9fa2-1e58a69e1ca3", // team_member
  reader2: "7f82a080-db64-4f0b-9ec7-61a18900d033", // senior_professional
} as const
export const E2E_ORG = "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d"

export async function expectPerson(userId: string, role: string): Promise<void> {
  const rows = await mgmtSql<{ role: string; org_id: string; is_active: boolean }>(`select role::text as role, org_id, is_active from compliance.users where id = '${userId}'`)
  const u = rows[0]
  if (!u || u.role !== role || u.org_id !== E2E_ORG || !u.is_active) throw new Error(`test person ${userId} is no longer an active ${role} of the e2e organisation`)
}

/** A project of ANOTHER organisation (for the cross-organisation probes). Read-only. */
export async function foreignProjectId(): Promise<string> {
  const rows = await mgmtSql<{ id: string }>(`select id from compliance.projects where org_id <> '${E2E_ORG}' and org_id is not null order by id limit 1`)
  if (!rows[0]) throw new Error("no project of another organisation exists")
  return rows[0].id
}

/**
 * One HTTP call to the live function. Returns status, headers, text and timing; never throws on a non-2xx.
 * A 503 (database saturated) is retried the same way. A call that never reached the server (connection refused, reset, DNS, timeout: this laptop's network does that now and then) is retried up
 * to 3 times, but only when it is safe to send twice: a GET, or a POST the caller marks `idempotent` (dry runs, MCP reads, refusals).
 */
export const stats = { retried503: 0 }

export async function call(url: string, init: RequestInit & { idempotent?: boolean } = {}): Promise<{ status: number; headers: Headers; text: string; json: any; ms: number }> {
  const { idempotent, ...rest } = init
  const safeToRepeat = (rest.method ?? "GET").toUpperCase() === "GET" || idempotent === true
  let lastErr: unknown
  for (let attempt = 0; attempt < (safeToRepeat ? 3 : 1); attempt++) {
    const t0 = performance.now()
    try {
      const r = await fetch(url, { ...rest, signal: AbortSignal.timeout(45_000) })
      const text = await r.text()
      const ms = performance.now() - t0
      // 503 is how the function says "the call log / database did not answer" (it writes the log before it answers anything, so nothing
      // was read or changed). A repeatable call waits and tries again; the count is kept in `stats` so the saturation stays visible.
      if (r.status === 503 && safeToRepeat && attempt < 2) {
        stats.retried503++
        await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)))
        continue
      }
      let json: any = null
      try { json = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, headers: r.headers, text, json, ms }
    } catch (e) {
      lastErr = e
      await new Promise((res) => setTimeout(res, 1500))
    }
  }
  throw new Error(redact(`request failed after retries: ${String((lastErr as Error)?.message ?? lastErr)}`))
}

export const jsonHeaders = { accept: "application/json", "content-type": "application/json" }
