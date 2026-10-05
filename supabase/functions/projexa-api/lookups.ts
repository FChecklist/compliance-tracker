// The two reads of the PROJEXA Supabase project the edge proxy needs. Pure (fetch injected) so the tests run them against a fake PostgREST.
//
//   membership(token, sub)  PROJEXA public.memberships, read WITH THE PERSON'S OWN TOKEN and the project's public anon key, so PROJEXA's row level
//                           security ("users can view their own memberships") decides, exactly as src/lib/supabase/auth-guard.ts requireAuth() does.
//                           Oldest membership first (R81_F03: the same order as requireAuth() and src/middleware.ts).
//   orgKey(orgId)           PROJEXA public.veridian_credentials.veridian_api_key, which only the service role may read (drizzle/0001 of projexa).
//                           Remembered for 5 minutes per isolate (a rotated key is picked up within 5 minutes); "no row" is never remembered.
import type { Membership, MembershipLookup } from "./handler.ts"

export const LOOKUP_TIMEOUT_MS = 5_000
export const KEY_TTL_MS = 300_000

async function getJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>): Promise<{ ok: true; rows: unknown[] } | { ok: false }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { headers: { ...headers, Accept: "application/json" }, signal: controller.signal })
    if (!res.ok) return { ok: false }
    const rows = await res.json()
    return Array.isArray(rows) ? { ok: true, rows } : { ok: false }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createMembershipLookup(o: { projexaUrl: string; anonKey: string; fetchImpl?: typeof fetch }): MembershipLookup {
  return async (token, sub) => {
    if (!o.projexaUrl || !o.anonKey || !UUID_RE.test(sub)) return { ok: false }
    const url = `${o.projexaUrl.replace(/\/+$/, "")}/rest/v1/memberships?select=organization_id,role&user_id=eq.${encodeURIComponent(sub)}&order=created_at.asc&limit=1`
    const out = await getJson(o.fetchImpl ?? fetch, url, { apikey: o.anonKey, Authorization: `Bearer ${token}` })
    if (!out.ok) return { ok: false }
    const row = out.rows[0] as { organization_id?: unknown; role?: unknown } | undefined
    if (!row) return { ok: true, row: null }
    if (typeof row.organization_id !== "string") return { ok: false }
    const m: Membership = { organization_id: row.organization_id, role: typeof row.role === "string" ? row.role : null }
    return { ok: true, row: m }
  }
}

export function createOrgKeyLookup(o: { projexaUrl: string; serviceRoleKey: string; fetchImpl?: typeof fetch; now?: () => number }): (orgId: string) => Promise<string | null> {
  const cache = new Map<string, { key: string; at: number }>()
  const now = o.now ?? (() => Date.now())
  return async (orgId) => {
    if (!o.projexaUrl || !o.serviceRoleKey || !UUID_RE.test(orgId)) return null
    const hit = cache.get(orgId)
    if (hit && now() - hit.at < KEY_TTL_MS) return hit.key
    const url = `${o.projexaUrl.replace(/\/+$/, "")}/rest/v1/veridian_credentials?select=veridian_api_key&organization_id=eq.${encodeURIComponent(orgId)}&limit=1`
    const out = await getJson(o.fetchImpl ?? fetch, url, { apikey: o.serviceRoleKey, Authorization: `Bearer ${o.serviceRoleKey}` })
    if (!out.ok) return null
    const key = (out.rows[0] as { veridian_api_key?: unknown } | undefined)?.veridian_api_key
    if (typeof key !== "string" || !key) return null
    cache.set(orgId, { key, at: now() })
    if (cache.size > 1000) cache.delete(cache.keys().next().value as string)
    return key
  }
}
