import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getLicenseStatus, setLicensedSeats } from "@/lib/org-license-service";
import { getCostStatus, setCostCap } from "@/lib/cost-guard";

// Areas 16/11 admin-UI gap-close: org-license-service.ts and cost-guard.ts
// were built (Wave 172) with no settings page ever calling them -- this is
// the missing surface, following webhooks/route.ts's admin-only pattern.
export async function GET() {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const [license, cost] = await Promise.all([getLicenseStatus(orgId), getCostStatus(orgId)]);
  return NextResponse.json({ license, cost });
}

export async function PATCH(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can change organisation limits" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const body = await request.json();

    if ("licensedSeats" in body || "seatEnforcementEnabled" in body) {
      const licensedSeats = body.licensedSeats === null || body.licensedSeats === undefined ? null : Number(body.licensedSeats);
      if (licensedSeats !== null && (!Number.isFinite(licensedSeats) || licensedSeats < 1)) {
        return NextResponse.json({ error: "licensedSeats must be a positive number or null" }, { status: 400 });
      }
      await setLicensedSeats(orgId, licensedSeats, Boolean(body.seatEnforcementEnabled));
    }

    if ("monthlyCostCapUsd" in body || "costCapEnforcementEnabled" in body) {
      const monthlyCostCapUsd = body.monthlyCostCapUsd === null || body.monthlyCostCapUsd === undefined ? null : Number(body.monthlyCostCapUsd);
      if (monthlyCostCapUsd !== null && (!Number.isFinite(monthlyCostCapUsd) || monthlyCostCapUsd <= 0)) {
        return NextResponse.json({ error: "monthlyCostCapUsd must be a positive number or null" }, { status: 400 });
      }
      await setCostCap(orgId, monthlyCostCapUsd, Boolean(body.costCapEnforcementEnabled));
    }

    const [license, cost] = await Promise.all([getLicenseStatus(orgId), getCostStatus(orgId)]);
    return NextResponse.json({ license, cost });
  } catch (error) {
    console.error("Org limits update error:", error);
    return NextResponse.json({ error: "Failed to update organisation limits" }, { status: 500 });
  }
}
