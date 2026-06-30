import { db, auditPoints, auditLogs, users } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createId } from "@paralleldrive/cuid2"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  try {
    const { id } = await context.params
    const { status } = await request.json()

    const ap = await db.query.auditPoints.findFirst({ where: eq(auditPoints.id, id) })
    if (!ap) return NextResponse.json({ error: 'Audit point not found' }, { status: 404 })

    const updateData: Record<string, unknown> = { status, updatedAt: new Date() }
    if (status === 'completed') updateData.completedAt = new Date()
    else updateData.completedAt = null

    await db.update(auditPoints).set(updateData as never).where(eq(auditPoints.id, id))

    const actor = dbUser ?? await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (actor) {
      await db.insert(auditLogs).values({
        id: createId(),
        action: 'status_change',
        entityType: 'AuditPoint',
        entityId: id,
        userId: actor.id,
        details: `Audit point marked ${status}`,
        createdAt: new Date(),
      })
    }

    return NextResponse.json({ id, status })
  } catch (error) {
    console.error('Audit point PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update audit point' }, { status: 500 })
  }
}
