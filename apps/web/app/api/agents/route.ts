import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { salesAgents } from "@compliancetrack/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";

const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().optional(),
  commission_rate: z.number().min(0).max(100),
});

function generateReferralCode(): string {
  return `REF-${randomBytes(4).toString("hex").toUpperCase()}`;
}

// GET /api/agents — list sales agents for the org
export const GET = withAuth(async (_req, ctx) => {
  const rows = await db
    .select()
    .from(salesAgents)
    .where(eq(salesAgents.org_id, ctx.orgId))
    .orderBy(desc(salesAgents.created_at));

  return NextResponse.json({ success: true, data: { agents: rows } });
}, { roles: ["account_admin"] });

// POST /api/agents — create a sales agent
export const POST = withAuth(async (req, ctx) => {
  const body = createAgentSchema.parse(await req.json());

  await db.insert(salesAgents).values({
    org_id: ctx.orgId,
    name: body.name,
    email: body.email,
    phone: body.phone ?? null,
    commission_rate: body.commission_rate.toString(),
    unique_referral_code: generateReferralCode(),
  });

  return NextResponse.json({
    success: true,
    data: { name: body.name, email: body.email },
  }, { status: 201 });
}, { roles: ["account_admin"] });