import { notifications } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextResponse } from "next/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ notifications: [], unreadCount: 0 })

  try {
    const [notifs, [{ count }]] = await withTenantContext({ orgId }, (db) =>
      Promise.all([
        db.query.notifications.findMany({
          where: eq(notifications.userId, dbUser.id),
          orderBy: desc(notifications.createdAt),
          limit: 20,
        }),
        db.select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, dbUser.id), eq(notifications.isRead, false))),
      ])
    )

    return NextResponse.json({
      notifications: notifs.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        metadata: n.metadata,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: count,
    })
  } catch (error) {
    console.error("Notifications API error:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}
