import { mcaFilings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

// Honest by design (see schema.ts comment): tracks preparation/status/SRN
// only. No code path here files anything with the MCA -- that requires the
// Company Secretary's own Digital Signature Certificate on the government
// portal itself.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ filings: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.mcaFilings.findMany({ orderBy: desc(mcaFilings.createdAt) }))
  return NextResponse.json({ filings: rows.map((f) => ({ id: f.id, formType: f.formType, description: f.description, dueDate: f.dueDate?.toISOString() ?? null, status: f.status, srn: f.srn, formData: f.formData, generatedAt: f.generatedAt?.toISOString() ?? null })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.formType?.trim()) return NextResponse.json({ error: "formType is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [filing] = await db.insert(mcaFilings).values({ formType: body.formType.trim(), description: body.description || null, dueDate: body.dueDate ? new Date(body.dueDate) : null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "McaFiling", entityId: filing.id, details: `MCA filing tracked: ${filing.formType}`, orgId, dbUser, request })
    return filing
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
