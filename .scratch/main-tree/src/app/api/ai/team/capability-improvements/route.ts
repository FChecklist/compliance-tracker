import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listImprovementProposals, type ProposalStatus } from "@/lib/services/capability-audit-service"
import { findCapabilityById } from "@/lib/services/capability-learning-service"

const VALID_STATUSES: ProposalStatus[] = ["open", "dispatched", "resolved", "rejected"]

// Priority 12 (OPEN-07 point 5): capability_improvement_proposals has had no
// customer-facing UI/API at all until this wave -- closeImprovementLoop()
// (capability-audit-service.ts) was manual/human-only, callable only by
// whoever could reach a DB console. veridian_admin-gated, same posture as
// /api/ai/team/work-item/[id] and /api/ai/team/dispatch -- this is
// platform-internal governance (what the Auditor -> Higher AI loop found and
// did about it), not a customer workflow.
//
// Enriches each proposal with a minimal capability summary (capabilityKey/
// modePill/pathKeys) rather than the bare capabilityId a raw proposal row
// carries -- capabilityImprovementProposals has no defined drizzle relation
// to taskCapabilities in schema.ts (checked before writing this route), so
// this batches one findCapabilityById() per distinct capabilityId instead of
// asking listImprovementProposals() to fabricate a join the schema doesn't
// define.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Capability improvement proposals are veridian_admin-only" }, { status: 403 })
  }

  const statusParam = request.nextUrl.searchParams.get("status")
  if (statusParam && !VALID_STATUSES.includes(statusParam as ProposalStatus)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 })
  }

  const proposals = await listImprovementProposals(statusParam as ProposalStatus | undefined)

  const capabilityIds = Array.from(new Set(proposals.map((p) => p.capabilityId)))
  const capabilities = await Promise.all(capabilityIds.map((id) => findCapabilityById(id)))
  const capabilityById = new Map(capabilities.filter((c) => c !== null).map((c) => [c!.id, c!]))

  return NextResponse.json({
    proposals: proposals.map((p) => ({
      ...p,
      capability: capabilityById.get(p.capabilityId)
        ? {
            capabilityKey: capabilityById.get(p.capabilityId)!.capabilityKey,
            modePill: capabilityById.get(p.capabilityId)!.modePill,
            pathKeys: capabilityById.get(p.capabilityId)!.pathKeys,
          }
        : null,
    })),
  })
}
