import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { users } from "@compliance/db/schema";
import { eq } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const rows = await db.select({ id: users.id, email: users.email, full_name: users.full_name, role: users.role, is_active: users.is_active, created_at: users.created_at })
    .from(users).where(eq(users.org_id, ctx.orgId));
  return NextResponse.json({ users: rows });
});