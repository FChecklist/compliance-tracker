import { complianceItems, departments, auditLogs } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, or, like, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'] as const
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
const VALID_TYPES = ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'] as const
const SORTABLE_FIELDS = ['dueDate', 'createdAt', 'title'] as const
type SortField = (typeof SORTABLE_FIELDS)[number]

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ compliance: [], total: 0, page: 1, limit: 20, totalPages: 0 })

  try {
    const { searchParams } = request.nextUrl

    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""
    const departmentId = searchParams.get("departmentId") || ""
    const complianceType = searchParams.get("complianceType") || ""
    const sortBy = (searchParams.get("sort") || "dueDate") as SortField
    const page = Math.max(1, Number(searchParams.get("page")) || 1)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20))
    const offset = (page - 1) * limit

    // org_id condition kept here too (belt-and-suspenders with RLS, and
    // needed since RLS alone can't be seen by the query planner for the
    // separate count() call's WHERE clause the same way).
    const conditions = []
    conditions.push(eq(complianceItems.orgId, orgId))
    if (search) {
      conditions.push(or(
        like(complianceItems.title, `%${search}%`),
        like(complianceItems.description, `%${search}%`),
      ))
    }
    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(complianceItems.status, status as typeof VALID_STATUSES[number]))
    }
    if (departmentId) {
      conditions.push(eq(complianceItems.departmentId, departmentId))
    }
    if (complianceType && (VALID_TYPES as readonly string[]).includes(complianceType)) {
      conditions.push(eq(complianceItems.complianceType, complianceType as typeof VALID_TYPES[number]))
    }

    const where = and(...conditions)
    const safeSortBy = SORTABLE_FIELDS.includes(sortBy) ? sortBy : 'dueDate'
    const orderCol = safeSortBy === 'dueDate' ? complianceItems.dueDate
      : safeSortBy === 'title' ? complianceItems.title
      : complianceItems.createdAt

    const [items, [{ count }]] = await withTenantContext({ orgId }, (db) =>
      Promise.all([
        db.query.complianceItems.findMany({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: where as any,
          with: {
            department: { columns: { name: true } },
            assignedTo: { columns: { name: true, avatarUrl: true } },
          },
          orderBy: asc(orderCol),
          limit,
          offset,
        }),
        db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(where),
      ])
    )

    return NextResponse.json({
      compliance: items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        complianceType: item.complianceType,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate?.toISOString(),
        period: item.period ?? null,
        acknowledgementNumber: item.acknowledgementNumber ?? null,
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
    console.error("Compliance list API error:", error)
    return NextResponse.json({ error: "Failed to fetch compliance items" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'member')
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const {
      title, description, complianceType, priority, dueDate, departmentId, assignedToId,
      period, financialYear, acknowledgementNumber, registrationNumber,
      amount, filedDate, paidDate, recurrenceType,
    } = body

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }
    if (!complianceType || typeof complianceType !== "string") {
      return NextResponse.json({ error: "complianceType is required" }, { status: 400 })
    }
    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "departmentId is required" }, { status: 400 })
    }

    const VALID_RECURRENCE = ['none', 'monthly', 'quarterly', 'half_yearly', 'annually'] as const

    const result = await withTenantContext({ orgId }, async (db) => {
      // RLS means this returns null if departmentId belongs to a different
      // org, not just if it doesn't exist at all -- fixes a pre-existing
      // gap where a department id from any org could be referenced here.
      const dept = await db.query.departments.findFirst({ where: eq(departments.id, departmentId) })
      if (!dept) return { error: "Department not found", status: 404 as const }

      const [item] = await db.insert(complianceItems).values({
        title: title.trim(),
        description: description?.trim() || null,
        complianceType: complianceType.trim() as typeof VALID_TYPES[number],
        priority: (VALID_PRIORITIES as readonly string[]).includes(priority) ? priority : 'medium',
        dueDate: dueDate ? new Date(dueDate) : null,
        departmentId,
        orgId,
        assignedToId: assignedToId || null,
        period: typeof period === 'string' && period.trim() ? period.trim() : null,
        financialYear: typeof financialYear === 'string' && financialYear.trim() ? financialYear.trim() : null,
        acknowledgementNumber: typeof acknowledgementNumber === 'string' && acknowledgementNumber.trim() ? acknowledgementNumber.trim() : null,
        registrationNumber: typeof registrationNumber === 'string' && registrationNumber.trim() ? registrationNumber.trim() : null,
        amount: amount != null && amount !== '' ? String(amount) : null,
        filedDate: filedDate ? new Date(filedDate) : null,
        paidDate: paidDate ? new Date(paidDate) : null,
        recurrenceType: (VALID_RECURRENCE as readonly string[]).includes(recurrenceType) ? recurrenceType : 'none',
      }).returning()

      await db.insert(auditLogs).values({
        action: 'create',
        entityType: 'ComplianceItem',
        entityId: item.id,
        userId: dbUser.id,
        details: `Created compliance item: ${item.title}`,
      })

      return { item }
    })

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ id: result.item.id, title: result.item.title, status: result.item.status }, { status: 201 })
  } catch (error) {
    console.error("Compliance create API error:", error)
    return NextResponse.json({ error: "Failed to create compliance item" }, { status: 500 })
  }
}
