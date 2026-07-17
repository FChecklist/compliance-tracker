import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { resolveBranding, updateBranding, OrgBrandingValidationError } from "@/lib/services/org-branding-service";

// Wave B (VERIDIAN Review Framework remediation, "BYOB white-label
// branding"): org-branding-service.ts was built with no settings surface at
// all before this -- this is that surface, following org-limits/route.ts's
// own admin-gating pattern (GET is any authenticated org member, PATCH
// requires admin-or-above via requireRole, same helper/shape as every other
// admin-only route in this codebase, e.g. access-review/cycles/route.ts).
export async function GET() {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const branding = await resolveBranding(orgId);
  return NextResponse.json({ branding });
}

export async function PATCH(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const body = await request.json();
    const branding = await updateBranding(orgId, {
      primaryColor: "primaryColor" in body ? body.primaryColor : undefined,
      accentColor: "accentColor" in body ? body.accentColor : undefined,
      customDomain: "customDomain" in body ? body.customDomain : undefined,
      emailSenderName: "emailSenderName" in body ? body.emailSenderName : undefined,
    });
    return NextResponse.json({ branding });
  } catch (error) {
    if (error instanceof OrgBrandingValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Branding update error:", error);
    return NextResponse.json({ error: "Failed to update branding" }, { status: 500 });
  }
}
