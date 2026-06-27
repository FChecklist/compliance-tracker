import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { notifications } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";

export const POST = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-3)!;
  await db.update(notifications).set({ is_read: true }).where(and(eq(notifications.id, id), eq(notifications.user_id, ctx.userId)));
  return NextResponse.json({ success: true });
});