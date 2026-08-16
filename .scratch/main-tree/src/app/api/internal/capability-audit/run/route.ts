import { NextRequest, NextResponse } from "next/server"
import { findCapabilitiesDueForAudit, runCapabilityAudit } from "@/lib/services/capability-audit-service"

/**
 * Priority 12 (OPEN-07 point 4, Owner directive 2026-07-14): before this
 * route existed, runCapabilityAudit() had ZERO real callers anywhere in the
 * deployed app -- no cron, no API route -- so nothing ever triggered a
 * capability audit today regardless of dispatch-repo.ts's separate
 * GITHUB_DISPATCH_PAT gap (see advisory-dispatch-service.ts's own header for
 * that fix). This closes the "nothing calls it at all" gap specifically.
 *
 * Same shared-CRON_SECRET pattern as every other /api/internal/*\/run route
 * (loops/run, dispatch-completion-monitor/run) -- there is no user session
 * for a scheduled job, and task_capabilities is platform-wide (orgId
 * nullable), so there's no per-org actor to attribute this to either way.
 *
 * BATCH_LIMIT caps one run's Auditor LLM spend -- findCapabilitiesDueForAudit()
 * orders oldest-audited-first (nulls first), so every capability eventually
 * gets a turn across repeated daily runs instead of the same rows winning
 * every time. Errors on one capability are caught and reported per-item,
 * never abort the whole sweep (matches dispatch-completion-monitor/run's
 * own per-org isolation posture).
 */
const BATCH_LIMIT = 25

async function runCapabilityAuditSweep() {
  const due = await findCapabilitiesDueForAudit(BATCH_LIMIT)

  let audited = 0
  let needsImprovementYes = 0
  let dispatched = 0
  const errors: { capabilityId: string; capabilityKey: string; error: string }[] = []

  for (const capability of due) {
    try {
      const result = await runCapabilityAudit(capability.id)
      if (result.audited) {
        audited++
        if (result.needsImprovement === "yes") {
          needsImprovementYes++
          if (result.dispatch.dispatched) dispatched++
        }
      }
    } catch (err) {
      errors.push({ capabilityId: capability.id, capabilityKey: capability.capabilityKey, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { checked: due.length, audited, needsImprovementYes, dispatched, errors }
}

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
    const results = await runCapabilityAuditSweep()
    return NextResponse.json({ ranAt: new Date().toISOString(), results })
  } catch (error) {
    console.error("Capability audit sweep failed:", error)
    return NextResponse.json({ error: "Capability audit sweep failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
