import { frameworkControls } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.frameworkId || !body.controlRef?.trim() || !body.title?.trim()) return NextResponse.json({ error: "frameworkId, controlRef, and title are required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [control] = await db.insert(frameworkControls).values({ frameworkId: body.frameworkId, controlRef: body.controlRef.trim(), title: body.title.trim(), status: body.status || "not_started", orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "FrameworkControl", entityId: control.id, details: `Control added: ${control.controlRef} — ${control.title}`, orgId, dbUser, request })
    return control
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
