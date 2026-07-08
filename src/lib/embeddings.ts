import { db, embeddings } from "@/lib/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createHash } from "crypto";
import { getConnectionString } from "@/lib/db/connection-string";

// Raw SQL client for vector operations (Drizzle doesn't support vector type)
let rawClient: ReturnType<typeof postgres> | null = null;
function getRawClient() {
  if (!rawClient) {
    rawClient = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      // Gap closure, 2026-07-09: explicit low cap -- this client backs
      // occasional embedding reads/writes, not hot-path query traffic, and
      // previously had no max (defaulting to postgres.js's own cap of 10).
      // A single serverless invocation touching db/index.ts (max 1) +
      // tenant-scoped.ts (max 5) + this file + ai-config-crypto.ts could
      // otherwise open up to 26 connections, exhausting Supavisor pooler
      // headroom well before its nominal capacity under concurrent load.
      max: 2,
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

// Wave 99 (alibaba/zvec evaluation -- rejected as incompatible with Vercel
// Edge/Supabase Edge Functions; see PLATFORM_STRATEGY.md and this session's
// memory note for the full reasoning). The real latency bottleneck in
// semantic search was never pgvector's own query time (sub-millisecond at
// current scale) -- it's the network round-trip to OpenRouter's embeddings
// endpoint on every single call, including repeated identical query text
// (e.g. fde-service.ts re-embedding the same task description on every
// dispatch). This exact-match cache (keyed on sha256 of the literal text)
// skips that round-trip entirely on a repeat. Global, not org-scoped -- see
// the embeddingCache schema.ts comment for why that's safe.
async function getCachedEmbedding(contentHash: string): Promise<number[] | null> {
  const client = getRawClient();
  const rows = await client`
    SELECT embedding FROM compliance.embedding_cache WHERE content_hash = ${contentHash}
  `;
  if (rows.length === 0) return null;
  // Fire-and-forget freshness bump, matches this codebase's established
  // lastUsedAt-update convention (api_keys, customer_model_config).
  client`UPDATE compliance.embedding_cache SET last_used_at = NOW() WHERE content_hash = ${contentHash}`.catch(() => {});
  const raw = rows[0].embedding as string; // pgvector returns "[0.1,0.2,...]" text form
  return raw.slice(1, -1).split(",").map(Number);
}

async function setCachedEmbedding(contentHash: string, content: string, vector: number[]): Promise<void> {
  const vectorStr = `[${vector.join(",")}]`;
  const client = getRawClient();
  await client`
    INSERT INTO compliance.embedding_cache (id, content_hash, content, embedding, created_at, last_used_at)
    VALUES (gen_random_uuid()::text, ${contentHash}, ${content}, ${vectorStr}::vector, NOW(), NOW())
    ON CONFLICT (content_hash) DO NOTHING
  `;
}

/**
 * Generate an embedding vector, preferring a cached result (exact text
 * match) over OpenRouter (platform-wide, genuinely configured) over Groq
 * (BYOK-only in practice -- see comment above) over a deterministic
 * hash-based pseudo-vector as the last resort.
 */
export async function generateEmbedding(
  text: string,
  apiKey?: string
): Promise<number[]> {
  const contentHash = createHash("sha256").update(text).digest("hex");
  const cached = await getCachedEmbedding(contentHash);
  if (cached) return cached;

  const result = await generateEmbeddingUncached(text, apiKey);
  // Never cache the hash-based pseudo-vector fallback -- caching a
  // degraded-quality result under the same key a real provider would later
  // fill correctly would make the degradation permanent for that text.
  if (result.isReal) await setCachedEmbedding(contentHash, text, result.vector);
  return result.vector;
}

async function generateEmbeddingUncached(
  text: string,
  apiKey?: string
): Promise<{ vector: number[]; isReal: boolean }> {
  const openRouterResult = await tryOpenRouterEmbedding(text);
  if (openRouterResult) return { vector: openRouterResult, isReal: true };

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
        return { vector: data.data[0].embedding as number[], isReal: true };
      }
      console.warn("Groq embedding API returned", res.status, "— using fallback");
    } catch (err) {
      console.warn("Groq embedding fetch failed:", err, "— using fallback");
    }
  }

  // Last resort: deterministic hash-based pseudo-embedding (1536 dimensions)
  console.warn("No real embedding provider available (OpenRouter and Groq both unavailable) — using hash-based pseudo-vector. Semantic search quality will be degraded.");
  return { vector: hashToVector(text, 1536), isReal: false };
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