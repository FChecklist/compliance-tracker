import { NextRequest, NextResponse } from "next/server"
import { checkOrphanedLeadReferencesForAllOrgs } from "@/lib/services/crm-service"

/**
 * Cron-triggered entry point (VERIDIAN Review Framework gap-closure,
 * "Data Model Completeness & Referential Integrity"): crm_leads.companyId/
 * convertedClientId are bare text with no DB-level FK (matches this
 * codebase's established convention for every companyId-shaped column --
 * see schema.ts). This is the periodic orphan-check the finding's own
 * recommended approach calls for, run weekly (orphaned references are a
 * slow-moving data-hygiene signal, not something that needs daily
 * attention) across every org with Sales enabled. Findings are logged
 * (console.warn, picked up by the platform's existing log pipeline) --
 * this never mutates data, only reports.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await checkOrphanedLeadReferencesForAllOrgs()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("CRM data-integrity run failed:", error)
    return NextResponse.json({ error: "CRM data-integrity run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
