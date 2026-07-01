import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { customerModelConfig } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { eq } from "drizzle-orm";

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
      const existing = await db.query.customerModelConfig.findFirst({ where: eq(customerModelConfig.id, id) });
      if (!existing) return false;
      await db.delete(customerModelConfig).where(eq(customerModelConfig.id, id));
      return true;
    });

    if (!result) return NextResponse.json({ error: "Config not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete model config:", error);
    return NextResponse.json({ error: "Failed to delete model config" }, { status: 500 });
  }
}
