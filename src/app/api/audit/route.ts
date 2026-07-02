import { auditLogs } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte, lt, desc, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ auditLogs: [], total: 0, page: 1, limit: 20, totalPages: 0 })

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

    const [logs, count] = await withTenantContext({ orgId }, async (db) => {
      // org_id is a direct column now (Wave 7) -- no need to derive scope
      // via a join through users, and RLS enforces it independently anyway.
      const conditions: SQL[] = [eq(auditLogs.orgId, orgId)]
      if (userId) conditions.push(eq(auditLogs.userId, userId))
      if (action) conditions.push(eq(auditLogs.action, action))
      if (entityType) conditions.push(eq(auditLogs.entityType, entityType))
      if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)))
      if (endDate) {
        const end = new Date(endDate)
        end.setDate(end.getDate() + 1)
        conditions.push(lt(auditLogs.createdAt, end))
      }

      const where = and(...conditions)

      const [fetchedLogs, [{ count: fetchedCount }]] = await Promise.all([
        db.query.auditLogs.findMany({
          where,
          orderBy: desc(auditLogs.createdAt),
          limit,
          offset,
        }),
        db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
      ])

      return [fetchedLogs, fetchedCount] as const
    })

    return NextResponse.json({
      auditLogs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        details: log.details,
        // actorName/actorRole are denormalized snapshots on the row itself
        // now -- no join needed, and they reflect who the actor WAS at the
        // time, not whatever the users table says today.
        userName: log.actorName,
        actorRole: log.actorRole,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
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
