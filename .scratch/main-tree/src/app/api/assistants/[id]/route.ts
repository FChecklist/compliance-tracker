import { aiAssistants } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json();

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      // RLS (current_user_id() = ai_assistants.user_id) already prevents this
      // lookup from ever resolving another user's assistant -- this check is
      // for a clean 404 rather than an ambiguous empty result.
      const existing = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, id) });
      if (!existing) return null;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.label !== undefined) {
        const trimmed = typeof body.label === "string" ? body.label.trim() : "";
        if (!trimmed) return { error: "Label cannot be empty", status: 400 as const };
        updates.label = trimmed;
      }
      if (body.status !== undefined) {
        if (body.status !== "idle" && body.status !== "working") {
          return { error: "Status must be 'idle' or 'working'", status: 400 as const };
        }
        updates.status = body.status;
      }
      if (body.personalityConfig !== undefined) {
        if (typeof body.personalityConfig !== "object" || body.personalityConfig === null || Array.isArray(body.personalityConfig)) {
          return { error: "personalityConfig must be an object", status: 400 as const };
        }
        updates.personalityConfig = body.personalityConfig;
      }

      const [updated] = await db
        .update(aiAssistants)
        .set(updates)
        .where(eq(aiAssistants.id, id))
        .returning();

      return { updated };
    });

    if (!result) return NextResponse.json({ error: "Assistant not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    const { updated } = result;

    return NextResponse.json({
      id: updated.id,
      assistantNumber: updated.assistantNumber,
      label: updated.label,
      status: updated.status,
      personalityConfig: updated.personalityConfig,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Assistant update error:", error);
    return NextResponse.json({ error: "Failed to update assistant" }, { status: 500 });
  }
}
