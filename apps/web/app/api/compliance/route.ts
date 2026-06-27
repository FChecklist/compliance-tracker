import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance } from "@compliancetrack/db/schema";
import { eq, and, ilike, lte, gte, asc, desc, sql, count } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/auth/audit-logger";

// ---------- GET: List compliance items with filters + pagination ----------
const listFilters = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  compliance_type: z.string().optional(),
  department_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  search: z.string().optional(),
  due_before: z.string().optional(),
  due_after: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  sort_by: z.enum(["due_date", "priority", "status", "created_at", "title"]).default("due_date"),
  sort_order: z.enum(["asc", "desc"]).default("asc"),
});

export const GET = withAuth(async (req, ctx) => {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const filters = listFilters.parse(params);

  const conditions = [eq(compliance.org_id, ctx.orgId)];

  if (filters.status) conditions.push(eq(compliance.status, filters.status));
  if (filters.priority) conditions.push(eq(compliance.priority, filters.priority));
  if (filters.compliance_type) conditions.push(eq(compliance.compliance_type, filters.compliance_type));
  if (filters.department_id) conditions.push(eq(compliance.department_id, filters.department_id));
  if (filters.assignee_id) conditions.push(eq(compliance.assignee_id, filters.assignee_id));
  if (filters.search) conditions.push(ilike(compliance.title, `%${filters.search}%`));
  if (filters.due_before) conditions.push(lte(compliance.due_date, new Date(filters.due_before)));
  if (filters.due_after) conditions.push(gte(compliance.due_date, new Date(filters.due_after)));

  const whereClause = and(...conditions);

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(compliance)
    .where(whereClause);

  // Sort
  const orderCol = {
    due_date: compliance.due_date,
    priority: compliance.priority,
    status: compliance.status,
    created_at: compliance.created_at,
    title: compliance.title,
  }[filters.sort_by];

  const orderFn = filters.sort_order === "asc" ? asc : desc;
  const offset = (filters.page - 1) * filters.per_page;

  const rows = await db
    .select()
    .from(compliance)
    .where(whereClause)
    .orderBy(orderCol(orderCol === compliance.due_date ? { nulls: "last" } : undefined))
    .limit(filters.per_page)
    .offset(offset);

  const total_pages = Math.ceil(total / filters.per_page);

  return NextResponse.json({
    success: true,
    data: rows,
    pagination: {
      page: filters.page,
      per_page: filters.per_page,
      total,
      total_pages,
      has_next: filters.page < total_pages,
      has_prev: filters.page > 1,
    },
  });
});

// ---------- POST: Create a new compliance item ----------
const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().default(""),
  compliance_type: z.string().default("other"),
  priority: z.string().default("medium"),
  department_id: z.string().uuid().optional().nullable(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).default({}),
});

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export const POST = withAuth(async (req, ctx) => {
  const data = createSchema.parse(await req.json());

  const slug = generateSlug(data.title);

  const [created] = await db
    .insert(compliance)
    .values({
      org_id: ctx.orgId,
      title: data.title,
      description: data.description,
      compliance_type: data.compliance_type,
      status: "draft",
      priority: data.priority,
      department_id: data.department_id ?? null,
      assignee_id: data.assignee_id ?? null,
      due_date: data.due_date ? new Date(data.due_date) : null,
      unique_url_slug: slug,
      metadata: data.metadata,
    })
    .returning();

  await logAuditEvent({
    action: "compliance.created",
    userId: ctx.userId,
    orgId: ctx.orgId,
    req,
    meta: { compliance_id: created.id, title: created.title },
  });

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}, { roles: ["account_admin", "client_department_admin", "editor"] });