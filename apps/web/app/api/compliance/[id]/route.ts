import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance } from "@compliance/db/schema";
import { and, eq } from "drizzle-orm";
import { UpdateComplianceSchema } from "@compliancetrack/types";
import { logAuditEvent } from "@/lib/auth/audit-logger";

function getId(req: NextRequest) { return req.nextUrl.pathname.split("/").at(-2)!; }

// ─── GET /api/compliance/[id] ─────────────────────────────────────────
export const GET = withAuth(async (req, ctx) => {
  const id = getId(req);
  const [item] = await db.select().from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!item) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compliance item not found" } }, { status: 404 });
  return NextResponse.json({ success: true, data: item });
});

// ─── PUT /api/compliance/[id] ─────────────────────────────────────────
export const PUT = withAuth(async (req, ctx) => {
  const id = getId(req);
  const body = await req.json();
  const parsed = UpdateComplianceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  // Verify item exists
  const [existing] = await db.select().from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!existing) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compliance item not found" } }, { status: 404 });

  // Build update object — only include defined fields
  const updateData: Record<string, unknown> = { updated_at: new Date() };
  const raw = parsed.data as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) {
      if (k === "due_date" && v) updateData[k] = new Date(v as string);
      else if (v !== null) updateData[k] = v;
    }
  }

  if (Object.keys(updateData).length <= 1) {
    return NextResponse.json({ success: false, error: { code: "NO_CHANGES", message: "No valid fields to update" } }, { status: 400 });
  }

  await db.update(compliance).set(updateData).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));
  await logAuditEvent({ action: "compliance.updated", userId: ctx.userId, orgId: ctx.orgId, req, entityId: id, meta: { changes: updateData } });

  const [updated] = await db.select().from(compliance).where(eq(compliance.id, id)).limit(1);
  return NextResponse.json({ success: true, data: updated });
}, { roles: ["account_admin", "client_department_admin", "editor"] });

// ─── DELETE /api/compliance/[id] ──────────────────────────────────────
// Soft delete (default): reset to draft, clear assignee.
// Hard delete: only account_admin, via ?hard=true query param.
export const DELETE = withAuth(async (req, ctx) => {
  const id = getId(req);
  const [existing] = await db.select().from(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId))).limit(1);
  if (!existing) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Compliance item not found" } }, { status: 404 });

  const hardDelete = req.nextUrl.searchParams.get("hard") === "true";

  if (hardDelete) {
    if (ctx.role !== "account_admin") {
      return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Hard delete requires account_admin role" } }, { status: 403 });
    }
    await db.delete(compliance).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));
    await logAuditEvent({ action: "compliance.deleted", userId: ctx.userId, orgId: ctx.orgId, req, entityId: id, meta: { mode: "hard" } });
    return NextResponse.json({ success: true, data: { deleted: true, id, mode: "hard" } });
  }

  // Soft delete
  await db.update(compliance).set({ status: "draft", assignee_id: null, updated_at: new Date() }).where(and(eq(compliance.id, id), eq(compliance.org_id, ctx.orgId)));
  await logAuditEvent({ action: "compliance.deleted", userId: ctx.userId, orgId: ctx.orgId, req, entityId: id, meta: { mode: "soft", previous_status: existing.status } });
  return NextResponse.json({ success: true, data: { deleted: true, id, mode: "soft" } });
});