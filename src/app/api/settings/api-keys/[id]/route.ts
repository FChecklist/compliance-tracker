import { apiKeys } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json();

    const result = await withTenantContext({ orgId }, async (db) => {
      const existing = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
      if (!existing) return null;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const trimmed = body.name?.trim();
        if (!trimmed) return { error: "Name cannot be empty", status: 400 as const };
        updates.name = trimmed;
      }
      if (body.scopes !== undefined) {
        const validScopes = body.scopes
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => s === "read" || s === "write");
        if (validScopes.length === 0) {
          return { error: "At least one valid scope is required", status: 400 as const };
        }
        updates.scopes = validScopes.join(",");
      }
      if (body.isActive !== undefined) {
        updates.isActive = Boolean(body.isActive);
      }

      const [updated] = await db
        .update(apiKeys)
        .set(updates)
        .where(eq(apiKeys.id, id))
        .returning();

      return { updated };
    });

    if (!result) return NextResponse.json({ error: "API key not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    const { updated } = result;

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      keyPrefix: updated.keyPrefix,
      scopes: updated.scopes,
      isActive: updated.isActive,
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("API key update error:", error);
    return NextResponse.json({ error: "Failed to update API key" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;

    const result = await withTenantContext({ orgId }, async (db) => {
      const existing = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
      if (!existing) return false;

      await db.delete(apiKeys).where(eq(apiKeys.id, id));
      return true;
    });

    if (!result) return NextResponse.json({ error: "API key not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key delete error:", error);
    return NextResponse.json({ error: "Failed to delete API key" }, { status: 500 });
  }
}
