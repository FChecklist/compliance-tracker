// The two reads of the PROJEXA Supabase project the edge proxy needs. Pure (fetch injected) so the tests run them against a fake PostgREST.
//
//   membership(token, sub)  PROJEXA public.memberships, read WITH THE PERSON'S OWN TOKEN and the project's public anon key, so PROJEXA's row level
//                           security ("users can view their own memberships") decides, exactly as src/lib/supabase/auth-guard.ts requireAuth() does.
//                           Oldest membership first (R81_F03: the same order as requireAuth() and src/middleware.ts).
//   orgKey(orgId)           PROJEXA public.veridian_credentials.veridian_api_key, which only the service role may read (drizzle/0001 of projexa).
//                           Remembered for 5 minutes per isolate (a rotated key is picked up within 5 minutes); "no row" is never remembered.
import type { CompanyMembershipLookup, Membership, MembershipLookup } from "./handler.ts"

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

/** AUDIT-100 A2 batch 8: the person's membership of ONE named company (src/lib/company-scope.ts requireCompanyScope), read like the oldest one: the person's own
 *  token under row level security. A company id or person id that is not a UUID is a failed lookup (the Next route's database refuses it too). */
export function createCompanyMembershipLookup(o: { projexaUrl: string; anonKey: string; fetchImpl?: typeof fetch }): CompanyMembershipLookup {
  return async (token, sub, companyId) => {
    if (!o.projexaUrl || !o.anonKey || !UUID_RE.test(sub) || !UUID_RE.test(companyId)) return { ok: false }
    const url = `${o.projexaUrl.replace(/\/+$/, "")}/rest/v1/memberships?select=role&user_id=eq.${encodeURIComponent(sub)}&organization_id=eq.${encodeURIComponent(companyId)}&limit=1`
    const out = await getJson(o.fetchImpl ?? fetch, url, { apikey: o.anonKey, Authorization: `Bearer ${token}` })
    if (!out.ok) return { ok: false }
    const row = out.rows[0] as { role?: unknown } | undefined
    return { ok: true, row: row ? { role: typeof row.role === "string" ? row.role : null } : null }
  }
}

/** G-09: the verdian-ai service-role rpc that reads the compliance-side credentials table (public.projexa_org_credential_get, drizzle/0729). */
export type CredentialRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>

export function createOrgKeyLookup(o: { projexaUrl: string; serviceRoleKey: string; rpc?: CredentialRpc; fetchImpl?: typeof fetch; now?: () => number }): (orgId: string) => Promise<string | null> {
  const cache = new Map<string, { key: string; at: number }>()
  const now = o.now ?? (() => Date.now())
  return async (orgId) => {
    if ((!o.rpc && (!o.projexaUrl || !o.serviceRoleKey)) || !UUID_RE.test(orgId)) return null
    const hit = cache.get(orgId)
    if (hit && now() - hit.at < KEY_TTL_MS) return hit.key
    // G-09: the compliance-side table is the source of truth; the legacy PROJEXA table answers for an organisation not moved yet
    if (o.rpc) {
      try {
        const r = await o.rpc("projexa_org_credential_get", { p_projexa_org_id: orgId })
        const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { api_key?: unknown } | null | undefined
        if (!r.error && typeof row?.api_key === "string" && row.api_key) {
          cache.set(orgId, { key: row.api_key, at: now() })
          if (cache.size > 1000) cache.delete(cache.keys().next().value as string)
          return row.api_key
        }
      } catch {
        // fall through to the legacy table
      }
    }
    if (!o.projexaUrl || !o.serviceRoleKey) return null
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
