import { db, apiKeys, apiKeyRequestLog } from "@/lib/db"
import { eq, and, gte, sql } from "drizzle-orm"
import { hashSHA256 } from "@/lib/api-keys"

export type ApiKeyContext = {
  orgId: string
  scopes: string[]
  keyId: string
  keyName: string
}

// Wave 96 (Comparison CSV 3 gap analysis: API002/API009): a discriminated
// result instead of `ApiKeyContext | null` so requireAuthOrApiKey() can
// return a real 429 with Retry-After, distinct from a plain 401 for an
// invalid/missing key -- the previous null-only contract couldn't express
// "this key IS valid, but it's over its limit right now."
export type ValidateApiKeyResult =
  | { status: "ok"; context: ApiKeyContext }
  | { status: "invalid" }
  | { status: "rate_limited"; retryAfterSeconds: number }

const RATE_LIMIT_WINDOW_SECONDS = 60

// Wave A (VERIDIAN Review Framework remediation, 2026-07-17, security/bug
// quick-fix item 1): keys minted with a literal, hand-chosen `id` instead
// of the standard createId() cuid every properly-provisioned key gets (see
// POST /api/settings/api-keys and /api/v1/platform/provision-org, both of
// which rely on apiKeys.id's $defaultFn) are demo/seed keys, not real
// customer-provisioned ones. "projexa_demo_key" is the one confirmed live
// in production (2026-07-17, compliance.api_keys): scopes "read,write"
// (unrestricted), rate_limit_per_minute null (unlimited) -- every opt-in
// restriction this table supports was left off -- plus, until this fix, no
// environment gate of any kind, and last_used_at showing real production
// traffic as recently as 2026-07-15.
//
// Gated the same way every platform API key already is in this codebase
// (see orchestra-model-resolver.ts's platformApiKeyFor -- GROQ_API_KEY,
// OPENROUTER_API_KEY, etc.): an env var's PRESENCE enables the capability,
// not a NODE_ENV/VERCEL_ENV branch (grepped this repo for precedent --
// the only existing NODE_ENV check anywhere, in instrumentation-client.ts,
// is a Sentry sample-rate tweak, not an access-control decision; keying off
// NODE_ENV/VERCEL_ENV directly would also misclassify or silently no-op
// across preview builds and local `bun test`/dev, which have no VERCEL_ENV
// at all). DEMO_API_KEY_IDS unset (the default in every environment,
// including current production) rejects every listed key outright with the
// same { status: "invalid" } a missing/garbage key already gets -- no new
// failure mode, no DB write required, fully reversible by setting the env
// var if a real demo/staging need is confirmed later (e.g.
// DEMO_API_KEY_IDS=projexa_demo_key in a preview/staging environment only).
// Does not delete or deactivate the key itself -- it may still be genuinely
// needed for PROJEXA's own local/preview development against a shared demo
// org -- this closes the specific gap: the key working from a live
// production deployment with no restriction at all.
const KNOWN_DEMO_KEY_IDS = new Set(["projexa_demo_key"])

function demoKeyAllowlist(): Set<string> {
  return new Set(
    (process.env.DEMO_API_KEY_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  )
}

/**
 * Resolves an `Authorization: Bearer vk_...` header to the org/scopes it
 * grants. Uses the raw (RLS-bypassing) db client deliberately -- this IS
 * the authentication step itself, so it necessarily runs before any tenant
 * context exists to scope a query by (same reasoning as `autoProvisionUser`
 * in auth-guard.ts). Also enforces the key's own rate_limit_per_minute (null
 * = unlimited, every pre-existing key's exact prior behavior), rejects a
 * known demo/seed key unless explicitly allowlisted via DEMO_API_KEY_IDS
 * (see KNOWN_DEMO_KEY_IDS above), and logs the request into
 * api_key_request_log for both the rate-limit count and the usage-analytics
 * dashboard.
 */
export async function validateApiKey(request: Request): Promise<ValidateApiKeyResult> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return { status: "invalid" }
  const token = authHeader.slice(7).trim()
  if (!token || !token.startsWith("vk_")) return { status: "invalid" }

  const keyHash = await hashSHA256(token)
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, keyHash) })
  if (!row || !row.isActive) return { status: "invalid" }

  if (KNOWN_DEMO_KEY_IDS.has(row.id) && !demoKeyAllowlist().has(row.id)) return { status: "invalid" }

  const route = new URL(request.url).pathname

  if (row.rateLimitPerMinute !== null) {
    const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000)
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(apiKeyRequestLog)
      .where(and(eq(apiKeyRequestLog.apiKeyId, row.id), gte(apiKeyRequestLog.createdAt, cutoff)))

    if (Number(count) >= row.rateLimitPerMinute) {
      db.insert(apiKeyRequestLog).values({
        apiKeyId: row.id, orgId: row.orgId, route, method: request.method, wasRateLimited: true,
      }).then(() => {})
      return { status: "rate_limited", retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS }
    }
  }

  // Fire-and-forget, matches the existing mcp_access_codes last_used_at
  // pattern in api/mcp/route.ts -- don't block the caller's response on it.
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).then(() => {})
  db.insert(apiKeyRequestLog).values({
    apiKeyId: row.id, orgId: row.orgId, route, method: request.method, wasRateLimited: false,
  }).then(() => {})

  return {
    status: "ok",
    context: {
      orgId: row.orgId,
      scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
      keyId: row.id,
      keyName: row.name,
    },
  }
}
