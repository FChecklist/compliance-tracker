import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { documents } from "@compliancetrack/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const schema = z.object({
  compliance_id: z.string().uuid(),
  file_name: z.string(),
  file_url: z.string().url(),
  file_size: z.number().optional(),
  mime_type: z.string().optional(),
});

export const GET = withAuth(async (req, ctx) => {
  const cid = req.nextUrl.searchParams.get("compliance_id");
  const where = cid ? and(eq(documents.org_id, ctx.orgId), eq(documents.compliance_id, cid)) : eq(documents.org_id, ctx.orgId);
  const rows = await db.select().from(documents).where(where).limit(100);
  return NextResponse.json({ documents: rows });
});

export const POST = withAuth(async (req, ctx) => {
  const data = schema.parse(await req.json());
  const id = uuidv4();
  await db.insert(documents).values({ id, org_id: ctx.orgId, uploaded_by: ctx.userId, ...data });
  return NextResponse.json({ success: true, id }, { status: 201 });
}, { roles: ["account_admin","client_department_admin","editor"] });