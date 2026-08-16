import { complianceCosts, costPayments } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, and, sum } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

type RouteContext = { params: Promise<{ id: string }> } // id = complianceCostId

// Records one real payment event against a cost obligation. Payment rows
// are never edited or deleted (same append-only principle as audit_logs) --
// a correction is a new row, not a mutation, so there's always a full,
// dated, attributed history to point to if a "did we pay this?" dispute
// ever comes up. amountPaid/paymentStatus on the parent cost are always
// RECOMPUTED from this ledger after every insert, never hand-set, so they
// can't silently drift from what was actually recorded.
export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { amount, paymentDate, paymentMethod, referenceNumber, receiptDocumentId } = body

    const parsedAmount = Number(amount)
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "A positive amount is required" }, { status: 400 })
    }
    const parsedDate = paymentDate ? new Date(paymentDate) : new Date()
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "Invalid paymentDate" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const cost = await db.query.complianceCosts.findFirst({ where: and(eq(complianceCosts.id, id), eq(complianceCosts.orgId, orgId)) })
      if (!cost) return null

      const [payment] = await db.insert(costPayments).values({
        complianceCostId: id,
        amount: String(parsedAmount),
        paymentDate: parsedDate,
        paymentMethod: paymentMethod?.trim() || null,
        referenceNumber: referenceNumber?.trim() || null,
        receiptDocumentId: receiptDocumentId || null,
        orgId,
        clientId: cost.clientId,
        recordedById: dbUser.id,
      }).returning()

      const [{ total }] = await db.select({ total: sum(costPayments.amount) }).from(costPayments).where(eq(costPayments.complianceCostId, id))
      const totalPaid = Number(total ?? 0)
      const totalOwed = Number(cost.amount)
      const newStatus = totalPaid >= totalOwed ? "paid" : totalPaid > 0 ? "partially_paid" : cost.paymentStatus

      const [updatedCost] = await db.update(complianceCosts)
        .set({ amountPaid: String(totalPaid), paymentStatus: newStatus, updatedAt: new Date() })
        .where(eq(complianceCosts.id, id))
        .returning()

      await logActivity({
        tx: db,
        action: "payment_recorded",
        entityType: "ComplianceCost",
        entityId: id,
        details: `Payment of ₹${parsedAmount} recorded on ${parsedDate.toLocaleDateString("en-IN")}${paymentMethod ? ` via ${paymentMethod}` : ""}${referenceNumber ? ` (ref: ${referenceNumber})` : ""} — status now ${newStatus} (₹${totalPaid}/₹${totalOwed})`,
        orgId,
        clientId: cost.clientId,
        dbUser,
        request,
      })

      return { payment, cost: updatedCost }
    })

    if (!result) return NextResponse.json({ error: "Cost record not found" }, { status: 404 })
    return NextResponse.json({
      paymentId: result.payment.id,
      amountPaid: result.cost.amountPaid,
      paymentStatus: result.cost.paymentStatus,
    }, { status: 201 })
  } catch (error) {
    console.error("Cost payment POST error:", error)
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 })
  }
}
