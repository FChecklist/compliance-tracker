import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { customerModelConfig, orchestraLayers } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq, isNull } from "drizzle-orm";
import { encryptApiKey } from "@/lib/ai-config-crypto";

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
    const { orchestraLayerId, provider, modelName, apiKey, isActive } = body as {
      orchestraLayerId?: string | null;
      provider?: string;
      modelName?: string;
      apiKey?: string;
      isActive?: boolean;
    };

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` }, { status: 400 });
    }
    if (!modelName || typeof modelName !== "string" || !modelName.trim()) {
      return NextResponse.json({ error: "modelName is required" }, { status: 400 });
    }

    const layerId = orchestraLayerId ?? null;

    const result = await withTenantContext({ orgId }, async (db) => {
      const existing = await db.query.customerModelConfig.findFirst({
        where: and(
          eq(customerModelConfig.orgId, orgId),
          layerId ? eq(customerModelConfig.orchestraLayerId, layerId) : isNull(customerModelConfig.orchestraLayerId)
        ),
      });

      const patch: Partial<typeof customerModelConfig.$inferInsert> = {
        provider,
        modelName: modelName.trim(),
        updatedAt: new Date(),
      };
      if (isActive !== undefined) patch.isActive = isActive;
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
          provider,
          modelName: modelName.trim(),
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
    });
  } catch (error) {
    console.error("Failed to save model config:", error);
    return NextResponse.json({ error: "Failed to save model config" }, { status: 500 });
  }
}
