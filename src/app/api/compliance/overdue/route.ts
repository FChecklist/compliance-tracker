import { complianceItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextResponse } from "next/server"
import { and, lt, not, inArray, eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"

export async function POST() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ updated: 0, updatedAt: new Date().toISOString() })

  try {
    const now = new Date()
    const result = await withTenantContext({ orgId }, (db) =>
      db.update(complianceItems)
        .set({ status: 'overdue', updatedAt: now })
        .where(
          and(
            eq(complianceItems.orgId, orgId),
            lt(complianceItems.dueDate, now),
            not(inArray(complianceItems.status, ['completed', 'not_applicable', 'overdue']))
          )
        )
        .returning({ id: complianceItems.id })
    )

    return NextResponse.json({ updated: result.length, updatedAt: now.toISOString() })
  } catch (error) {
    console.error('Overdue sync error:', error)
    return NextResponse.json({ error: 'Failed to sync overdue status' }, { status: 500 })
  }
}
