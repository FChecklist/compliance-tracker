import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { organisations } from "@compliancetrack/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({ name: z.string().min(2).optional(), timezone: z.string().optional(), financial_year_start: z.string().optional() });

export const GET = withAuth(async (_req, ctx) => {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, ctx.orgId)).limit(1);
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ organisation: org });
});

export const PUT = withAuth(async (req, ctx) => {
  const data = updateSchema.parse(await req.json());
  await db.update(organisations).set({ ...data, updated_at: new Date() }).where(eq(organisations.id, ctx.orgId));
  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });