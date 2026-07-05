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

/**
 * Resolves an `Authorization: Bearer vk_...` header to the org/scopes it
 * grants. Uses the raw (RLS-bypassing) db client deliberately -- this IS
 * the authentication step itself, so it necessarily runs before any tenant
 * context exists to scope a query by (same reasoning as `autoProvisionUser`
 * in auth-guard.ts). Also enforces the key's own rate_limit_per_minute (null
 * = unlimited, every pre-existing key's exact prior behavior) and logs the
 * request into api_key_request_log for both the rate-limit count and the
 * usage-analytics dashboard.
 */
export async function validateApiKey(request: Request): Promise<ValidateApiKeyResult> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return { status: "invalid" }
  const token = authHeader.slice(7).trim()
  if (!token || !token.startsWith("vk_")) return { status: "invalid" }

  const keyHash = await hashSHA256(token)
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, keyHash) })
  if (!row || !row.isActive) return { status: "invalid" }

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
