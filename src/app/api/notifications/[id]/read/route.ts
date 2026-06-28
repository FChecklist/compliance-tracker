import { db, notifications } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    const notif = await db.query.notifications.findFirst({ where: eq(notifications.id, id) })
    if (!notif) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }

    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Notification read API error:", error)
    return NextResponse.json({ error: "Failed to mark notification as read" }, { status: 500 })
  }
}
