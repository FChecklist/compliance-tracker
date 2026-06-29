import { db, auditLogs } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET(request: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response
  try {
    const { searchParams } = request.nextUrl

    const userId = searchParams.get("userId") || ""
    const action = searchParams.get("action") || ""
    const entityType = searchParams.get("entityType") || ""
    const startDate = searchParams.get("startDate") || ""
    const endDate = searchParams.get("endDate") || ""
    const page = Math.max(1, Number(searchParams.get("page")) || 1)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20))
    const offset = (page - 1) * limit

    const conditions = []
    if (userId) conditions.push(eq(auditLogs.userId, userId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (action) conditions.push(eq(auditLogs.action, action as any))
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType))
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)))
    if (endDate) {
      const end = new Date(endDate)
      end.setDate(end.getDate() + 1)
      conditions.push(lt(auditLogs.createdAt, end))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [logs, [{ count }]] = await Promise.all([
      db.query.auditLogs.findMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: where as any,
        with: { user: { columns: { name: true } } },
        orderBy: desc(auditLogs.createdAt),
        limit,
        offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ])

    return NextResponse.json({
      auditLogs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        details: log.details,
        userName: log.user.name,
        createdAt: log.createdAt.toISOString(),
      })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    })
  } catch (error) {
    console.error("Audit API error:", error)
    return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 })
  }
}
