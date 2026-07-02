import { leavePolicyEntries, holidayListFilings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// Compliance tracking, not payroll execution -- confirms leave rules and
// holiday-list filings meet statutory minimums; does not run payroll or
// approve individual leave requests.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ leaveTypes: [], holidayLists: [] })
  const [leaveTypes, holidayLists] = await withTenantContext({ orgId }, (db) =>
    Promise.all([db.query.leavePolicyEntries.findMany(), db.query.holidayListFilings.findMany()])
  )
  return NextResponse.json({
    leaveTypes: leaveTypes.map((l) => ({ id: l.id, leaveType: l.leaveType, governingLaw: l.governingLaw, entitlement: l.entitlement })),
    holidayLists: holidayLists.map((h) => ({ id: h.id, state: h.state, year: h.year, status: h.status })),
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  const kind = body.kind === "holiday_list" ? "holiday_list" : "leave_type"

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    if (kind === "holiday_list") {
      if (!body.state?.trim() || !body.year?.trim()) return null
      const [row] = await db.insert(holidayListFilings).values({ state: body.state.trim(), year: body.year.trim(), orgId }).returning()
      await logActivity({ tx: db, action: "create", entityType: "HolidayListFiling", entityId: row.id, details: `Holiday list added: ${row.state} ${row.year}`, orgId, dbUser, request })
      return row
    }
    if (!body.leaveType?.trim()) return null
    const [row] = await db.insert(leavePolicyEntries).values({ leaveType: body.leaveType.trim(), governingLaw: body.governingLaw || null, entitlement: body.entitlement || null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "LeavePolicyEntry", entityId: row.id, details: `Leave type added: ${row.leaveType}`, orgId, dbUser, request })
    return row
  })
  if (!result) return NextResponse.json({ error: "Required fields missing" }, { status: 400 })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
