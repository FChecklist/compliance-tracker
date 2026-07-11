import { eq, and } from "drizzle-orm";
// NOTE: approvalPreferences should be exported from @/lib/db (schema.ts,
// placed right after dynamicChains).  Until then it is imported from its
// companion schema file so tsc passes.
import { approvalPreferences } from "@/lib/db/approval-preferences-schema";
import type { TenantDB } from "@/lib/db/tenant-scoped";

/**
 * Look up an existing approval preference for the given scope + action.
 *
 * Returns the stored decision string ("approve" / "deny" / …) or `null` when
 * no preference is on file.
 *
 * Matching style: `resolveDynamicChainId` in task-service.ts.
 */
export async function checkApprovalPreference(
  db: TenantDB,
  orgId: string,
  userId: string,
  actionCategory: string,
  scopeType: string,
  scopeId?: string,
): Promise<string | null> {
  const pref = await db.query.approvalPreferences.findFirst({
    where: and(
      eq(approvalPreferences.orgId, orgId),
      eq(approvalPreferences.userId, userId),
      eq(approvalPreferences.actionCategory, actionCategory),
      eq(approvalPreferences.scopeType, scopeType),
      // Only filter on scopeId when one was provided; when absent we
      // match rows where scope_id IS NULL.
      scopeId !== undefined
        ? eq(approvalPreferences.scopeId, scopeId)
        : undefined,
    ),
  });

  return pref?.decision ?? null;
}

/**
 * Persist (or overwrite) an approval preference row.
 *
 * Uses `onConflictDoUpdate` on the unique index
 * `idx_approval_preferences_org_user_scope_action` so that repeated calls
 * for the same (org, user, scope, action) tuple update the existing
 * row rather than creating duplicates.
 *
 * Matching style: `db.insert(…).values(…).returning()` pattern in
 * task-service.ts.
 */
export async function saveApprovalPreference(
  db: TenantDB,
  orgId: string,
  userId: string,
  actionCategory: string,
  scopeType: string,
  scopeId: string | undefined,
  decision: string,
): Promise<void> {
  await db
    .insert(approvalPreferences)
    .values({
      id: crypto.randomUUID(),
      orgId,
      userId,
      scopeType,
      scopeId: scopeId ?? null,
      actionCategory,
      decision,
    })
    .onConflictDoUpdate({
      target: [
        approvalPreferences.orgId,
        approvalPreferences.userId,
        approvalPreferences.scopeType,
        approvalPreferences.scopeId,
        approvalPreferences.actionCategory,
      ],
      set: {
        decision,
        updatedAt: new Date(),
      },
    });
}
