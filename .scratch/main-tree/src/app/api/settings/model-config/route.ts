import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { customerModelConfig, orchestraLayers } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq, isNull } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "@/lib/ai-config-crypto";
import { testProviderConnection } from "@/lib/orchestra-model-resolver";

const VALID_PROVIDERS = ["groq", "openai", "anthropic", "google"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(id: string): id is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(id);
}

// GET: list this org's BYO model overrides per Orchestra Layer, plus the
// full list of layers so the UI can show "using platform default" for any
// layer without a configured override. Never returns the actual API key.
export async function GET() {
  const { orgId, response } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const [configs, layers] = await withTenantContext({ orgId }, async (db) => [
      await db.query.customerModelConfig.findMany({ where: eq(customerModelConfig.orgId, orgId) }),
      await db.query.orchestraLayers.findMany({ orderBy: (t, { asc }) => asc(t.layerOrder) }),
    ]);

    return NextResponse.json({
      layers: layers.map((l) => ({ id: l.id, layerKey: l.layerKey, name: l.name, layerOrder: l.layerOrder })),
      configs: configs.map((c) => ({
        id: c.id,
        orchestraLayerId: c.orchestraLayerId,
        provider: c.provider,
        modelName: c.modelName,
        hasKey: !!c.encryptedApiKey,
        isActive: c.isActive,
        sharedPoolEligible: c.sharedPoolEligible,
      })),
    });
  } catch (error) {
    console.error("Failed to load model config:", error);
    return NextResponse.json({ error: "Failed to load model config" }, { status: 500 });
  }
}

// POST: create or update the BYO override for one layer (or all layers, if
// orchestraLayerId is omitted/null). Admin-only, same as ai-config.
export async function POST(request: NextRequest) {
  const { orgId, dbUser, response } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });
  const roleError = requireRole(dbUser, "admin");
  if (roleError) return roleError;

  try {
    const body = await request.json();
    const { orchestraLayerId, provider, modelName, apiKey, isActive, sharedPoolEligible } = body as {
      orchestraLayerId?: string | null;
      provider?: string;
      modelName?: string;
      apiKey?: string;
      isActive?: boolean;
      // Wave 18: explicit, per-config opt-in for lending idle capacity to
      // the PLATFORM's own internal orchestration work -- never another
      // org's workflow (see orchestra-model-resolver.ts's
      // resolvePlatformModelConfig() for the structural guarantee).
      sharedPoolEligible?: boolean;
    };

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` }, { status: 400 });
    }
    if (!modelName || typeof modelName !== "string" || !modelName.trim()) {
      return NextResponse.json({ error: "modelName is required" }, { status: 400 });
    }
    const trimmedModel = modelName.trim();

    const layerId = orchestraLayerId ?? null;

    // Review Framework remediation, Wave B (BYO-AI-model): read the existing
    // row first, OUTSIDE any write transaction -- this route previously did
    // its lookup+write in one withTenantContext transaction, which was fine
    // when the callback was pure DB work, but the real connection test added
    // below is a network call to a third-party provider and must not hold a
    // pooled Postgres transaction open for however long that takes (up to
    // ~1.2s of callLLM's own retry backoff on a transient failure).
    const existing = await withTenantContext({ orgId }, (db) =>
      db.query.customerModelConfig.findFirst({
        where: and(
          eq(customerModelConfig.orgId, orgId),
          layerId ? eq(customerModelConfig.orchestraLayerId, layerId) : isNull(customerModelConfig.orchestraLayerId)
        ),
      })
    );

    // Real connectivity check BEFORE persisting anything -- previously this
    // route only validated shape (provider in the enum, modelName
    // non-empty), so a bad/expired key or a misspelled model name saved
    // silently and only surfaced later as a confusing failure deep inside
    // some unrelated Orchestra Layer call. Tests with whichever key will
    // actually end up stored: the newly supplied one, or -- if the admin is
    // only changing modelName/isActive/sharedPoolEligible and leaving the
    // key field blank, which the UI documents as "leave blank to keep
    // existing key" -- the existing encrypted key, decrypted here and never
    // logged, never returned to the client. A brand-new config with no key
    // supplied and nothing to reuse is still allowed to save (matches this
    // route's pre-existing behavior of letting an admin fill in
    // provider/model first and add the key in a follow-up edit) -- such a
    // row is inert either way, since resolveModelConfig()'s own gate
    // (`customerConfig?.encryptedApiKey && customerConfig.modelName`) skips
    // any row missing a key and falls through to the platform default.
    const keyToTest = apiKey || (existing?.encryptedApiKey ? await decryptApiKey(existing.encryptedApiKey) : undefined);
    if (keyToTest) {
      const testResult = await testProviderConnection(provider, trimmedModel, keyToTest);
      if (!testResult.ok) {
        return NextResponse.json({ error: `Connection test failed -- ${testResult.error}` }, { status: 400 });
      }
    }

    const result = await withTenantContext({ orgId }, async (db) => {
      const patch: Partial<typeof customerModelConfig.$inferInsert> = {
        provider,
        modelName: trimmedModel,
        updatedAt: new Date(),
      };
      if (isActive !== undefined) patch.isActive = isActive;
      if (sharedPoolEligible !== undefined) patch.sharedPoolEligible = sharedPoolEligible;
      if (apiKey) patch.encryptedApiKey = await encryptApiKey(apiKey);

      if (existing) {
        const [updated] = await db
          .update(customerModelConfig)
          .set(patch)
          .where(eq(customerModelConfig.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db
        .insert(customerModelConfig)
        .values({
          orgId,
          orchestraLayerId: layerId,
          isActive: isActive ?? true,
          sharedPoolEligible: sharedPoolEligible ?? false,
          provider,
          modelName: trimmedModel,
          encryptedApiKey: patch.encryptedApiKey,
        })
        .returning();
      return created;
    });

    return NextResponse.json({
      id: result.id,
      orchestraLayerId: result.orchestraLayerId,
      provider: result.provider,
      modelName: result.modelName,
      hasKey: !!result.encryptedApiKey,
      isActive: result.isActive,
      sharedPoolEligible: result.sharedPoolEligible,
    });
  } catch (error) {
    console.error("Failed to save model config:", error);
    return NextResponse.json({ error: "Failed to save model config" }, { status: 500 });
  }
}
