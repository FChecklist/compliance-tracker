import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { apiTokens } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

// GET /api/tokens/[id] — get token metadata (never the hash)
export const GET = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const [token] = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      permissions: apiTokens.permissions,
      last_used_at: apiTokens.last_used_at,
      expires_at: apiTokens.expires_at,
      created_at: apiTokens.created_at,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.org_id, ctx.orgId)));

  if (!token) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Token not found" } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: token });
}, { roles: ["account_admin"] });

// PUT /api/tokens/[id] — update name or permissions
export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const data = updateSchema.parse(await req.json());

  const set: Record<string, unknown> = {};
  if (data.name !== undefined) set.name = data.name;
  if (data.permissions !== undefined) set.permissions = data.permissions;
  if (data.expires_at !== undefined) set.expires_at = data.expires_at ? new Date(data.expires_at) : null;

  await db
    .update(apiTokens)
    .set(set)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.org_id, ctx.orgId)));

  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });

// DELETE /api/tokens/[id] — revoke (delete) a token
export const DELETE = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.org_id, ctx.orgId)));

  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });