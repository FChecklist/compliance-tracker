import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { resolvePageAgentModelConfig } from "@/lib/personal-model-resolver"

// Wave 25: tells the frontend whether to mount PageAgent at all. Never
// returns actual keys or provider/model detail -- the real resolution
// happens server-side in /api/page-agent/proxy on every request.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ enabled: false, hasModelConfigured: false })

  try {
    const org = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { pageAgentEnabled: true } })
    )
    const modelConfig = await resolvePageAgentModelConfig(orgId, dbUser.id)

    return NextResponse.json({
      enabled: !!org?.pageAgentEnabled,
      hasModelConfigured: !!modelConfig,
    })
  } catch (error) {
    console.error("Page Agent config check error:", error)
    return NextResponse.json({ enabled: false, hasModelConfigured: false }, { status: 500 })
  }
}
