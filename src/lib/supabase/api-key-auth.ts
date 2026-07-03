import { db, apiKeys } from "@/lib/db"
import { eq } from "drizzle-orm"
import { hashSHA256 } from "@/lib/api-keys"

export type ApiKeyContext = {
  orgId: string
  scopes: string[]
  keyId: string
  keyName: string
}

/**
 * Resolves an `Authorization: Bearer vk_...` header to the org/scopes it
 * grants. Uses the raw (RLS-bypassing) db client deliberately -- this IS
 * the authentication step itself, so it necessarily runs before any tenant
 * context exists to scope a query by (same reasoning as `autoProvisionUser`
 * in auth-guard.ts).
 */
export async function validateApiKey(request: Request): Promise<ApiKeyContext | null> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice(7).trim()
  if (!token || !token.startsWith("vk_")) return null

  const keyHash = await hashSHA256(token)
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, keyHash) })
  if (!row || !row.isActive) return null

  // Fire-and-forget, matches the existing mcp_access_codes last_used_at
  // pattern in api/mcp/route.ts -- don't block the caller's response on it.
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).then(() => {})

  return {
    orgId: row.orgId,
    scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    keyId: row.id,
    keyName: row.name,
  }
}
