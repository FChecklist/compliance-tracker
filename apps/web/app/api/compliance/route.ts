import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance, complianceHistory, departments, users } from "@compliance/db/schema";
import { and, eq, ilike, or, asc, desc, sql, inArray, lte, gte, count, SQL } from "drizzle-orm";
import { ComplianceFiltersSchema, CreateComplianceSchema, StatusTransitions } from "@compliancetrack/types";
import { logAuditEvent } from "@/lib/auth/audit-logger";

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base}-${Date.now().toString(36)}`.slice(0, 255);
}

// ─── GET /api/compliance ───────────────────────────────────────────────
// List with filters, search, pagination, sorting.
export const GET = withAuth(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const filters = ComplianceFiltersSchema.safeParse({
    status: sp.get("status") || undefined,
    priority: sp.get("priority") || undefined,
    compliance_type: sp.get("compliance_type") || undefined,
    department_id: sp.get("department_id") || undefined,
    assignee_id: sp.get("assignee_id") || undefined,
    search: sp.get("search") || undefined,
    due_before: sp.get("due_before") || undefined,
    due_after: sp.get("due_after") || undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    per_page: sp.get("per_page") ? Number(sp.get("per_page")) : 25,
    sort_by: sp.get("sort_by") || "due_date",
    sort_order: sp.get("sort_order") || "asc",
  });

  if (!filters.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: filters.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const { page, per_page, sort_by, sort_order, search, ...rest } = filters.data;
  const offset = (page - 1) * per_page;

  // Build WHERE conditions
  const conditions: SQL[] = [eq(compliance.org_id, ctx.orgId)];
  if (rest.status) conditions.push(eq(compliance.status, rest.status));
  if (rest.priority) conditions.push(eq(compliance.priority, rest.priority));
  if (rest.compliance_type) conditions.push(eq(compliance.compliance_type, rest.compliance_type));
  if (rest.department_id) conditions.push(eq(compliance.department_id, rest.department_id));
  if (rest.assignee_id) conditions.push(eq(compliance.assignee_id, rest.assignee_id));
  if (rest.due_before) conditions.push(lte(compliance.due_date, new Date(rest.due_before)));
  if (rest.due_after) conditions.push(gte(compliance.due_date, new Date(rest.due_after)));
  if (search) {
    conditions.push(or(ilike(compliance.title, `%${search}%`), ilike(compliance.description, `%${search}%`))!);
  }

  const whereClause = and(...conditions);

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(compliance)
    .where(whereClause);

  // Order column mapping
  const orderCol: Record<string, typeof compliance.due_date> = {
    due_date: compliance.due_date,
    priority: compliance.priority,
    status: compliance.status,
    created_at: compliance.created_at,
    title: compliance.title,
  };
  const orderFn = sort_order === "desc" ? desc : asc;

  // Fetch page
  const rows = await db
    .select()
    .from(compliance)
    .where(whereClause)
    .orderBy(orderFn(orderCol[sort_by] ?? compliance.due_date))
    .limit(per_page)
    .offset(offset);

  const total_pages = Math.ceil(total / per_page);

  return NextResponse.json({
    success: true,
    data: rows,
    pagination: { page, per_page, total, total_pages, has_next: page < total_pages, has_prev: page > 1 },
  });
});

// ─── POST /api/compliance ──────────────────────────────────────────────
// Create with auto-slug, default status "draft", audit log.
export const POST = withAuth(async (req, ctx) => {
  const body = await req.json();
  const parsed = CreateComplianceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const slug = slugify(parsed.data.title);

  const [inserted] = await db
    .insert(compliance)
    .values({
      ...parsed.data,
      org_id: ctx.orgId,
      status: "draft",
      unique_url_slug: slug,
      due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null,
    })
    .returning();

  await logAuditEvent({ action: "compliance.created", userId: ctx.userId, orgId: ctx.orgId, req, entityId: inserted.id, meta: { title: inserted.title, slug: inserted.unique_url_slug } });

  return NextResponse.json({ success: true, data: inserted }, { status: 201 });
}, { roles: ["account_admin", "client_department_admin", "editor"] });