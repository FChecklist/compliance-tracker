import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { webhooks } from "@compliance/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

const VALID_EVENTS = [
  "compliance.created",
  "compliance.status_changed",
  "compliance.overdue",
  "compliance.assigned",
  "user.invited",
  "document.uploaded",
] as const;

const createWebhookSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

// Generate a signing secret and its hash
function generateSecret(): { plaintext: string; hash: string } {
  const plaintext = `whsec_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

// GET /api/webhooks — list org webhooks (admin only)
export const GET = withAuth(async (_req, ctx) => {
  const rows = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      is_active: webhooks.is_active,
      created_at: webhooks.created_at,
      updated_at: webhooks.updated_at,
    })
    .from(webhooks)
    .where(eq(webhooks.org_id, ctx.orgId))
    .orderBy(desc(webhooks.created_at));

  return NextResponse.json({ success: true, data: { webhooks: rows } });
}, { roles: ["admin", "super_admin", "account_admin"] });

// POST /api/webhooks — create webhook (admin only)
export const POST = withAuth(async (req, ctx) => {
  const body = createWebhookSchema.parse(await req.json());
  const { plaintext, hash } = generateSecret();

  await db.insert(webhooks).values({
    org_id: ctx.orgId,
    url: body.url,
    events: body.events,
    secret_hash: hash,
  });

  return NextResponse.json({
    success: true,
    data: {
      url: body.url,
      events: body.events,
      signing_secret: plaintext, // Only returned once at creation
    },
  }, { status: 201 });
}, { roles: ["admin", "super_admin", "account_admin"] });