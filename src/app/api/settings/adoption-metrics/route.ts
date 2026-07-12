import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { computeOrgAdoptionMetrics } from "@/lib/adoption-metrics-service";

// subagent/audit-lifecycle (tree4-unified/50-completion-plan Priority 2
// item 3, D27/U-D27.B2.S1 "Adoption Dashboard"). admin/manager-gated
// (same bar as PATCH /api/settings/org-limits) rather than any-authenticated
// -- unlike seat/cost status (harmless to see), a "Lowest-Adoption" team
// ranking is exactly the kind of comparative-performance data that
// shouldn't be visible to every member by default.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can view adoption metrics" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const metrics = await computeOrgAdoptionMetrics(orgId);
  return NextResponse.json({ metrics });
}
