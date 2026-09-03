import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listModules } from "@/lib/services/module-registry-service"

// R67 Part B item 1.8 (Impact Analysis screen). Thin listing endpoint so
// the Impact Analysis panel can offer a module picker instead of asking
// for a raw table name -- reuses module-registry-service.ts's own
// listModules() (Wave 20), no new query. Admin-gated to match this
// directory's other routes.
export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr

  try {
    const modules = await listModules({ isActive: true })
    return NextResponse.json({
      modules: modules.map((m) => ({ moduleKey: m.moduleKey, displayName: m.displayName, domain: m.domain, category: m.category })),
    })
  } catch (error) {
    console.error("Module list error:", error)
    return NextResponse.json({ error: "Failed to list modules" }, { status: 500 })
  }
}
