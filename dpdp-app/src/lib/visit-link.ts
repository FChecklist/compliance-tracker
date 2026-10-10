// Visit journey, the signed-in app's side (owner spec 2026-10-06). The public pages (public/visit.js) keep a random visitor id; here we do exactly two small things with it:
//
//   1. noteSignInStart(): a person who came from the public pages asks for a sign-in link -> one "sign_in_start" step on their EXISTING visit (anonymous, same /api/visit beacon).
//   2. linkVisitToPerson(): once signed in, tell dpdp-track the visitor id; the SERVER links it to the person's identity id (never an e-mail) and adds a page view named "app:home".
//
// Nothing else is recorded on the signed-in screens (the audit trail already covers what people do there). No id, no call: a browser that sent Global Privacy Control / Do Not Track never
// got a visitor id, so both functions return at once. Silent on any failure; never in the way of signing in.
import type { DpdpClient } from "./client"

const FUNCTIONS = `${(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1/dpdp-track`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ""
const LINKED_FLAG = "dpdp_visit_linked"
const HEX = /^[a-f0-9]{16,64}$/

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
type Store = Pick<Storage, "getItem" | "setItem">

/** The visitor id the public pages kept (cookie first, then local storage), or null (never visited the public pages, or a privacy signal was on). */
export function readVisitorId(cookie: string = typeof document === "undefined" ? "" : document.cookie, storage: Store | null = typeof localStorage === "undefined" ? null : localStorage): string | null {
  try {
    const m = /(?:^|; )dpdp_vid=([^;]*)/.exec(cookie)
    if (m && HEX.test(m[1]!)) return m[1]!
    const v = storage?.getItem("dpdp_vid") ?? ""
    return HEX.test(v) ? v : null
  } catch {
    return null
  }
}

function privacySignalOn(): boolean {
  const n = (typeof navigator === "undefined" ? {} : navigator) as { globalPrivacyControl?: boolean; doNotTrack?: string }
  return n.globalPrivacyControl === true || n.doNotTrack === "1"
}

export async function noteSignInStart(fetchImpl: FetchLike = fetch, session: Store | null = typeof sessionStorage === "undefined" ? null : sessionStorage): Promise<void> {
  try {
    if (privacySignalOn()) return
    const vid = readVisitorId()
    const sid = session?.getItem("dpdp_sid") ?? ""
    if (!vid || !/^[a-f0-9]{16,40}$/.test(sid)) return
    const body = JSON.stringify({ sid, vid, p: "/", e: [{ k: "step", n: "sign_in_start" }] })
    await fetchImpl("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
  } catch { /* never in the way of signing in */ }
}

/** Once per tab session after sign-in. */
export async function linkVisitToPerson(client: DpdpClient, fetchImpl: FetchLike = fetch, session: Store | null = typeof sessionStorage === "undefined" ? null : sessionStorage): Promise<void> {
  try {
    if (privacySignalOn()) return
    const vid = readVisitorId()
    if (!vid || session?.getItem(LINKED_FLAG) === vid) return
    const token = await client.accessToken()
    if (!token) return
    const res = await fetchImpl(`${FUNCTIONS}/link`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(ANON ? { apikey: ANON } : {}) }, body: JSON.stringify({ vid }), keepalive: true })
    // Remembered only once the server could name an identity; until then the next page load tries again (a brand-new person has none until their organisation exists).
    const out = res.ok ? ((await res.json().catch(() => null)) as { identity?: boolean } | null) : null
    if (out?.identity) session?.setItem(LINKED_FLAG, vid)
    const sid = session?.getItem("dpdp_sid") ?? ""
    if (/^[a-f0-9]{16,40}$/.test(sid)) {
      await fetchImpl("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid, vid, p: "/", e: [{ k: "pv", p: "app:home" }] }), keepalive: true })
    }
  } catch { /* never in the way of signing in */ }
}
