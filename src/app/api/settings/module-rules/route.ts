import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setModuleRule, listModuleRules, ServiceError } from "@/lib/services/module-rule-service"

export async function GET(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rules: [] })

  try {
    const moduleKey = request.nextUrl.searchParams.get("moduleKey") ?? undefined
    const scopeType = request.nextUrl.searchParams.get("scopeType") ?? undefined
    const rows = await listModuleRules({ orgId, userId: dbUser?.id }, { moduleKey, scopeType })
    return NextResponse.json({
      rules: rows.map((r) => ({
        id: r.id, moduleKey: r.moduleKey, ruleKey: r.ruleKey, ruleValue: r.ruleValue,
        scopeType: r.scopeType, scopeId: r.scopeId, isActive: r.isActive, updatedAt: r.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Module rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch module rules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await setModuleRule({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Module rule set error:", error)
    return NextResponse.json({ error: "Failed to set module rule" }, { status: 500 })
  }
}
