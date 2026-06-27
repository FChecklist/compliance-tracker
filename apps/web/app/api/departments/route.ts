import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { departments } from "@compliancetrack/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const createSchema = z.object({ name: z.string().min(1), description: z.string().optional() });

export const GET = withAuth(async (_req, ctx) => {
  const rows = await db.select().from(departments).where(eq(departments.org_id, ctx.orgId));
  return NextResponse.json({ departments: rows });
});

export const POST = withAuth(async (req, ctx) => {
  const data = createSchema.parse(await req.json());
  const id = uuidv4();
  await db.insert(departments).values({ id, org_id: ctx.orgId, name: data.name, description: data.description });
  return NextResponse.json({ success: true, id }, { status: 201 });
}, { roles: ["account_admin", "client_department_admin"] });