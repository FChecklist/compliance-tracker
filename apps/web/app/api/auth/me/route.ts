import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { users, organisations } from "@compliancetrack/db/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const [user] = await db.select({ id: users.id, email: users.email, full_name: users.full_name, role: users.role, org_id: users.org_id })
    .from(users).where(and(eq(users.id, ctx.userId), eq(users.org_id, ctx.orgId))).limit(1);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const [org] = await db.select({ id: organisations.id, name: organisations.name, onboarding_completed: organisations.onboarding_completed, onboarding_step: organisations.onboarding_step })
    .from(organisations).where(eq(organisations.id, ctx.orgId)).limit(1);

  return NextResponse.json({ user, organisation: org });
});