import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance, notifications, users as usersTable } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { ReassignSchema } from "@compliancetrack/types";
import { logAuditEvent } from "@/lib/auth/audit-logger";

// ─── PUT /api/compliance/[id]/reassign ────────────────────────────────
// Reassign to a new user. Validates assignee is in the same org.
// Creates notifications for both old and new assignees.
export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-3)!;
  const body = await req.json();
  const parsed = ReassignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const { assignee_id, reason } = parsed.data;

  // Fetch compliance item
  const [item] = await db.select({ id: compliance.id, assignee_id: compliance.assignee_id, title: compliance.title, unique_url_slug: compliance.unique_url_slug })
    .from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!item) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compliance item not found" } }, { status: 404 });

  // Validate new assignee exists in the same org
  const [assignee] = await db.select({ id: usersTable.id, full_name: usersTable.full_name })
    .from(usersTable).where(and(eq(usersTable.id, assignee_id), eq(usersTable.org_id, ctx.orgId))).limit(1);
  if (!assignee) {
    return NextResponse.json({ success: false, error: { code: "INVALID_ASSIGNEE", message: "Assignee not found or not in the same organisation" } }, { status: 422 });
  }

  const previousAssigneeId = item.assignee_id;

  // Update
  await db.update(compliance).set({ assignee_id, updated_at: new Date() }).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));

  // Audit log
  await logAuditEvent({
    action: "compliance.reassigned", userId: ctx.userId, orgId: ctx.orgId, req, entityId: id,
    meta: { previous_assignee_id: previousAssigneeId, new_assignee_id: assignee_id, reason: reason ?? null },
  });

  // Notify new assignee
  await db.insert(notifications).values({
    org_id: ctx.orgId,
    user_id: assignee_id,
    type: "reassigned",
    title: "Compliance item reassigned to you",
    body: `"${item.title}" has been reassigned to you${reason ? ` — ${reason}` : ""}.`,
    link_url: `/compliance/${item.unique_url_slug}`,
  });

  // Notify previous assignee if different
  if (previousAssigneeId && previousAssigneeId !== assignee_id) {
    await db.insert(notifications).values({
      org_id: ctx.orgId,
      user_id: previousAssigneeId,
      type: "reassigned",
      title: "Compliance item unassigned from you",
      body: `"${item.title}" has been reassigned from you to ${assignee.full_name}.`,
      link_url: `/compliance/${item.unique_url_slug}`,
    });
  }

  return NextResponse.json({ success: true });
}, { roles: ["account_admin", "client_department_admin"] });