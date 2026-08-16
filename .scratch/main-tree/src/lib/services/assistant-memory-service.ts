// Wave 77 (AI_OS_CERTIFICATION.md §1.1 gap: assistant_memories was written
// via the CRUD route but never read back into any LLM call). Thin wrapper
// around the same raw-SQL pgvector pattern already used in
// src/app/api/assistants/[id]/memories/{route,search/route}.ts -- pgvector
// columns aren't representable in Drizzle, see schema.ts's assistant_memories
// comment. Callers pass an already-open tenant-scoped tx so this composes
// inside a caller's existing withTenantContext block instead of opening a
// second one.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { sql } from "drizzle-orm"
import { generateEmbedding } from "@/lib/embeddings"

export type AssistantMemoryMatch = { id: string; category: string; content: string; score: number }

const RELEVANCE_THRESHOLD = 0.5

// validUntil IS NULL respects the Wave 22 temporal-versioning design
// (validUntil set = superseded) -- this is the first real consumer of that
// column, so it's honored from the start rather than bolted on later.
export async function searchAssistantMemories(
  db: TenantDb, assistantId: string, queryText: string, limit = 5
): Promise<AssistantMemoryMatch[]> {
  const queryVector = await generateEmbedding(queryText)
  const vectorStr = `[${queryVector.join(",")}]`
  const rows = (await db.execute(sql`
    SELECT id, category, content, 1 - (embedding <=> ${vectorStr}::vector) as score
    FROM compliance.assistant_memories
    WHERE assistant_id = ${assistantId} AND valid_until IS NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `)) as { id: string; category: string; content: string; score: number }[]
  return rows.map((r) => ({ ...r, score: Number(r.score) })).filter((r) => r.score > RELEVANCE_THRESHOLD)
}

export async function recordAssistantMemory(
  db: TenantDb, assistantId: string, category: string, content: string, metadata: object = {}
): Promise<void> {
  const vector = await generateEmbedding(content)
  const vectorStr = `[${vector.join(",")}]`
  await db.execute(sql`
    INSERT INTO compliance.assistant_memories (id, assistant_id, category, content, embedding, metadata, created_at)
    VALUES (gen_random_uuid()::text, ${assistantId}, ${category}, ${content}, ${vectorStr}::vector, ${JSON.stringify(metadata)}::jsonb, now())
  `)
}
