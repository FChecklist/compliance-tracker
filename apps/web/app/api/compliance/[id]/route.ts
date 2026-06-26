import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance } from "@compliance/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit-logger";

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["pending","in_progress","completed","overdue","not_applicable"]).optional(),
  priority: z.enum(["critical","high","medium","low"]).optional(),
  due_date: z.string().optional(),
  description: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
});

function getId(req: NextRequest) { return req.nextUrl.pathname.split("/").at(-2)!; }

export const GET = withAuth(async (req, ctx) => {
  const id = getId(req);
  const [item] = await db.select().from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ compliance: item });
});

export const PUT = withAuth(async (req, ctx) => {
  const id = getId(req);
  const data = updateSchema.parse(await req.json());
  await db.update(compliance).set({ ...data, due_date: data.due_date ? new Date(data.due_date) : undefined, updated_at: new Date() })
    .where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));
  await logAuditEvent({ action: "compliance.updated", userId: ctx.userId, orgId: ctx.orgId, req, meta: { compliance_id: id } });
  return NextResponse.json({ success: true });
}, { roles: ["account_admin","client_department_admin","editor"] });

export const DELETE = withAuth(async (req, ctx) => {
  const id = getId(req);
  await db.delete(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));
  await logAuditEvent({ action: "compliance.deleted", userId: ctx.userId, orgId: ctx.orgId, req, meta: { compliance_id: id } });
  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });