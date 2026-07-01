import { notifications } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(_request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params

    const updated = await withTenantContext({ orgId }, async (db) => {
      const notif = await db.query.notifications.findFirst({
        where: and(eq(notifications.id, id), eq(notifications.userId, dbUser.id)),
      })
      if (!notif) return false
      await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id))
      return true
    })

    if (!updated) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Notification read API error:", error)
    return NextResponse.json({ error: "Failed to mark notification as read" }, { status: 500 })
  }
}
