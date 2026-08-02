// GAP-CONNECTOR-LAYERS (Priority 14 Wave 2): Office Add-in connector.
// Minimal id/name lookup so the task pane's "Create compliance item" form
// can populate a real department dropdown -- createComplianceItem()
// (compliance-service.ts) requires a valid departmentId, and there was no
// existing /api/v1 departments route (the internal /api/departments route
// is session-only, requireAuth(), no API-key path). Deliberately narrow:
// id/name only, no member counts or head info the internal route returns --
// this is a picker, not a departments management surface.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { departments } from "@/lib/db"
import { asc } from "drizzle-orm"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ departments: [] })

  try {
    const rows = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.departments.findMany({
        columns: { id: true, name: true },
        orderBy: asc(departments.name),
      })
    )
    return NextResponse.json({ departments: rows })
  } catch (error) {
    console.error("v1 connectors/office-addin departments error:", error)
    return NextResponse.json({ error: "Failed to fetch departments" }, { status: 500 })
  }
}
