import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { db, aiConfigurations } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { encryptApiKey } from "@/lib/ai-config-crypto";

const VALID_PROVIDERS = ["groq", "openai", "anthropic", "google"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(id: string): id is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(id);
}

export async function GET() {
  const { orgId, response } = await requireAuth();
  if (response) return response;
  if (!orgId) {
    return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });
  }

  try {
    const rows = await db.query.aiConfigurations.findMany({
      where: eq(aiConfigurations.orgId, orgId),
    });

    // NEVER return the actual key — only provider flags and whether one is set
    const providers: Record<string, {
      extraction: boolean;
      qa: boolean;
      drafting: boolean;
      hasKey: boolean;
      isDefault: boolean;
      isActive: boolean;
    }> = {};

    for (const row of rows) {
      providers[row.provider] = {
        extraction: row.useForExtraction,
        qa: row.useForQA,
        drafting: row.useForDrafting,
        hasKey: !!row.encryptedApiKey,
        isDefault: row.isDefault,
        isActive: row.isActive,
      };
    }

    const usePlatformAI = !rows.some((r) => r.isDefault && r.isActive);

    return NextResponse.json({ providers, usePlatformAI });
  } catch (error) {
    console.error("Failed to load AI configuration:", error);
    return NextResponse.json({ error: "Failed to load AI configuration" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { orgId, response } = await requireAuth();
  if (response) return response;
  if (!orgId) {
    return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { providers } = body as {
      providers?: Record<string, {
        key?: string;
        extraction?: boolean;
        qa?: boolean;
        drafting?: boolean;
        isDefault?: boolean;
        isActive?: boolean;
      }>;
    };

    if (!providers || typeof providers !== "object") {
      return NextResponse.json({ error: "providers is required" }, { status: 400 });
    }

    for (const [providerId, cfg] of Object.entries(providers)) {
      if (!isValidProvider(providerId)) continue;

      const existing = await db.query.aiConfigurations.findFirst({
        where: and(eq(aiConfigurations.orgId, orgId), eq(aiConfigurations.provider, providerId)),
      });

      const patch: Partial<typeof aiConfigurations.$inferInsert> = { updatedAt: new Date() };
      if (cfg.extraction !== undefined) patch.useForExtraction = cfg.extraction;
      if (cfg.qa !== undefined) patch.useForQA = cfg.qa;
      if (cfg.drafting !== undefined) patch.useForDrafting = cfg.drafting;
      if (cfg.isDefault !== undefined) patch.isDefault = cfg.isDefault;
      if (cfg.isActive !== undefined) patch.isActive = cfg.isActive;
      if (cfg.key) patch.encryptedApiKey = await encryptApiKey(cfg.key);

      if (existing) {
        await db.update(aiConfigurations).set(patch).where(eq(aiConfigurations.id, existing.id));
      } else {
        await db.insert(aiConfigurations).values({
          orgId,
          provider: providerId,
          useForExtraction: false,
          useForQA: false,
          useForDrafting: false,
          isDefault: false,
          isActive: true,
          ...patch,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save AI configuration:", error);
    return NextResponse.json({ error: "Failed to save AI configuration" }, { status: 500 });
  }
}
