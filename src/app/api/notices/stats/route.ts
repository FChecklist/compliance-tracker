import { notices } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextResponse } from "next/server";
import { eq, and, inArray, lte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) {
    return NextResponse.json({ total: 0, pendingReplies: 0, overdue: 0, replied: 0, closed: 0, appealed: 0, received: 0, inProgress: 0 })
  }

  try {
    const now = new Date()
    const orgFilter = eq(notices.orgId, orgId)

    const [total, received, inProgress, replied, closed, appealed, overdue] = await withTenantContext({ orgId }, (db) =>
      Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(orgFilter).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, 'received'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, 'in_progress'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, 'replied'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, 'closed'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices).where(and(orgFilter, eq(notices.status, 'appealed'))).then(r => r[0].count),
        db.select({ count: sql<number>`count(*)::int` }).from(notices)
          .where(and(
            orgFilter,
            lte(notices.replyDeadline, now),
            inArray(notices.status, ['received', 'in_progress']),
          ))
          .then(r => r[0].count),
      ])
    )

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
