import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { organisations } from "@compliancetrack/db";
import { eq } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const [org] = await db.select({ plan_type: organisations.plan_type }).from(organisations).where(eq(organisations.id, ctx.orgId)).limit(1);
  const limits: Record<string,number> = { trial: 10000, starter: 100000, professional: 500000, enterprise: 5000000 };
  const limit = limits[org?.plan_type ?? "trial"] ?? 10000;
  return NextResponse.json({ org_id: ctx.orgId, tokens_used: 0, limit, usage_percent: 0, status: "ok", plan: org?.plan_type });
});