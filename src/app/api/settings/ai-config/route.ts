import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";

// In-memory store for demo purposes (replace with database in production)
const aiConfigStore: Record<string, {
  providers: Record<string, {
    encryptedKey: string;
    extraction: boolean;
    qa: boolean;
    drafting: boolean;
  }>;
  usePlatformAI: boolean;
}> = {};

// Simple obfuscation (replace with proper encryption in production)
function obfuscateKey(key: string): string {
  return Buffer.from(key).toString("base64");
}

function deobfuscateKey(obfuscated: string): string {
  return Buffer.from(obfuscated, "base64").toString("utf-8");
}

export async function GET() {
  const { response } = await requireAuth();
  if (response) return response;

  try {
    const orgId = "default"; // In production, get from user's org
    const config = aiConfigStore[orgId];

    if (!config) {
      return NextResponse.json({
        providers: {},
        usePlatformAI: true,
      });
    }

    // NEVER return the actual key — only return provider names and feature flags
    const safeProviders: Record<string, {
      extraction: boolean;
      qa: boolean;
      drafting: boolean;
      hasKey: boolean;
    }> = {};

    for (const [providerId, provider] of Object.entries(config.providers)) {
      safeProviders[providerId] = {
        extraction: provider.extraction,
        qa: provider.qa,
        drafting: provider.drafting,
        hasKey: !!provider.encryptedKey,
      };
    }

    return NextResponse.json({
      providers: safeProviders,
      usePlatformAI: config.usePlatformAI,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load AI configuration" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { response } = await requireAuth();
  if (response) return response;

  try {
    const body = await request.json();
    const { providers, usePlatformAI } = body;
    const orgId = "default"; // In production, get from user's org

    const config = aiConfigStore[orgId] || {
      providers: {},
      usePlatformAI: true,
    };

    // Save provider configs (encrypt keys)
    if (providers) {
      for (const [providerId, providerConfig] of Object.entries(providers)) {
        const cfg = providerConfig as {
          key?: string;
          extraction?: boolean;
          qa?: boolean;
          drafting?: boolean;
        };

        if (!config.providers[providerId]) {
          config.providers[providerId] = {
            encryptedKey: "",
            extraction: false,
            qa: false,
            drafting: false,
          };
        }

        if (cfg.key) {
          config.providers[providerId].encryptedKey = obfuscateKey(cfg.key);
        }
        if (cfg.extraction !== undefined) {
          config.providers[providerId].extraction = cfg.extraction;
        }
        if (cfg.qa !== undefined) {
          config.providers[providerId].qa = cfg.qa;
        }
        if (cfg.drafting !== undefined) {
          config.providers[providerId].drafting = cfg.drafting;
        }
      }
    }

    if (usePlatformAI !== undefined) {
      config.usePlatformAI = usePlatformAI;
    }

    aiConfigStore[orgId] = config;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save AI configuration" },
      { status: 500 }
    );
  }
}