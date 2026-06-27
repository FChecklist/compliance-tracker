import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { organisations } from "@compliancetrack/db";
import { eq } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const [org] = await db.select({ onboarding_step: organisations.onboarding_step, onboarding_completed: organisations.onboarding_completed, onboarding_skipped_ai: organisations.onboarding_skipped_ai })
    .from(organisations).where(eq(organisations.id, ctx.orgId)).limit(1);
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });
  const steps = ["profile","departments","users","compliance_categories","ai_library"];
  return NextResponse.json({ current_step: org.onboarding_step, current_step_name: steps[org.onboarding_step] ?? "complete", completed: org.onboarding_completed, skipped_ai: org.onboarding_skipped_ai, total_steps: 5 });
});