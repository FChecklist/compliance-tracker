import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance, complianceHistory } from "@compliance/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit-logger";

const bulkSchema = z.object({
  compliance_ids: z.array(z.string().uuid()).min(1).max(100),
  new_status: z.enum(["draft", "pending", "in_progress", "completed", "overdue", "not_applicable"]),
  reason: z.string().min(1).max(1000).optional(),
});

export const POST = withAuth(async (req, ctx) => {
  const body = bulkSchema.parse(await req.json());
  const { compliance_ids, new_status, reason } = body;

  const items = await db.select({ id: compliance.id, status: compliance.status }).from(compliance)
    .where(and(eq(compliance.org_id, ctx.orgId), inArray(compliance.id, compliance_ids)));

  if (items.length !== compliance_ids.length) {
    return NextResponse.json({ error: "Some items not found or don't belong to your org" }, { status: 400 });
  }

  await db.update(compliance)
    .set({ status: new_status, updated_at: new Date() })
    .where(and(eq(compliance.org_id, ctx.orgId), inArray(compliance.id, compliance_ids)));

  const historyEntries = items.map((item) => ({
    compliance_id: item.id, old_status: item.status, new_status,
    changed_by: ctx.userId, change_reason: reason ?? null,
  }));
  await db.insert(complianceHistory).values(historyEntries);

  await logAuditEvent({
    action: "compliance.bulk_status_change", userId: ctx.userId, orgId: ctx.orgId, req,
    meta: { compliance_ids, new_status, reason, count: items.length },
  });

  return NextResponse.json({ success: true, updated_count: items.length });
}, { roles: ["account_admin", "client_department_admin", "editor"] });