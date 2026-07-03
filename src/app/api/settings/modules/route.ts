import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listModules, listEnabledModulesForBranch } from "@/lib/services/module-registry-service"

// Wave 20: read-only Module Registry catalog. ?branch=grc filters to the
// modules enabled for that product branch (today: every module, for the
// only branch that exists); omitting it returns the full catalog.
export async function GET(request: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response

  try {
    const branch = request.nextUrl.searchParams.get("branch")
    if (branch) {
      const result = await listEnabledModulesForBranch(branch)
      if (!result) return NextResponse.json({ error: "Product branch not found" }, { status: 404 })
      return NextResponse.json({
        branch: { key: result.branch.branchKey, displayName: result.branch.displayName, domain: result.branch.domain },
        modules: result.modules.map((m) => ({
          moduleKey: m.moduleKey, displayName: m.displayName, domain: m.domain,
          category: m.category, description: m.description, isCore: m.isCore,
        })),
      })
    }

    const domain = request.nextUrl.searchParams.get("domain") ?? undefined
    const category = request.nextUrl.searchParams.get("category") ?? undefined
    const modules = await listModules({ domain, category })
    return NextResponse.json({
      modules: modules.map((m) => ({
        moduleKey: m.moduleKey, displayName: m.displayName, domain: m.domain,
        category: m.category, description: m.description, isCore: m.isCore, isActive: m.isActive,
      })),
    })
  } catch (error) {
    console.error("Module registry list error:", error)
    return NextResponse.json({ error: "Failed to fetch modules" }, { status: 500 })
  }
}
