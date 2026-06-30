import { db, complianceItems } from "@/lib/db"
import { NextResponse } from "next/server"
import { and, lt, not, inArray } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"

export async function POST() {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const now = new Date()
    const result = await db.update(complianceItems)
      .set({ status: 'overdue', updatedAt: now })
      .where(
        and(
          lt(complianceItems.dueDate, now),
          not(inArray(complianceItems.status, ['completed', 'not_applicable', 'overdue']))
        )
      )
      .returning({ id: complianceItems.id })

    return NextResponse.json({ updated: result.length, updatedAt: now.toISOString() })
  } catch (error) {
    console.error('Overdue sync error:', error)
    return NextResponse.json({ error: 'Failed to sync overdue status' }, { status: 500 })
  }
}
