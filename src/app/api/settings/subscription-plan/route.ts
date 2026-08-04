import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getSubscriptionPlanStatus, setSubscriptionPlanForOrg, listActiveSubscriptionPlans } from "@/lib/services/subscription-plan-service";

// GAP-OCID-049-SUBSCRIPTION-PLAN-ENTITLEMENT Task E: admin-facing surface to
// assign an org's organisations.subscriptionPlanId -- confirmed via git grep
// (OCID_049 certification doc) that no such surface existed anywhere under
// src/app/, so the column could only ever be set by a direct DB write.
// Follows /api/settings/org-limits's exact GET/PATCH, admin-only shape.
export async function GET() {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const [status, plans] = await Promise.all([getSubscriptionPlanStatus(orgId), listActiveSubscriptionPlans()]);
  return NextResponse.json({
    status,
    plans: plans.map((p) => ({ id: p.id, name: p.name, userPackSize: p.userPackSize, assistantsPerUser: p.assistantsPerUser })),
  });
}

export async function PATCH(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || dbUser.role !== "admin") {
    return NextResponse.json({ error: "Only admins can change the organisation's subscription plan" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const body = await request.json();
    if (!("subscriptionPlanId" in body)) {
      return NextResponse.json({ error: "subscriptionPlanId is required (a real plan id, or null to clear the explicit assignment)" }, { status: 400 });
    }
    const subscriptionPlanId = body.subscriptionPlanId === null ? null : String(body.subscriptionPlanId);
    const status = await setSubscriptionPlanForOrg(orgId, subscriptionPlanId);
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update subscription plan" }, { status: 400 });
  }
}
