import { relatedPartyTransactions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"

// RPTs are classified board_only by default (see schema.ts) -- gated at
// the whole-list level, not per-row, since RPT visibility itself (not just
// detail) is board-sensitive information.
export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ rpts: [], restricted: false })
  if (!canAccess(dbUser.role, "board_only")) return NextResponse.json({ rpts: [], restricted: true })

  const rows = await withTenantContext({ orgId }, (db) => db.query.relatedPartyTransactions.findMany({ orderBy: desc(relatedPartyTransactions.transactionDate) }))
  return NextResponse.json({
    rpts: rows.map((r) => ({ id: r.id, partyName: r.partyName, natureOfTransaction: r.natureOfTransaction, amount: r.amount, approvalStatus: r.approvalStatus, transactionDate: r.transactionDate?.toISOString() ?? null })),
    restricted: false,
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!canAccess(dbUser.role, "board_only")) return NextResponse.json({ error: "Insufficient clearance for RPT records" }, { status: 403 })

  const body = await request.json()
  if (!body.partyName?.trim()) return NextResponse.json({ error: "partyName is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [rpt] = await db.insert(relatedPartyTransactions).values({
      partyName: body.partyName.trim(), natureOfTransaction: body.natureOfTransaction || null,
      amount: body.amount != null ? String(body.amount) : null,
      transactionDate: body.transactionDate ? new Date(body.transactionDate) : null,
      orgId, createdById: dbUser.id,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "RelatedPartyTransaction", entityId: rpt.id, details: `RPT recorded: ${rpt.partyName}`, orgId, dbUser, request })
    return rpt
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
