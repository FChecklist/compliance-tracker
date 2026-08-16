// PLATFORM-01 Wave 1 (Workstream 1): validates a platform-level service
// credential (Authorization: Bearer pk_...), analogous to api-key-auth.ts's
// validateApiKey() but for a categorically different caller -- a sibling
// product's own BACKEND (e.g. PROJEXA), not a human session and not a
// customer's own vk_... apiKeys row. Deliberately a separate function/table
// (platform_applications, not apiKeys) so a leaked customer vk_... key can
// never be used to provision new orgs, and a leaked platform pk_... key
// can never be used to read/write one specific customer's data -- the two
// credential classes have disjoint blast radii by construction.
import { db, platformApplications } from "@/lib/db"
import { eq } from "drizzle-orm"
import { hashSHA256 } from "@/lib/api-keys"

export type PlatformApplicationContext = {
  id: string
  applicationKey: string
  displayName: string
}

export type ValidatePlatformApplicationKeyResult =
  | { status: "ok"; context: PlatformApplicationContext }
  | { status: "invalid" }

/**
 * Resolves an `Authorization: Bearer pk_...` header to the calling
 * platform_applications row. Uses the raw (RLS-bypassing) db client
 * deliberately -- this IS the authentication step itself, identical
 * reasoning to validateApiKey() and autoProvisionUser() elsewhere in this
 * codebase (there is no tenant context yet at the authentication step).
 */
export async function validatePlatformApplicationKey(request: Request): Promise<ValidatePlatformApplicationKeyResult> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return { status: "invalid" }
  const token = authHeader.slice(7).trim()
  if (!token || !token.startsWith("pk_")) return { status: "invalid" }

  const keyHash = await hashSHA256(token)
  const row = await db.query.platformApplications.findFirst({ where: eq(platformApplications.keyHash, keyHash) })
  if (!row || !row.isActive) return { status: "invalid" }

  return {
    status: "ok",
    context: { id: row.id, applicationKey: row.applicationKey, displayName: row.displayName },
  }
}
