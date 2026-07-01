import { aiAssistants } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ assistants: [] });

  try {
    const assistants = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.aiAssistants.findMany({
        orderBy: asc(aiAssistants.assistantNumber),
      })
    );

    return NextResponse.json({
      assistants: assistants.map((a) => ({
        id: a.id,
        assistantNumber: a.assistantNumber,
        label: a.label,
        status: a.status,
        personalityConfig: a.personalityConfig,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Assistants list error:", error);
    return NextResponse.json({ error: "Failed to fetch assistants" }, { status: 500 });
  }
}
