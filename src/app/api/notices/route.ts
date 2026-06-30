import { db, notices, departments, users, auditLogs, organisations } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, or, like, asc, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

const VALID_STATUSES = ['received', 'in_progress', 'replied', 'closed', 'appealed'] as const

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  try {
    const { searchParams } = request.nextUrl

    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""
    const departmentId = searchParams.get("departmentId") || ""
    const page = Math.max(1, Number(searchParams.get("page")) || 1)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20))
    const offset = (page - 1) * limit

    const conditions = []
    conditions.push(eq(notices.orgId, orgId ?? ''))
    if (search) {
      conditions.push(or(
        like(notices.noticeNumber, `%${search}%`),
        like(notices.authority, `%${search}%`),
        like(notices.description, `%${search}%`),
      ))
    }
    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(notices.status, status as typeof VALID_STATUSES[number]))
    }
    if (departmentId) {
      conditions.push(eq(notices.departmentId, departmentId))
    }

    const where = and(...conditions)

    const [items, [{ count }]] = await Promise.all([
      db.query.notices.findMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: where as any,
        with: {
          department: { columns: { name: true } },
          assignedTo: { columns: { name: true, avatarUrl: true } },
        },
        orderBy: asc(notices.dateReceived),
        limit,
        offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(notices).where(where),
    ])

    return NextResponse.json({
      notices: items.map((item) => ({
        id: item.id,
        noticeNumber: item.noticeNumber,
        authority: item.authority,
        dateReceived: item.dateReceived.toISOString(),
        demandAmount: item.demandAmount ?? null,
        replyDeadline: item.replyDeadline?.toISOString() ?? null,
        status: item.status,
        description: item.description,
        department: { name: item.department.name },
        assignedTo: item.assignedTo
          ? { name: item.assignedTo.name, avatarUrl: item.assignedTo.avatarUrl }
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    })
  } catch (error) {
    console.error("Notices list API error:", error)
    return NextResponse.json({ error: "Failed to fetch notices" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  try {
    const body = await request.json()
    const {
      noticeNumber,
      authority,
      dateReceived,
      demandAmount,
      replyDeadline,
      status,
      description,
      departmentId,
      assignedToId,
      complianceItemId,
    } = body

    if (!dateReceived) {
      return NextResponse.json({ error: "dateReceived is required" }, { status: 400 })
    }
    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "departmentId is required" }, { status: 400 })
    }

    const dept = await db.query.departments.findFirst({ where: eq(departments.id, departmentId) })
    if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 })

    const org = orgId
      ? await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
      : await db.query.organisations.findFirst()
    if (!org) return NextResponse.json({ error: "No organisation found" }, { status: 500 })

    const adminUser = dbUser ?? await db.query.users.findFirst({ where: eq(users.role, 'admin') })
    if (!adminUser) return NextResponse.json({ error: "No admin user found" }, { status: 500 })

    // Auto-calculate reply deadline: 30 days from dateReceived if not provided
    const parsedDateReceived = new Date(dateReceived)
    let parsedReplyDeadline: Date | null = null
    if (replyDeadline) {
      parsedReplyDeadline = new Date(replyDeadline)
    } else {
      parsedReplyDeadline = new Date(parsedDateReceived.getTime() + 30 * 86400000)
    }

    const validStatus = (VALID_STATUSES as readonly string[]).includes(status) ? status : 'received'

    const [notice] = await db.insert(notices).values({
      noticeNumber: noticeNumber?.trim() || null,
      authority: authority?.trim() || null,
      dateReceived: parsedDateReceived,
      demandAmount: demandAmount ?? null,
      replyDeadline: parsedReplyDeadline,
      status: validStatus as typeof VALID_STATUSES[number],
      description: description?.trim() || null,
      departmentId,
      orgId: org.id,
      assignedToId: assignedToId || null,
      complianceItemId: complianceItemId || null,
    }).returning()

    await db.insert(auditLogs).values({
      action: 'create',
      entityType: 'Notice',
      entityId: notice.id,
      userId: adminUser.id,
      details: `Created notice: ${notice.noticeNumber ?? notice.id} from ${notice.authority ?? 'unknown authority'}`,
    })

    return NextResponse.json({ id: notice.id, noticeNumber: notice.noticeNumber, status: notice.status }, { status: 201 })
  } catch (error) {
    console.error("Notices create API error:", error)
    return NextResponse.json({ error: "Failed to create notice" }, { status: 500 })
  }
}
