import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { tenantAiConfig } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "@/lib/ai-config-crypto";
import { testProviderConnection } from "@/lib/orchestra-model-resolver";

// Super Boss v2 plan task V2-5 (BYOB bring-your-own-AI-model, 2026-07-20):
// per-org BYO AI model for the Mother Router's software_team scope. This is
// the software_team-scope analog of /api/settings/model-config (which serves
// the end_user_org / Orchestra Layer scope via customer_model_config). One
// active row per org (enforced by tenant_ai_config_one_active_per_org in the
// migration) -- "the org's model" is a single choice, not a per-layer matrix,
// so unlike model-config there is no orchestraLayerId axis and this route
// resolves/updates the org's SINGLE active row.
//
// provider is constrained to the ai_provider enum (groq/openai/anthropic/
// google/openrouter) like customerModelConfig; cerebras is deliberately
// excluded from that enum (see schema.ts:10633) and a tenant BYO model is
// routed through OpenRouter in practice (roster.ts: "Every model here is
// called via OpenRouter"), so openrouter is the expected value. We allow the
// full enum for parity with customerModelConfig's UI rather than hardcoding
// openrouter -- a tenant pointing at a self-hosted OpenRouter-compatible
// gateway via baseUrl may legitimately use a non-openrouter provider id.
const VALID_PROVIDERS = ["groq", "openai", "anthropic", "google", "openrouter"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(id: string): id is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(id);
}

// GET: this org's active tenant_ai_config row. Never returns the actual API
// key (only a hasKey boolean, same posture as model-config's GET) -- the key
// is decrypted server-side only by resolveTenantAiConfig() right before the
// LLM call, never surfaced to a client.
export async function GET() {
  const { orgId, response } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const config = await withTenantContext({ orgId }, (db) =>
      db.query.tenantAiConfig.findFirst({ where: and(eq(tenantAiConfig.orgId, orgId), eq(tenantAiConfig.isActive, true)) })
    );

    return NextResponse.json({
      config: config
        ? {
            id: config.id,
            provider: config.provider,
            modelName: config.modelName,
            baseUrl: config.baseUrl,
            hasKey: !!config.encryptedApiKey,
            isActive: config.isActive,
            lastUsedAt: config.lastUsedAt,
          }
        : null,
    });
  } catch (error) {
    console.error("Failed to load tenant AI config:", error);
    return NextResponse.json({ error: "Failed to load tenant AI config" }, { status: 500 });
  }
}

// POST: create or update the org's active BYO AI config. Admin-only, same as
// model-config. When an active row already exists, it is updated in place
// (the partial unique index tenant_ai_config_one_active_per_org guarantees
// there is at most one); a brand-new insert with isActive=true is therefore
// never a second active row. An admin toggling isActive=false is honored, and
// a subsequent save with isActive=true from a fresh row is the one-active
// path (the prior inactive row stays inactive -- partial unique index only
// constrains WHERE is_active = true).
export async function POST(request: NextRequest) {
  const { orgId, dbUser, response } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });
  const roleError = requireRole(dbUser, "admin");
  if (roleError) return roleError;

  try {
    const body = await request.json();
    const { provider, modelName, apiKey, baseUrl, isActive } = body as {
      provider?: string;
      modelName?: string;
      apiKey?: string;
      baseUrl?: string | null;
      isActive?: boolean;
    };

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` }, { status: 400 });
    }
    if (!modelName || typeof modelName !== "string" || !modelName.trim()) {
      return NextResponse.json({ error: "modelName is required" }, { status: 400 });
    }
    const trimmedModel = modelName.trim();
    if (baseUrl !== undefined && baseUrl !== null && (typeof baseUrl !== "string" || !baseUrl.trim())) {
      return NextResponse.json({ error: "baseUrl must be a non-empty string or null" }, { status: 400 });
    }
    const trimmedBaseUrl = baseUrl === undefined ? undefined : baseUrl === null ? null : baseUrl.trim();

    // Read the existing row first, OUTSIDE any write transaction -- the real
    // connection test below is a network call to a third-party provider and
    // must not hold a pooled Postgres transaction open for however long that
    // takes (up to ~1.2s of callLLM's own retry backoff on a transient
    // failure). Same shape and rationale as model-config's POST.
    const existing = await withTenantContext({ orgId }, (db) =>
      db.query.tenantAiConfig.findFirst({ where: and(eq(tenantAiConfig.orgId, orgId), eq(tenantAiConfig.isActive, true)) })
    );

    // Real connectivity check BEFORE persisting -- same posture as
    // model-config: tests with whichever key will actually end up stored (the
    // newly supplied one, or the existing encrypted key when the admin is only
    // changing modelName/baseUrl/isActive and leaving the key blank, which
    // the UI documents as "leave blank to keep existing key"). A row with no
    // key at all is still allowed to save (matches model-config's behavior:
    // an admin can fill provider/model first and add the key in a follow-up
    // edit) -- such a row is inert, since resolveTenantAiConfig()'s own gate
    // (`row.encryptedApiKey && row.modelName`) skips it and returns null.
    const keyToTest = apiKey || (existing?.encryptedApiKey ? await decryptApiKey(existing.encryptedApiKey) : undefined);
    if (keyToTest) {
      const testResult = await testProviderConnection(provider, trimmedModel, keyToTest);
      if (!testResult.ok) {
        return NextResponse.json({ error: `Connection test failed -- ${testResult.error}` }, { status: 400 });
      }
    }

    const result = await withTenantContext({ orgId }, async (db) => {
      const patch: Partial<typeof tenantAiConfig.$inferInsert> = {
        provider,
        modelName: trimmedModel,
        updatedAt: new Date(),
      };
      if (isActive !== undefined) patch.isActive = isActive;
      if (trimmedBaseUrl !== undefined) patch.baseUrl = trimmedBaseUrl;
      if (apiKey) patch.encryptedApiKey = await encryptApiKey(apiKey);

      if (existing) {
        const [updated] = await db
          .update(tenantAiConfig)
          .set(patch)
          .where(eq(tenantAiConfig.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db
        .insert(tenantAiConfig)
        .values({
          orgId,
          isActive: isActive ?? true,
          provider,
          modelName: trimmedModel,
          baseUrl: trimmedBaseUrl ?? null,
          encryptedApiKey: patch.encryptedApiKey,
        })
        .returning();
      return created;
    });

    return NextResponse.json({
      id: result.id,
      provider: result.provider,
      modelName: result.modelName,
      baseUrl: result.baseUrl,
      hasKey: !!result.encryptedApiKey,
      isActive: result.isActive,
    });
  } catch (error) {
    console.error("Failed to save tenant AI config:", error);
    return NextResponse.json({ error: "Failed to save tenant AI config" }, { status: 500 });
  }
}
