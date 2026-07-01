import { aiAssistants } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { generateEmbedding } from "@/lib/embeddings";

type MemoryMatchRow = {
  id: string;
  category: string;
  content: string;
  metadata: unknown;
  created_at: string;
  score: number;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const q = request.nextUrl.searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ error: "Query param 'q' is required" }, { status: 400 });

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const assistant = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, id) });
      if (!assistant) return null;

      const queryVector = await generateEmbedding(q);
      const vectorStr = `[${queryVector.join(",")}]`;

      return (await db.execute(sql`
        SELECT id, category, content, metadata, created_at,
               1 - (embedding <=> ${vectorStr}::vector) as score
        FROM compliance.assistant_memories
        WHERE assistant_id = ${id}
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT 10
      `)) as MemoryMatchRow[];
    });

    if (result === null) return NextResponse.json({ error: "Assistant not found" }, { status: 404 });

    return NextResponse.json({
      matches: result.map((m) => ({
        id: m.id,
        category: m.category,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.created_at,
        score: Number(m.score),
      })),
    });
  } catch (error) {
    console.error("Assistant memory search error:", error);
    return NextResponse.json({ error: "Failed to search memories" }, { status: 500 });
  }
}
