import { db, apiKeys, users, organisations } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

async function hashSHA256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 32; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `vk_${random}`;
}

export async function GET() {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ keys: [] });
    }

    const keys = await db.query.apiKeys.findMany({
      where: eq(apiKeys.orgId, userRecord.orgId),
      orderBy: desc(apiKeys.createdAt),
    });

    // NEVER return keyHash
    return NextResponse.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        isActive: k.isActive,
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
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const body = await request.json();
    const { name, scopes } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const validScopes = (scopes || "read")
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s === "read" || s === "write");
    if (validScopes.length === 0) {
      return NextResponse.json({ error: "At least one valid scope (read/write) is required" }, { status: 400 });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });
    if (!userRecord?.orgId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const rawKey = generateApiKey();
    const keyHash = await hashSHA256(rawKey);
    const keyPrefix = rawKey.substring(0, 8) + "...";

    const [created] = await db.insert(apiKeys).values({
      name: name.trim(),
      keyHash,
      keyPrefix,
      orgId: userRecord.orgId,
      scopes: validScopes.join(","),
      isActive: true,
    }).returning();

    // Return the FULL key ONLY on creation
    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        key: rawKey,
        keyPrefix: created.keyPrefix,
        scopes: created.scopes,
        isActive: created.isActive,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API key create error:", error);
    return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
  }
}