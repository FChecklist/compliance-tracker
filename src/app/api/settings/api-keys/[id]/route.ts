import { db, apiKeys, users } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const existing = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, id), eq(apiKeys.orgId, userRecord.orgId)),
    });
    if (!existing) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) {
      const trimmed = body.name?.trim();
      if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      updates.name = trimmed;
    }
    if (body.scopes !== undefined) {
      const validScopes = body.scopes
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s === "read" || s === "write");
      if (validScopes.length === 0) {
        return NextResponse.json({ error: "At least one valid scope is required" }, { status: 400 });
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
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const existing = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, id), eq(apiKeys.orgId, userRecord.orgId)),
    });
    if (!existing) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    await db.delete(apiKeys).where(eq(apiKeys.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key delete error:", error);
    return NextResponse.json({ error: "Failed to delete API key" }, { status: 500 });
  }
}