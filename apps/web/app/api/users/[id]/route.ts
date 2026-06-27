import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { users } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { logAuditEvent } from "@/lib/auth/audit-logger";

export const DELETE = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  if (id === ctx.userId) return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  await db.delete(users).where(and(eq(users.id, id), eq(users.org_id, ctx.orgId)));
  await logAuditEvent({ action: "user.removed", userId: ctx.userId, orgId: ctx.orgId, req, meta: { removed_user_id: id } });
  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });