import { db } from '@/lib/db'
import { complianceItems, departments, users } from '@/lib/db/schema'
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, or, like, sql, asc } from 'drizzle-orm'

const VALID_STATUSES = ['pending','in_progress','completed','overdue','not_applicable','draft'] as const
const VALID_PRIORITIES = ['low','medium','high','critical'] as const
const VALID_TYPES = ['GST','TDS','MCA','PF','ESIC','INCOME_TAX','ROC','LABOUR','ENVIRONMENTAL','OTHER'] as const
type ComplianceStatus = typeof VALID_STATUSES[number]
type Priority = typeof VALID_PRIORITIES[number]
type ComplianceType = typeof VALID_TYPES[number]
const SORTABLE_FIELDS = ['dueDate','createdAt','title'] as const
type SortField = typeof SORTABLE_FIELDS[number]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const departmentId = searchParams.get('departmentId') || ''
    const complianceType = searchParams.get('complianceType') || ''
    const sortBy = (searchParams.get('sort') || 'dueDate') as SortField
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20))
    const offset = (page - 1) * limit
    const safeSortBy = SORTABLE_FIELDS.includes(sortBy) ? sortBy : 'dueDate'

    const conditions = []
    if (search) conditions.push(or(like(complianceItems.title, `%${search}%`), like(complianceItems.description, `%${search}%`)))
    if (status && VALID_STATUSES.includes(status as ComplianceStatus)) conditions.push(eq(complianceItems.status, status as ComplianceStatus))
    if (departmentId) conditions.push(eq(complianceItems.departmentId, departmentId))
    if (complianceType && VALID_TYPES.includes(complianceType as ComplianceType)) conditions.push(eq(complianceItems.complianceType, complianceType as ComplianceType))
    const where = conditions.length ? and(...conditions) : undefined

    const [items, [{ count }]] = await Promise.all([
      db.query.complianceItems.findMany({
        where: where ? () => where : undefined,
        with: {
          department: { columns: { name: true } },
          assignedTo: { columns: { name: true, avatarUrl: true } },
        },
        orderBy: (f, { asc }) => asc(f[safeSortBy as keyof typeof f] as Parameters<typeof asc>[0]),
        limit,
        offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(where),
    ])

    return NextResponse.json({
      compliance: items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        complianceType: item.complianceType,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate?.toISOString(),
        department: { name: item.department.name },
        assignedTo: item.assignedTo ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl } : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    })
  } catch (error) {
    console.error('Compliance list API error:', error)
    return NextResponse.json({ error: 'Failed to fetch compliance items' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, description, complianceType, priority, dueDate, departmentId, assignedToId } = body

    if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    if (!complianceType) return NextResponse.json({ error: 'complianceType is required' }, { status: 400 })
    if (!departmentId) return NextResponse.json({ error: 'departmentId is required' }, { status: 400 })

    const [dept] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).limit(1)
    if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

    const [org] = await db.query.organisations.findMany({ limit: 1 })
    if (!org) return NextResponse.json({ error: 'No organisation found' }, { status: 500 })

    const [adminUser] = await db.query.users.findMany({ where: (f, { eq }) => eq(f.role, 'admin'), limit: 1 })
    if (!adminUser) return NextResponse.json({ error: 'No admin user found' }, { status: 500 })

    const [item] = await db.transaction(async tx => {
      const [created] = await tx.insert(complianceItems).values({
        title: title.trim(),
        description: description?.trim() || null,
        complianceType: complianceType.trim() as ComplianceType,
        priority: VALID_PRIORITIES.includes(priority) ? priority : 'medium',
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        departmentId,
        orgId: org.id,
        assignedToId: assignedToId || null,
      }).returning()
      await tx.insert(auditLogs).values({
        action: 'create',
        entityType: 'ComplianceItem',
        entityId: created.id,
        userId: adminUser.id,
        details: `Created compliance item: ${created.title}`,
      })
      return [created]
    })

    return NextResponse.json({ id: item.id, title: item.title, status: item.status }, { status: 201 })
  } catch (error) {
    console.error('Compliance create API error:', error)
    return NextResponse.json({ error: 'Failed to create compliance item' }, { status: 500 })
  }
}

import { auditLogs } from '@/lib/db/schema'