import { auditPoints, auditLogs } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createId } from "@paralleldrive/cuid2"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const { status } = await request.json()

    const result = await withTenantContext({ orgId }, async (db) => {
      // RLS-scoped via the compliance_items join -- returns null if this
      // audit point belongs to another org's compliance item.
      const ap = await db.query.auditPoints.findFirst({ where: eq(auditPoints.id, id) })
      if (!ap) return null

      const updateData: Record<string, unknown> = { status, updatedAt: new Date() }
      if (status === 'completed') updateData.completedAt = new Date()
      else updateData.completedAt = null

      await db.update(auditPoints).set(updateData as never).where(eq(auditPoints.id, id))

      await db.insert(auditLogs).values({
        id: createId(),
        action: 'status_change',
        entityType: 'AuditPoint',
        entityId: id,
        userId: dbUser.id,
        details: `Audit point marked ${status}`,
        createdAt: new Date(),
      })

      return true
    })

    if (!result) return NextResponse.json({ error: 'Audit point not found' }, { status: 404 })
    return NextResponse.json({ id, status })
  } catch (error) {
    console.error('Audit point PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update audit point' }, { status: 500 })
  }
}
