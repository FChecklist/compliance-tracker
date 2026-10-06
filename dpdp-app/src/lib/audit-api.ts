// DPDP audit trail -- the browser's side (owner spec 2026-10-06, items 4 and 9). Talks to the dpdp-audit Edge Function (supabase/functions/dpdp-audit) and to nothing else.
//
// WHAT THE BROWSER MAY SAY: that this person just signed in, that an attempt to sign in failed, and that they opened a record of personal data. It sends the time and time zone
// its own clock shows and a random device id it keeps in this browser; the SERVER adds the address, network, country and browser it actually saw. Nothing in a request here is
// trusted as proof -- the audit row stores the browser's claims as claims.
//
// WHAT THE BROWSER NEVER GETS: a full value. The download is built and masked on the server (e-mail pr***ah@acme.in, other identifiers 203***.45); this file only saves what
// the server sent. It is saved by the signed-in browser itself -- the log is never e-mailed.
import type { DpdpClient } from "./client"

const FUNCTIONS = `${(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1/dpdp-audit`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ""
const DEVICE_KEY = "dpdp_device_id"
const LOGIN_FLAG = "dpdp_login_reported"

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** A random id kept in this browser only: lets an auditor see "the same device again" without ever learning what the device is. */
export function deviceId(storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): string | null {
  try {
    if (!storage) return null
    let id = storage.getItem(DEVICE_KEY)
    if (!id || !/^[a-f0-9]{16,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(12))
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
      storage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

function clientFacts(storage?: Pick<Storage, "getItem" | "setItem"> | null): Record<string, string | null> {
  let tz: string | null = null
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { tz = null }
  return { device_id: deviceId(storage ?? undefined), client_time: new Date().toISOString(), client_tz: tz }
}

/** Once per sign-in per tab (the server also caps it): reports that this person has just signed in. Silent on any failure. */
export async function reportLogin(client: DpdpClient, fetchImpl: FetchLike = fetch, session: Pick<Storage, "getItem" | "setItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage): Promise<void> {
  try {
    if (session?.getItem(LOGIN_FLAG)) return
    const token = await client.accessToken()
    if (!token) return
    session?.setItem(LOGIN_FLAG, "1")
    await fetchImpl(`${FUNCTIONS}/event`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "login", ...clientFacts() }), keepalive: true })
  } catch { /* never in the way of signing in */ }
}
export function forgetLoginReport(session: Pick<Storage, "removeItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage): void {
  try { session?.removeItem(LOGIN_FLAG) } catch { /* nothing to forget */ }
}

/** A code that did not work. No sign-in exists yet, so this is the one anonymous call; the server answers the same to everyone and writes only for a real person. */
export async function reportFailedLogin(email: string, method: string, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    await fetchImpl(`${FUNCTIONS}/event`, { method: "POST", headers: { "Content-Type": "application/json", ...(ANON ? { apikey: ANON } : {}) }, body: JSON.stringify({ type: "failed_login", email, method, ...clientFacts() }), keepalive: true })
  } catch { /* never in the way of signing in */ }
}

export type AuditOrg = { orgId: string; orgName: string | null; canDownloadOwn: boolean; canDownloadOrganisation: boolean; isOwner: boolean; isHod: boolean }
export type AuditOrgs = { orgs: AuditOrg[]; codeFresh: boolean; codeMaxAgeSeconds: number }

async function authed(client: DpdpClient, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response | null> {
  const token = await client.accessToken()
  if (!token) return null
  return fetchImpl(`${FUNCTIONS}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) } })
}

export async function getAuditOrgs(client: DpdpClient, fetchImpl: FetchLike = fetch): Promise<AuditOrgs | null> {
  try {
    const res = await authed(client, "/orgs", { method: "GET" }, fetchImpl)
    return res && res.ok ? ((await res.json()) as AuditOrgs) : null
  } catch {
    return null
  }
}

export type DownloadResult =
  | { ok: true; filename: string; text: string; verificationHash: string }
  | { ok: false; code: "FRESH_CODE_REQUIRED" | "RATE_LIMITED" | "FORBIDDEN" | "SIGNED_OUT" | "ERROR"; message: string }

/** Asks the server for the file. `scope` "own" is the person's own rows; "organisation" needs owner or head of department (the server decides, not this file). */
export async function downloadAuditLog(client: DpdpClient, scope: "own" | "organisation", orgId: string, fetchImpl: FetchLike = fetch): Promise<DownloadResult> {
  try {
    const res = await authed(client, `/${scope === "own" ? "my" : "org"}?org_id=${encodeURIComponent(orgId)}`, { method: "GET" }, fetchImpl)
    if (!res) return { ok: false, code: "SIGNED_OUT", message: "Sign in first." }
    if (res.ok) {
      const cd = res.headers.get("content-disposition") ?? ""
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "dpdp-audit-log.json"
      return { ok: true, filename: name.replace(/[^A-Za-z0-9._-]/g, "_"), text: await res.text(), verificationHash: res.headers.get("x-verification-hash") ?? "" }
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
    const code = body.code === "FRESH_CODE_REQUIRED" ? "FRESH_CODE_REQUIRED" : res.status === 429 ? "RATE_LIMITED" : res.status === 403 ? "FORBIDDEN" : "ERROR"
    return { ok: false, code, message: body.error ?? "That did not work. Try again in a minute." }
  } catch {
    return { ok: false, code: "ERROR", message: "That did not work. Check your connection and try again." }
  }
}

export type VerifyResult = { ok: boolean; rows?: number; detail?: string; reason?: string; error?: string }
export async function verifyAuditChain(client: DpdpClient, orgId: string, fetchImpl: FetchLike = fetch): Promise<VerifyResult> {
  try {
    const res = await authed(client, "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: orgId }) }, fetchImpl)
    if (!res) return { ok: false, error: "Sign in first." }
    const body = (await res.json()) as VerifyResult
    return res.ok ? body : { ok: false, error: body.error ?? "That did not work." }
  } catch {
    return { ok: false, error: "That did not work. Try again in a minute." }
  }
}

/** Saves the text the server sent as a file, from the signed-in browser itself. */
export function saveTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
