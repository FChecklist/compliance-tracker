import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { users } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit-logger";

const schema = z.object({ role: z.enum(["client_department_admin","editor","viewer"]) });

export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-3)!;
  if (id === ctx.userId) return NextResponse.json({ error: "Cannot change own role" }, { status: 400 });
  const { role } = schema.parse(await req.json());
  await db.update(users).set({ role, updated_at: new Date() }).where(and(eq(users.id, id), eq(users.org_id, ctx.orgId)));
  await logAuditEvent({ action: "user.role_changed", userId: ctx.userId, orgId: ctx.orgId, req, meta: { target_user_id: id, new_role: role } });
  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });