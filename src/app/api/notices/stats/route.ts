import { db, notices } from "@/lib/db";
import { NextResponse } from "next/server";
import { eq, and, inArray, lte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const now = new Date()

    const [total, received, inProgress, replied, closed, appealed, overdue] =
      await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(notices).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.status, 'received')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.status, 'in_progress')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.status, 'replied')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.status, 'closed')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.status, 'appealed')).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices)
          .where(and(
            lte(notices.replyDeadline, now),
            inArray(notices.status, ['received', 'in_progress']),
          ))
          .then(r => r[0].count),
      ])

    return NextResponse.json({
      total,
      pendingReplies: received + inProgress,
      overdue,
      replied,
      closed,
      appealed,
      received,
      inProgress,
    })
  } catch (error) {
    console.error("Notice stats API error:", error)
    return NextResponse.json({ error: "Failed to fetch notice stats" }, { status: 500 })
  }
}