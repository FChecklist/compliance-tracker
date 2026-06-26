import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { notifications } from "@compliance/db/schema";
import { and, eq, desc } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const rows = await db.select().from(notifications)
    .where(and(eq(notifications.org_id, ctx.orgId), eq(notifications.user_id, ctx.userId)))
    .orderBy(desc(notifications.created_at)).limit(50);
  return NextResponse.json({ notifications: rows });
});