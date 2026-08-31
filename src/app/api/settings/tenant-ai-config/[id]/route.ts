import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { tenantAiConfig } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq } from "drizzle-orm";

// Super Boss v2 plan task V2-5 (BYOB, 2026-07-20): DELETE clears the org's
// active tenant_ai_config row entirely, returning the software_team scope to
// the platform default (resolveTenantAiConfig() returns null -> Mother Router
// resolves exactly as before, no tenant override). Admin-only, same as the
// POST route and model-config's [id] DELETE. Deletes the row rather than
// toggling isActive=false because "reset to platform default" is a destructive
// intent (the admin is removing their BYO setup), matching model-config's
// "Reset to platform default" button behavior.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, dbUser, response } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });
  const roleError = requireRole(dbUser, "admin");
  if (roleError) return roleError;

  try {
    const { id } = await params;

    const result = await withTenantContext({ orgId }, async (db) => {
      // Scope by BOTH id and orgId: a malicious admin cannot pass another org's
      // config id and delete it -- the id alone is not sufficient (RLS would
      // also block this, but the explicit orgId predicate is belt-and-
      // suspenders, matching the defense-in-depth posture elsewhere).
      const existing = await db.query.tenantAiConfig.findFirst({
        where: and(eq(tenantAiConfig.id, id), eq(tenantAiConfig.orgId, orgId)),
      });
      if (!existing) return false;
      await db.delete(tenantAiConfig).where(eq(tenantAiConfig.id, id));
      return true;
    });

    if (!result) return NextResponse.json({ error: "Config not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete tenant AI config:", error);
    return NextResponse.json({ error: "Failed to delete tenant AI config" }, { status: 500 });
  }
}
