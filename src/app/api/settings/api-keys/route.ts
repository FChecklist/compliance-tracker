import { apiKeys } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { hashSHA256, generateApiKey } from "@/lib/api-keys";

export async function GET() {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ keys: [] });

  try {
    const keys = await withTenantContext({ orgId }, (db) =>
      db.query.apiKeys.findMany({
        orderBy: desc(apiKeys.createdAt),
      })
    );

    // NEVER return keyHash
    return NextResponse.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        isActive: k.isActive,
        rateLimitPerMinute: k.rateLimitPerMinute,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("API keys list error:", error);
    return NextResponse.json({ error: "Failed to fetch API keys" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const body = await request.json();
    const { name, scopes } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    // task-20260727-101145: "read:reports" is a narrower alternative to
    // "read" -- a customer minting a key specifically to hand to an
    // external AI (ChatGPT/z.ai) for src/app/api/v1/reports/** can scope it
    // down to reports-only instead of the broad "read" scope every other
    // /v1/* domain already accepts.
    const validScopes = (scopes || "read")
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s === "read" || s === "write" || s === "read:reports");
    if (validScopes.length === 0) {
      return NextResponse.json({ error: "At least one valid scope (read/write) is required" }, { status: 400 });
    }

    const rawKey = generateApiKey();
    const keyHash = await hashSHA256(rawKey);
    const keyPrefix = rawKey.substring(0, 8) + "...";

    const created = await withTenantContext({ orgId }, (db) =>
      db.insert(apiKeys).values({
        name: name.trim(),
        keyHash,
        keyPrefix,
        orgId,
        scopes: validScopes.join(","),
        isActive: true,
      }).returning()
    );

    // Return the FULL key ONLY on creation
    return NextResponse.json(
      {
        id: created[0].id,
        name: created[0].name,
        key: rawKey,
        keyPrefix: created[0].keyPrefix,
        scopes: created[0].scopes,
        isActive: created[0].isActive,
        createdAt: created[0].createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API key create error:", error);
    return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
  }
}
