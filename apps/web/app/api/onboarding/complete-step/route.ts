import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { organisations } from "@compliancetrack/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({ step: z.number().min(1).max(5), skip_ai: z.boolean().optional() });

export const POST = withAuth(async (req, ctx) => {
  const body = schema.parse(await req.json());
  const isComplete = body.step >= 5;
  await db.update(organisations).set({
    onboarding_step: body.step,
    onboarding_completed: isComplete,
    ...(body.skip_ai !== undefined ? { onboarding_skipped_ai: body.skip_ai } : {}),
  }).where(eq(organisations.id, ctx.orgId));
  return NextResponse.json({ success: true, step: body.step, completed: isComplete });
});