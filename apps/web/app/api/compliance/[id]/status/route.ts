import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance, complianceHistory } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { ChangeStatusSchema, StatusTransitions } from "@compliancetrack/types";
import { logAuditEvent } from "@/lib/auth/audit-logger";

// ─── PUT /api/compliance/[id]/status ──────────────────────────────────
// Change status → insert compliance_history row + audit log.
export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-3)!;
  const body = await req.json();
  const parsed = ChangeStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const { new_status, reason } = parsed.data;

  // Fetch existing item
  const [item] = await db.select().from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!item) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compliance item not found" } }, { status: 404 });

  // Validate transition
  const currentStatus = item.status as keyof typeof StatusTransitions;
  const allowed = StatusTransitions[currentStatus];
  if (!allowed || !allowed.includes(new_status)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_TRANSITION", message: `Cannot transition from "${currentStatus}" to "${new_status}". Allowed: ${allowed?.join(", ") ?? "none"}` } },
      { status: 422 }
    );
  }

  // Update status
  await db.update(compliance).set({ status: new_status, updated_at: new Date() }).where(eq(compliance.id, id));

  // Insert compliance_history
  await db.insert(complianceHistory).values({
    compliance_id: id,
    old_status: currentStatus,
    new_status: new_status,
    changed_by: ctx.userId,
    change_reason: reason ?? null,
  });

  // Audit log
  await logAuditEvent({ action: "compliance.status_changed", userId: ctx.userId, orgId: ctx.orgId, req, entityId: id, meta: { old_status: currentStatus, new_status, reason: reason ?? null } });

  const [updated] = await db.select().from(compliance).where(eq(compliance.id, id)).limit(1);
  return NextResponse.json({ success: true, data: updated });
}, { roles: ["account_admin", "client_department_admin", "editor"] });