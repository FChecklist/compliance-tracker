import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance } from "@compliance/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit-logger";

export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-3)!;
  const { assignee_id, reason } = z.object({ assignee_id: z.string().uuid(), reason: z.string().optional() }).parse(await req.json());
  const [item] = await db.select({ assignee_id: compliance.assignee_id }).from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.update(compliance).set({ assignee_id, updated_at: new Date() }).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));
  await logAuditEvent({ action: "compliance.reassigned", userId: ctx.userId, orgId: ctx.orgId, req, meta: { compliance_id: id, old_assignee: item.assignee_id, new_assignee: assignee_id, reason } });
  return NextResponse.json({ success: true });
}, { roles: ["account_admin","client_department_admin"] });