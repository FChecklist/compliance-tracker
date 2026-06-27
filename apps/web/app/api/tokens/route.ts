import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { apiTokens } from "@compliancetrack/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default([]),
  expires_at: z.string().datetime().optional(),
});

// Generate a plaintext token and its hash
function generateToken(): { plaintext: string; hash: string } {
  const plaintext = `ctk_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

// GET /api/tokens — list tokens for the org (admin only)
export const GET = withAuth(async (_req, ctx) => {
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      permissions: apiTokens.permissions,
      last_used_at: apiTokens.last_used_at,
      expires_at: apiTokens.expires_at,
      created_at: apiTokens.created_at,
    })
    .from(apiTokens)
    .where(eq(apiTokens.org_id, ctx.orgId))
    .orderBy(desc(apiTokens.created_at));

  return NextResponse.json({ success: true, data: { tokens: rows } });
}, { roles: ["account_admin"] });

// POST /api/tokens — create a new token (admin only)
export const POST = withAuth(async (req, ctx) => {
  const body = createTokenSchema.parse(await req.json());
  const { plaintext, hash } = generateToken();

  await db.insert(apiTokens).values({
    org_id: ctx.orgId,
    name: body.name,
    token_hash: hash,
    permissions: body.permissions,
    expires_at: body.expires_at ? new Date(body.expires_at) : null,
  });

  return NextResponse.json({
    success: true,
    data: {
      token: plaintext, // Only returned once at creation
      name: body.name,
      permissions: body.permissions,
      expires_at: body.expires_at ?? null,
    },
  }, { status: 201 });
}, { roles: ["account_admin"] });