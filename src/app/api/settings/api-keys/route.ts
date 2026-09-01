import { apiKeys } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";
import { hashSHA256, generateApiKey } from "@/lib/api-keys";

// R66 gap-closure (code-quality inspection 2026-09-01, critical finding):
// neither handler in this file previously called requireRole, so any
// authenticated org member -- not just admin -- could mint a new API key
// with read/write scope, granting durable programmatic access to the org's
// ERP/CRM/HR data. Both handlers now gate on requireRole(dbUser, "admin"),
// matching every sibling settings/* route (branding, sso, webhooks).
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
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
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
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
    // R45 gap (found 2026-08-24 UAT-testing R-C12): a caller sending `scopes`
    // as a JSON array (e.g. {"scopes":["read","write"]}) instead of a
    // comma-separated string crashed this into a generic 500 via
    // Array.prototype.split not existing -- normalize both shapes before
    // splitting so a malformed value gets the intended 400 instead.
    let scopesString: string;
    if (scopes === undefined || scopes === null) {
      scopesString = "read";
    } else if (Array.isArray(scopes)) {
      scopesString = scopes.join(",");
    } else if (typeof scopes === "string") {
      scopesString = scopes;
    } else {
      // Any other shape (number, boolean, object) is malformed input, not a
      // server error -- fall through to the empty-validScopes 400 below
      // instead of throwing on .split.
      scopesString = "";
    }
    const validScopes = scopesString
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
