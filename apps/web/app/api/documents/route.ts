import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { documents } from "@compliancetrack/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  compliance_id: z.string().uuid().optional(),
  filename: z.string().min(1),
  storage_path: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
});

export const GET = withAuth(async (req, ctx) => {
  const cid = req.nextUrl.searchParams.get("compliance_id");
  const where = cid ? and(eq(documents.org_id, ctx.orgId), eq(documents.compliance_id, cid)) : eq(documents.org_id, ctx.orgId);
  const rows = await db.select().from(documents).where(where).limit(100);
  return NextResponse.json({ success: true, data: rows });
});

export const POST = withAuth(async (req, ctx) => {
  const data = schema.parse(await req.json());
  const [doc] = await db.insert(documents).values({ org_id: ctx.orgId, uploaded_by: ctx.userId, ...data }).returning();
  return NextResponse.json({ success: true, data: doc }, { status: 201 });
}, { roles: ["account_admin", "client_department_admin", "editor"] });