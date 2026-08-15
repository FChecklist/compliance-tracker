import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { measureCapabilityCoverage } from "@/lib/services/capability-backfill-service"

// Gap closure (VERIDIAN Review Framework, AI Capability Registry: "registry
// coverage/backfill completeness not independently measured"). Read-only --
// reports what fraction of worker agents/automation rules/modules/dynamic
// chains actually has a row in compliance.embeddings right now, without
// running (or requiring) a backfill first.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const coverage = await measureCapabilityCoverage({ orgId, userId: dbUser.id })
    return NextResponse.json(coverage)
  } catch (error) {
    console.error("Capability registry coverage error:", error)
    return NextResponse.json({ error: "Coverage check failed" }, { status: 500 })
  }
}
