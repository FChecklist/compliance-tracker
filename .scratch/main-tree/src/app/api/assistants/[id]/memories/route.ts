import { aiAssistants } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { generateEmbedding } from "@/lib/embeddings";

// Row shape returned by the raw SQL below (vector columns aren't representable
// in Drizzle's schema -- see schema.ts's assistantMemories comment).
type MemoryRow = {
  id: string;
  assistant_id: string;
  category: string;
  content: string;
  metadata: unknown;
  created_at: string;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ memories: [] });

  try {
    const { id } = await params;

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const assistant = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, id) });
      if (!assistant) return null;

      return db.execute(sql`
        SELECT id, assistant_id, category, content, metadata, created_at
        FROM compliance.assistant_memories
        WHERE assistant_id = ${id}
        ORDER BY created_at DESC
        LIMIT 50
      `) as Promise<MemoryRow[]>;
    });

    if (result === null) return NextResponse.json({ error: "Assistant not found" }, { status: 404 });

    return NextResponse.json({
      memories: result.map((m) => ({
        id: m.id,
        category: m.category,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error("Assistant memories list error:", error);
    return NextResponse.json({ error: "Failed to fetch memories" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
    const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "general";
    const metadata = typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata) ? body.metadata : {};

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const assistant = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.id, id) });
      if (!assistant) return null;

      const vector = await generateEmbedding(content);
      const vectorStr = `[${vector.join(",")}]`;
      const metadataStr = JSON.stringify(metadata);

      const rows = (await db.execute(sql`
        INSERT INTO compliance.assistant_memories (id, assistant_id, category, content, embedding, metadata, created_at)
        VALUES (gen_random_uuid()::text, ${id}, ${category}, ${content}, ${vectorStr}::vector, ${metadataStr}::jsonb, now())
        RETURNING id, assistant_id, category, content, metadata, created_at
      `)) as MemoryRow[];

      return rows[0];
    });

    if (!result) return NextResponse.json({ error: "Assistant not found" }, { status: 404 });

    return NextResponse.json(
      {
        id: result.id,
        category: result.category,
        content: result.content,
        metadata: result.metadata,
        createdAt: result.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Assistant memory create error:", error);
    return NextResponse.json({ error: "Failed to create memory" }, { status: 500 });
  }
}
