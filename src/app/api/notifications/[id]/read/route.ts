import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const [updated] = await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id)).returning()
    if (!updated) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Notification read API error:', error)
    return NextResponse.json({ error: 'Failed to mark notification as read' }, { status: 500 })
  }
}