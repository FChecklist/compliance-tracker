import { db } from '@/lib/db'
import { auditLogs } from '@/lib/db/schema'
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, gte, lt, sql } from 'drizzle-orm'

const VALID_ACTIONS = ['create','update','delete','status_change','assign','reassign','login','logout','export','invite'] as const
type AuditAction = typeof VALID_ACTIONS[number]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const userId = searchParams.get('userId') || ''
    const action = searchParams.get('action') || ''
    const entityType = searchParams.get('entityType') || ''
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20))
    const offset = (page - 1) * limit

    const conditions = []
    if (userId) conditions.push(eq(auditLogs.userId, userId))
    if (action && VALID_ACTIONS.includes(action as AuditAction)) conditions.push(eq(auditLogs.action, action as AuditAction))
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType))
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)))
    if (endDate) { const end = new Date(endDate); end.setDate(end.getDate() + 1); conditions.push(lt(auditLogs.createdAt, end)) }
    const where = conditions.length ? and(...conditions) : undefined

    const [logs, [{ count }]] = await Promise.all([
      db.query.auditLogs.findMany({
        where: where ? () => where : undefined,
        with: { user: { columns: { name: true } } },
        orderBy: (f, { desc }) => desc(f.createdAt),
        limit,
        offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ])

    return NextResponse.json({
      auditLogs: logs.map(l => ({ id: l.id, action: l.action, entityType: l.entityType, entityId: l.entityId, details: l.details, userName: l.user.name, createdAt: l.createdAt.toISOString() })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    })
  } catch (error) {
    console.error('Audit API error:', error)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}