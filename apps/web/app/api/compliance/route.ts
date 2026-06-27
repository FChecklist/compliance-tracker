import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance, departments, users } from "@compliance/db/schema";
import { and, eq, ilike, desc, asc, sql, or, gte, lte } from "drizzle-orm";
import { CreateComplianceSchema, ComplianceFiltersSchema } from "@compliance/types";
import { logAuditEvent } from "@/lib/auth/audit-logger";

// ─── GET: List compliance items with filters, search, pagination ───
export const GET = withAuth(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const filters = ComplianceFiltersSchema.parse({
    status: sp.get("status") || undefined,
    priority: sp.get("priority") || undefined,
    compliance_type: sp.get("compliance_type") || undefined,
    department_id: sp.get("department_id") || undefined,
    assignee_id: sp.get("assignee_id") || undefined,
    search: sp.get("search") || undefined,
    due_before: sp.get("due_before") || undefined,
    due_after: sp.get("due_after") || undefined,
    page: Number(sp.get("page") || 1),
    per_page: Number(sp.get("per_page") || 25),
    sort_by: sp.get("sort_by") || "due_date",
    sort_order: sp.get("sort_order") || "asc",
  });

  const where = [eq(compliance.org_id, ctx.orgId)];

  if (filters.status) where.push(eq(compliance.status, filters.status));
  if (filters.priority) where.push(eq(compliance.priority, filters.priority));
  if (filters.compliance_type) where.push(eq(compliance.compliance_type, filters.compliance_type));
  if (filters.department_id) where.push(eq(compliance.department_id, filters.department_id));
  if (filters.assignee_id) where.push(eq(compliance.assignee_id, filters.assignee_id));
  if (filters.due_before) where.push(lte(compliance.due_date, new Date(filters.due_before)));
  if (filters.due_after) where.push(gte(compliance.due_date, new Date(filters.due_after)));
  if (filters.search) {
    where.push(or(
      ilike(compliance.title, `%${filters.search}%`),
      ilike(compliance.description, `%${filters.search}%`),
    )!);
  }

  const orderBy = filters.sort_order === "desc"
    ? desc(compliance[filters.sort_by as keyof typeof compliance.$columns] as any)
    : asc(compliance[filters.sort_by as keyof typeof compliance.$columns] as any);

  const offset = (filters.page - 1) * filters.per_page;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: compliance.id,
        title: compliance.title,
        description: compliance.description,
        compliance_type: compliance.compliance_type,
        status: compliance.status,
        priority: compliance.priority,
        due_date: compliance.due_date,
        unique_url_slug: compliance.unique_url_slug,
        assignee_id: compliance.assignee_id,
        department_id: compliance.department_id,
        created_at: compliance.created_at,
        updated_at: compliance.updated_at,
        assignee_name: users.full_name,
        department_name: departments.name,
      })
      .from(compliance)
      .leftJoin(users, eq(compliance.assignee_id, users.id))
      .leftJoin(departments, eq(compliance.department_id, departments.id))
      .where(and(...where))
      .orderBy(orderBy)
      .limit(filters.per_page)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(compliance)
      .where(and(...where)),
  ]);

  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({
    compliance: rows,
    pagination: {
      page: filters.page,
      per_page: filters.per_page,
      total,
      total_pages: Math.ceil(total / filters.per_page),
    },
  });
});

// ─── POST: Create a new compliance item ───
export const POST = withAuth(async (req, ctx) => {
  const body = CreateComplianceSchema.parse(await req.json());

  // Generate a unique URL slug from title
  const slug = body.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200)
    + "-" + Date.now().toString(36);

  const [created] = await db
    .insert(compliance)
    .values({
      ...body,
      org_id: ctx.orgId,
      status: "draft",
      unique_url_slug: slug,
      due_date: body.due_date ? new Date(body.due_date) : null,
    })
    .returning();

  await logAuditEvent({
    action: "compliance.created",
    userId: ctx.userId,
    orgId: ctx.orgId,
    req,
    meta: { compliance_id: created.id, title: created.title },
  });

  return NextResponse.json({ compliance: created }, { status: 201 });
}, { roles: ["account_admin", "client_department_admin", "editor"] });