import { poshCommittee, poshComplaints, poshAnnualReports } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"

// Confidential-gated at the whole-module level, same as Whistleblower.
export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ restricted: false, committee: [], complaints: [], annualReports: [] })
  if (!canAccess(dbUser.role, "confidential")) return NextResponse.json({ restricted: true, committee: [], complaints: [], annualReports: [] })

  const [committee, complaints, annualReports] = await withTenantContext({ orgId }, (db) =>
    Promise.all([db.query.poshCommittee.findMany(), db.query.poshComplaints.findMany({ orderBy: desc(poshComplaints.receivedDate) }), db.query.poshAnnualReports.findMany()])
  )
  return NextResponse.json({
    restricted: false,
    committee: committee.map((c) => ({ id: c.id, memberName: c.memberName, role: c.role })),
    complaints: complaints.map((c) => ({ id: c.id, caseRef: c.caseRef, receivedDate: c.receivedDate.toISOString(), status: c.status })),
    annualReports: annualReports.map((a) => ({ id: a.id, year: a.year, filedWith: a.filedWith, status: a.status })),
  })
}

// Case DETAIL is never a field in this table (see schema.ts) -- the audit
// log entry deliberately omits it too. Only a case reference is ever
// recorded here, matching the mockup's rule.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!canAccess(dbUser.role, "confidential")) return NextResponse.json({ error: "Insufficient clearance" }, { status: 403 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const count = await db.query.poshComplaints.findMany()
    const caseRef = `POSH-${String(count.length + 1).padStart(2, "0")}`
    const [complaint] = await db.insert(poshComplaints).values({ caseRef, receivedDate: new Date(), orgId, recordedById: dbUser.id }).returning()
    await logActivity({ tx: db, action: "create", entityType: "PoshComplaint", entityId: complaint.id, details: "New POSH case logged (Confidential — case detail withheld from activity log)", orgId, dbUser, request })
    return complaint
  })
  return NextResponse.json({ id: result.id, caseRef: result.caseRef }, { status: 201 })
}
