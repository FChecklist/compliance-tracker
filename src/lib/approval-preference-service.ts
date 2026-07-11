// Wave 161 (VERI_CHAT_GOVERNANCE.md, "VERI-Assisted Communication
// Protocol"). First dispatched to governance_backend_engineer (DeepSeek V4
// Pro) -- that run exhausted its iteration budget partway through and
// worked around the gap with a nonexistent companion schema file rather
// than the real schema.ts export it was asked for; audited (Rule 7c) and
// corrected here rather than merged broken or discarded outright, since
// the table design and function signatures it produced were sound.
import { eq, and, isNull } from "drizzle-orm"
import { approvalPreferences } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"

export type ApprovalDecision = "always_approve" | "always_reject"
export type ApprovalScopeType = "communication_type" | "conversation" | "task" | "workflow"

/**
 * Most-specific-scope-wins lookup: a scopeId match beats a scopeType-only
 * (scopeId IS NULL) preference beats no match at all -- mirrors
 * module-rules-resolver.ts's existing most-specific-scope precedent.
 */
export async function checkApprovalPreference(
  db: TenantDb, orgId: string, userId: string,
  actionCategory: string, scopeType: ApprovalScopeType, scopeId?: string
): Promise<ApprovalDecision | null> {
  if (scopeId) {
    const specific = await db.query.approvalPreferences.findFirst({
      where: and(
        eq(approvalPreferences.orgId, orgId),
        eq(approvalPreferences.userId, userId),
        eq(approvalPreferences.actionCategory, actionCategory),
        eq(approvalPreferences.scopeType, scopeType),
        eq(approvalPreferences.scopeId, scopeId)
      ),
    })
    if (specific) return specific.decision as ApprovalDecision
  }
  const typeLevel = await db.query.approvalPreferences.findFirst({
    where: and(
      eq(approvalPreferences.orgId, orgId),
      eq(approvalPreferences.userId, userId),
      eq(approvalPreferences.actionCategory, actionCategory),
      eq(approvalPreferences.scopeType, scopeType),
      isNull(approvalPreferences.scopeId)
    ),
  })
  return (typeLevel?.decision as ApprovalDecision) ?? null
}

/**
 * Find-then-insert-or-update, not a DB-level ON CONFLICT -- a unique index
 * over the nullable scopeId column wouldn't match NULL-to-NULL the way a
 * naive upsert target assumes (the bug in the first dispatch attempt).
 */
export async function saveApprovalPreference(
  db: TenantDb, orgId: string, userId: string,
  actionCategory: string, scopeType: ApprovalScopeType, scopeId: string | undefined, decision: ApprovalDecision
): Promise<void> {
  const scopeCondition = scopeId ? eq(approvalPreferences.scopeId, scopeId) : isNull(approvalPreferences.scopeId)
  const existing = await db.query.approvalPreferences.findFirst({
    where: and(
      eq(approvalPreferences.orgId, orgId),
      eq(approvalPreferences.userId, userId),
      eq(approvalPreferences.actionCategory, actionCategory),
      eq(approvalPreferences.scopeType, scopeType),
      scopeCondition
    ),
  })
  if (existing) {
    await db.update(approvalPreferences).set({ decision, updatedAt: new Date() }).where(eq(approvalPreferences.id, existing.id))
    return
  }
  await db.insert(approvalPreferences).values({
    orgId, userId, scopeType, scopeId: scopeId ?? null, actionCategory, decision,
  })
}
