import { db } from '@/lib/db'
import { complianceItems } from '@/lib/db/schema'
import { NextResponse } from 'next/server'
import { sql, eq } from 'drizzle-orm'

export async function GET() {
  try {
    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(complianceItems)
    const byStatus = await db
      .select({ status: complianceItems.status, count: sql<number>`count(*)::int` })
      .from(complianceItems)
      .groupBy(complianceItems.status)

    const byPriority = await db
      .select({ priority: complianceItems.priority, count: sql<number>`count(*)::int` })
      .from(complianceItems)
      .groupBy(complianceItems.priority)

    const overdueItems = await db.query.complianceItems.findMany({
      where: (f, { eq }) => eq(f.status, 'overdue'),
      with: { department: { columns: { name: true } } },
      orderBy: (f, { asc }) => asc(f.dueDate),
      limit: 5,
    })

    const statusMap: Record<string, number> = {}
    byStatus.forEach(r => { statusMap[r.status] = r.count })
    const priorityMap: Record<string, number> = {}
    byPriority.forEach(r => { priorityMap[r.priority] = r.count })

    return NextResponse.json({
      total: totalRow.count,
      byStatus: statusMap,
      byPriority: priorityMap,
      overdueItems: overdueItems.map(i => ({
        id: i.id,
        title: i.title,
        dueDate: i.dueDate?.toISOString(),
        department: { name: i.department.name },
        priority: i.priority,
      })),
    })
  } catch (error) {
    console.error('Compliance stats API error:', error)
    return NextResponse.json({ error: 'Failed to fetch compliance stats' }, { status: 500 })
  }
}