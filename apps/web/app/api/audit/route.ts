import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { auditLog } from "@compliancetrack/db";
import { eq, desc } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const rows = await db.select().from(auditLog).where(eq(auditLog.org_id, ctx.orgId)).orderBy(desc(auditLog.created_at)).limit(100);
  return NextResponse.json({ audit_log: rows });
}, { roles: ["account_admin"] });