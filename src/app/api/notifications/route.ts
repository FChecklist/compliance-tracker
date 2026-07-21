import { notifications } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextResponse } from "next/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { prioritizeForDisplay } from "@/lib/services/notification-priority-service";

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ notifications: [], unreadCount: 0, overflowCount: 0 })

  try {
    const [notifs, [{ count }]] = await withTenantContext({ orgId }, (db) =>
      Promise.all([
        // audit198 RULE-043: fetch a wider pool (50, was 20) than what's
        // ultimately shown -- rankNotifications/capForOverload below need
        // enough rows to prioritize/cap meaningfully instead of just
        // truncating chronologically before prioritization ever runs.
        db.query.notifications.findMany({
          where: eq(notifications.userId, dbUser.id),
          orderBy: desc(notifications.createdAt),
          limit: 50,
        }),
        db.select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, dbUser.id), eq(notifications.isRead, false))),
      ])
    )

    // audit198 RULE-043 ("Notifications shall be prioritized intelligently
    // to prevent information overload while ensuring that users always
    // know their next most important action"): priority itself is set
    // server-side at INSERT time by the compute_notification_priority()
    // DB trigger (drizzle/0251_*.sql); this ranks by that persisted
    // column + recency and caps low-priority noise, returning an
    // overflow summary instead of silently dropping anything.
    const { visible, overflowCount } = prioritizeForDisplay(notifs, { medium: 15, low: 5 })

    return NextResponse.json({
      notifications: visible.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        priority: n.priority,
        isRead: n.isRead,
        metadata: n.metadata,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: count,
      overflowCount,
    })
  } catch (error) {
    console.error("Notifications API error:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}
