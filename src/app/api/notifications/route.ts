import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'

export async function GET() {
  try {
    const adminUser = await db.query.users.findFirst({ where: (f, { eq }) => eq(f.role, 'admin') })
    if (!adminUser) return NextResponse.json({ notifications: [], unreadCount: 0 })

    const [notifs, [{ count }]] = await Promise.all([
      db.query.notifications.findMany({
        where: (f, { eq }) => eq(f.userId, adminUser.id),
        orderBy: (f, { desc }) => desc(f.createdAt),
        limit: 20,
      }),
      db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(eq(notifications.userId, adminUser.id)),
    ])

    const unreadCount = notifs.filter(n => !n.isRead).length

    return NextResponse.json({
      notifications: notifs.map(n => ({ id: n.id, title: n.title, message: n.message, type: n.type, isRead: n.isRead, createdAt: n.createdAt.toISOString() })),
      unreadCount,
    })
  } catch (error) {
    console.error('Notifications API error:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}