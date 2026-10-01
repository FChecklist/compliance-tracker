// FIRST-USER SELF-HEAL (fix/awl-first-user-self-heal; SQL: drizzle/0675). A fresh PROJEXA signup gets a VERIDIAN organisation and key but no
// compliance.users row, so projexa_read_resolve_user answers not_linked. This file is the one place that repairs it, and only for the first person.
//
// THE CHAIN. The session token (verified by session.ts) names the PROJEXA person (sub, email). The organisation is NEVER taken from the caller:
// it is read from the PROJEXA project's own database by calling public.veridian_org_for_owner() there with the person's OWN session token
// (supabase/functions/ai-work-link/projexa-project-veridian-org-for-owner.sql). That function answers only the VERIDIAN organisation ids of the
// PROJEXA organisations the token's person OWNS. Exactly one id is required. Then public.projexa_ensure_first_user (drizzle/0675) creates the
// organisation's first user only if the organisation was provisioned by a platform application and has no user at all.
// Only a token issued by the PROJEXA Auth project can run this (a VERIDIAN-issued token has no PROJEXA membership).
import type { Rpc } from "./reads.ts"

// The PROJEXA project's URL and its PUBLISHABLE (anon) key: public by design, shipped in every PROJEXA page; they grant nothing a token does not.
export const PROJEXA_REST_URL = "https://evpckeuxgvahguwsaeul.supabase.co"
export const PROJEXA_PUBLISHABLE_KEY = "sb_publishable_f0C6ZvVjEnwkdN7wxfEwBQ_x69zrGs8" // gitleaks:allow (a publishable key: public by design)
export const PROJEXA_ISSUER_FOR_HEAL = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type HealWho = { sub: string; email: string | null; issuer: string }
export type HealDeps = { rpc: Rpc; fetch?: typeof fetch; log?: (line: string) => void }

/** True when a user row now exists for this person (created now, or already there): the caller should look the person up again. */
export async function ensureFirstUser(token: string, who: HealWho, deps: HealDeps): Promise<boolean> {
  const log = deps.log ?? ((l: string) => console.log(l))
  if (who.issuer !== PROJEXA_ISSUER_FOR_HEAL || !who.email || !EMAIL_RE.test(who.email)) return false
  try {
    const res = await (deps.fetch ?? fetch)(`${PROJEXA_REST_URL}/rest/v1/rpc/veridian_org_for_owner`, {
      method: "POST",
      headers: { apikey: PROJEXA_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    })
    if (!res.ok) return false
    const rows = await res.json()
    const ids = Array.isArray(rows) ? rows.map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).veridian_org_id : null)).filter((v): v is string => typeof v === "string" && v !== "") : []
    if (ids.length !== 1) return false
    const out = await deps.rpc("projexa_ensure_first_user", { p_org_id: ids[0], p_auth_user_id: who.sub, p_email: who.email, p_name: null })
    if (out.error) return false
    const row = Array.isArray(out.data) ? out.data[0] : out.data
    const outcome = row && typeof row === "object" ? (row as Record<string, unknown>).outcome : null
    log(`ai-work-link: first-user self-heal -> ${typeof outcome === "string" ? outcome : "unknown"}`)
    return outcome === "created" || outcome === "already_linked"
  } catch {
    return false
  }
}
