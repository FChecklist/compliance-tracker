import { db, embeddings } from "@/lib/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createHash } from "crypto";

// Re-use the same connection string logic as db/index.ts
function getConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace("https://", "").split(".")[0];
    return `postgresql://postgres.${ref}:${dbPassword}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;
  }

  throw new Error("No database connection string available.");
}

// Raw SQL client for vector operations (Drizzle doesn't support vector type)
let rawClient: ReturnType<typeof postgres> | null = null;
function getRawClient() {
  if (!rawClient) {
    rawClient = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
    });
  }
  return rawClient;
}

// Wave 73 (AI_OS_CERTIFICATION.md §1.3, "provision a real embedding model"):
// GROQ_API_KEY has never been set in Vercel (confirmed in the 2026-07-04
// security sweep -- it exists in GitHub Secrets only, and nobody has the raw
// value to add it), so the Groq path below has been dead code in production
// since Wave 43 first wrote it: every real request has always silently
// fallen through to the hash-based pseudo-vector. OPENROUTER_API_KEY, by
// contrast, is genuinely live in Vercel (Wave 45+, used by every callLLM
// site in production today) and OpenRouter does expose a real
// POST /api/v1/embeddings endpoint (confirmed live via `curl` -- returns 401
// Missing Authentication, not 404, proving the route exists) proxying
// OpenAI's text-embedding-3-small (1536-dim, matching this table's existing
// `vector(1536)` column with zero schema change). Tried first now, ahead of
// the Groq path, which is kept only for the case a BYOK caller explicitly
// passes a Groq key.
async function tryOpenRouterEmbedding(text: string): Promise<number[] | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text.slice(0, 8000) }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.data[0].embedding as number[];
    }
    console.warn("OpenRouter embedding API returned", res.status, "— trying next fallback");
  } catch (err) {
    console.warn("OpenRouter embedding fetch failed:", err, "— trying next fallback");
  }
  return null;
}

/**
 * Generate an embedding vector, preferring OpenRouter (platform-wide,
 * genuinely configured) over Groq (BYOK-only in practice -- see comment
 * above) over a deterministic hash-based pseudo-vector as the last resort.
 */
export async function generateEmbedding(
  text: string,
  apiKey?: string
): Promise<number[]> {
  const openRouterResult = await tryOpenRouterEmbedding(text);
  if (openRouterResult) return openRouterResult;

  const key = apiKey || process.env.GROQ_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "nomic-embed-text",
          input: text.slice(0, 8000), // model limit
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.data[0].embedding as number[];
      }
      console.warn("Groq embedding API returned", res.status, "— using fallback");
    } catch (err) {
      console.warn("Groq embedding fetch failed:", err, "— using fallback");
    }
  }

  // Last resort: deterministic hash-based pseudo-embedding (1536 dimensions)
  console.warn("No real embedding provider available (OpenRouter and Groq both unavailable) — using hash-based pseudo-vector. Semantic search quality will be degraded.");
  return hashToVector(text, 1536);
}

/**
 * Simple hash-based pseudo-embedding for fallback / dev environments.
 * Produces deterministic, normalised 1536-dim vectors from text.
 */
function hashToVector(text: string, dims: number): number[] {
  const vec: number[] = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    // Distribute each character across the vector
    const slot = (i * 31 + charCode) % dims;
    vec[slot] += (charCode / 127) * Math.sin(i + 1);
  }
  // Normalise to unit length
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Store an embedding for an entity in the database.
 * Upserts based on entity_type + entity_id + content_hash.
 */
export async function storeEmbedding(
  entityType: string,
  entityId: string,
  content: string,
  orgId?: string
): Promise<void> {
  const contentHash = createHash("sha256").update(content).digest("hex");

  // Check if we already have an embedding for this exact content
  const existing = await db.query.embeddings.findFirst({
    where: (e, { and, eq }) =>
      and(
        eq(e.entityType, entityType),
        eq(e.entityId, entityId),
        eq(e.contentHash, contentHash)
      ),
  });

  if (existing) return; // Already embedded with same content

  const vector = await generateEmbedding(content);
  const vectorStr = `[${vector.join(",")}]`;

  const client = getRawClient();

  // Delete old embedding for this entity if content changed
  await client`DELETE FROM compliance.embeddings WHERE entity_type = ${entityType} AND entity_id = ${entityId}`;

  // Insert new embedding with raw SQL (Drizzle can't handle vector type)
  await client`
    INSERT INTO compliance.embeddings (id, entity_type, entity_id, content_hash, content, org_id, embedding, created_at)
    VALUES (
      gen_random_uuid()::text,
      ${entityType},
      ${entityId},
      ${contentHash},
      ${content},
      ${orgId || null},
      ${vectorStr}::vector,
      NOW()
    )
  `;
}

/**
 * Find similar items using cosine similarity via pgvector.
 * Returns results ordered by most similar first.
 */
export async function findSimilar(
  query: string,
  orgId?: string,
  limit: number = 10
): Promise<{
  entityType: string;
  entityId: string;
  score: number;
  content: string;
}[]> {
  const queryVector = await generateEmbedding(query);
  const vectorStr = `[${queryVector.join(",")}]`;

  const client = getRawClient();

  if (orgId) {
    // Wave 43 (Capability Registry): also match org_id IS NULL rows -- e.g.
    // moduleRegistry entries are platform-wide, not org-scoped, and were
    // previously silently excluded from every org-scoped search. Zero
    // behavior change for the existing compliance-item caller (compliance
    // items are always org-scoped already, never null-org).
    const rows = await client`
      SELECT e.entity_type, e.entity_id, e.content,
             1 - (e.embedding <=> ${vectorStr}::vector) as score
      FROM compliance.embeddings e
      WHERE e.org_id = ${orgId} OR e.org_id IS NULL
      ORDER BY e.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      entityType: r.entity_type as string,
      entityId: r.entity_id as string,
      score: Number(r.score),
      content: r.content as string,
    }));
  }

  // No org filter
  const rows = await client`
    SELECT e.entity_type, e.entity_id, e.content,
           1 - (e.embedding <=> ${vectorStr}::vector) as score
    FROM compliance.embeddings e
    ORDER BY e.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    score: Number(r.score),
    content: r.content as string,
  }));
}

/**
 * Delete embedding for an entity (useful when entity is deleted).
 */
export async function deleteEmbedding(
  entityType: string,
  entityId: string
): Promise<void> {
  const client = getRawClient();
  await client`DELETE FROM compliance.embeddings WHERE entity_type = ${entityType} AND entity_id = ${entityId}`;
}