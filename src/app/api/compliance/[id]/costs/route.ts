import { complianceCosts, complianceItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, and, desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const VALID_COST_TYPES = ["government_fee", "consultant_fee", "penalty_paid", "other"] as const

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ costs: [] })

  try {
    const { id } = await context.params
    const costs = await withTenantContext({ orgId }, (db) =>
      db.query.complianceCosts.findMany({
        where: eq(complianceCosts.complianceItemId, id),
        with: { payments: { orderBy: (p, { desc }) => desc(p.createdAt) } },
        orderBy: desc(complianceCosts.createdAt),
      })
    )
    return NextResponse.json({
      costs: costs.map((c) => ({
        id: c.id,
        costType: c.costType,
        description: c.description,
        amount: c.amount,
        amountPaid: c.amountPaid,
        paymentStatus: c.paymentStatus,
        paidTo: c.paidTo,
        dueDate: c.dueDate?.toISOString() ?? null,
        receiptDocumentId: c.receiptDocumentId,
        createdAt: c.createdAt.toISOString(),
        payments: c.payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          paymentDate: p.paymentDate.toISOString(),
          paymentMethod: p.paymentMethod,
          referenceNumber: p.referenceNumber,
          receiptDocumentId: p.receiptDocumentId,
          recordedAt: p.createdAt.toISOString(),
        })),
      })),
    })
  } catch (error) {
    console.error("Compliance costs GET error:", error)
    return NextResponse.json({ error: "Failed to fetch costs" }, { status: 500 })
  }
}

// Creates the cost OBLIGATION (what's owed). Recording an actual payment
// against it is a separate call (POST /api/compliance-costs/[id]/payments)
// -- keeps "what we owe" and "what we've actually paid, and when" as
// distinct, separately-evidenced facts, which is the whole point of not
// collapsing this into a single amount field.
export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { costType, description, amount, paidTo, dueDate, receiptDocumentId } = body

    if (!costType || !(VALID_COST_TYPES as readonly string[]).includes(costType)) {
      return NextResponse.json({ error: "Valid costType is required" }, { status: 400 })
    }
    const parsedAmount = Number(amount)
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "A positive amount is required" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const item = await db.query.complianceItems.findFirst({ where: and(eq(complianceItems.id, id), eq(complianceItems.orgId, orgId)) })
      if (!item) return null

      const [cost] = await db.insert(complianceCosts).values({
        complianceItemId: id,
        costType,
        description: description?.trim() || null,
        amount: String(parsedAmount),
        paidTo: paidTo?.trim() || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        receiptDocumentId: receiptDocumentId || null,
        orgId,
        clientId: item.clientId,
        recordedById: dbUser.id,
      }).returning()

      await logActivity({
        tx: db,
        action: "create",
        entityType: "ComplianceCost",
        entityId: cost.id,
        details: `Cost recorded on "${item.title}": ${costType} — ₹${parsedAmount}${paidTo ? ` to ${paidTo}` : ""}`,
        orgId,
        clientId: item.clientId,
        dbUser,
        request,
      })

      return cost
    })

    if (!result) return NextResponse.json({ error: "Compliance item not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, costType: result.costType, amount: result.amount, paymentStatus: result.paymentStatus }, { status: 201 })
  } catch (error) {
    console.error("Compliance cost POST error:", error)
    return NextResponse.json({ error: "Failed to record cost" }, { status: 500 })
  }
}
