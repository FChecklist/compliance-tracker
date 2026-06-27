import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance, complianceHistory, notifications } from "@compliancetrack/db";
import { and, eq, inArray } from "drizzle-orm";
import { BulkStatusChangeSchema, StatusTransitions } from "@compliancetrack/types";
import { logAuditEvent } from "@/lib/auth/audit-logger";

// ─── POST /api/compliance/bulk ──────────────────────────────────────
// Bulk status change (up to 100 items).
// Validates transitions per-item, inserts compliance_history + audit log.
export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = BulkStatusChangeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const { compliance_ids, new_status, reason } = parsed.data;

  // Fetch all items scoped to org
  const items = await db.select({ id: compliance.id, status: compliance.status, title: compliance.title, assignee_id: compliance.assignee_id })
    .from(compliance).where(and(eq(compliance.org_id, ctx.orgId), inArray(compliance.id, compliance_ids)));

  if (!items || items.length === 0) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "No matching compliance items found" } }, { status: 404 });
  }

  // Validate transitions per item
  const validIds: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const item of items) {
    const current = item.status as keyof typeof StatusTransitions;
    const allowed = StatusTransitions[current];
    if (allowed && allowed.includes(new_status)) {
      validIds.push(item.id);
    } else {
      skipped.push({ id: item.id, reason: `Cannot transition from "${current}" to "${new_status}"` });
    }
  }

  if (validIds.length === 0) {
    return NextResponse.json({ success: false, error: { code: "NO_VALID_TRANSITIONS", message: "None of the items can transition to the requested status" } }, { status: 422 });
  }

  // Bulk update
  await db.update(compliance).set({ status: new_status, updated_at: new Date() }).where(inArray(compliance.id, validIds));

  // Insert compliance_history for each
  const historyRows = items
    .filter((item) => validIds.includes(item.id))
    .map((item) => ({
      compliance_id: item.id,
      old_status: item.status,
      new_status,
      changed_by: ctx.userId,
      change_reason: reason ?? null,
    }));
  await db.insert(complianceHistory).values(historyRows);

  // Audit log (single entry for the bulk operation)
  await logAuditEvent({
    action: "compliance.status_changed", userId: ctx.userId, orgId: ctx.orgId, req,
    entityId: "bulk",
    meta: { new_status, reason: reason ?? null, updated_count: validIds.length, skipped_count: skipped.length, compliance_ids: validIds },
  });

  // Notify assignees of updated items
  const itemsWithAssignees = items.filter((i) => validIds.includes(i.id) && i.assignee_id);
  if (itemsWithAssignees.length > 0) {
    const assigneeMap = new Map<string, string[]>();
    for (const i of itemsWithAssignees) {
      const aid = i.assignee_id!;
      if (!assigneeMap.has(aid)) assigneeMap.set(aid, []);
      assigneeMap.get(aid)!.push(i.title);
    }
    const notifRows = Array.from(assigneeMap.entries()).map(([userId, titles]) => ({
      org_id: ctx.orgId,
      user_id: userId,
      type: "status_changed" as const,
      title: `${titles.length} compliance item(s) status changed`,
      body: titles.join(", "),
      link_url: "/compliance",
    }));
    await db.insert(notifications).values(notifRows);
  }

  return NextResponse.json({
    success: true,
    data: { updated_count: validIds.length, skipped },
  });
}, { roles: ["account_admin", "client_department_admin"] });