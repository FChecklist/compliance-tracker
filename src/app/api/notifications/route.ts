import { db, users, notifications } from "@/lib/db";
import { NextResponse } from "next/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const adminUser = await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (!adminUser) {
      return NextResponse.json({ notifications: [], unreadCount: 0 })
    }

    const [notifs, [{ count }]] = await Promise.all([
      db.query.notifications.findMany({
        where: eq(notifications.userId, adminUser.id),
        orderBy: desc(notifications.createdAt),
        limit: 20,
      }),
      db.select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, adminUser.id), eq(notifications.isRead, false))),
    ])

    return NextResponse.json({
      notifications: notifs.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: count,
    })
  } catch (error) {
    console.error("Notifications API error:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}
