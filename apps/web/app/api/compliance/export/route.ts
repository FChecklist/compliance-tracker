import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance, departments, users } from "@compliance/db/schema";
import { and, eq, ilike, or, asc, desc, lte, gte, inArray, SQL } from "drizzle-orm";
import { ComplianceFiltersSchema } from "@compliancetrack/types";

// ─── GET /api/compliance/export ──────────────────────────────────────
// CSV export with the same filters as the list endpoint.
// Headers: id, title, type, status, priority, assignee, due_date, department
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
    page: 1,
    per_page: 10000,
    sort_by: sp.get("sort_by") || "due_date",
    sort_order: sp.get("sort_order") || "asc",
  });

  if (!filters.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: filters.error.issues.map((i) => i.message).join(", ") } }, { status: 422 });
  }

  const { sort_by, sort_order, search, page: _p, per_page: _pp, ...rest } = filters.data;

  // Build WHERE
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
  const orderCol: Record<string, typeof compliance.due_date> = {
    due_date: compliance.due_date,
    priority: compliance.priority,
    status: compliance.status,
    created_at: compliance.created_at,
    title: compliance.title,
  };
  const orderFn = sort_order === "desc" ? desc : asc;

  // Query with join for readable names
  const rows = await db
    .select({
      id: compliance.id,
      title: compliance.title,
      compliance_type: compliance.compliance_type,
      status: compliance.status,
      priority: compliance.priority,
      due_date: compliance.due_date,
      assignee_id: compliance.assignee_id,
      department_id: compliance.department_id,
    })
    .from(compliance)
    .where(whereClause)
    .orderBy(orderFn(orderCol[sort_by] ?? compliance.due_date))
    .limit(10000);

  // Batch fetch department and user names
  const deptIds = [...new Set(rows.map((r) => r.department_id).filter(Boolean))] as string[];
  const userIds = [...new Set(rows.map((r) => r.assignee_id).filter(Boolean))] as string[];

  const [deptMap, userMap] = await Promise.all([
    deptIds.length > 0
      ? db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds)).then((rows) => new Map(rows.map((r) => [r.id, r.name])))
      : Promise.resolve(new Map<string, string>()),
    userIds.length > 0
      ? db.select({ id: users.id, full_name: users.full_name }).from(users).where(inArray(users.id, userIds)).then((rows) => new Map(rows.map((r) => [r.id, r.full_name])))
      : Promise.resolve(new Map<string, string>()),
  ]);

  // Generate CSV
  const csvHeaders = ["id", "title", "type", "status", "priority", "assignee", "due_date", "department"];

  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = rows.map((r) => [
    escapeCsv(r.id),
    escapeCsv(r.title),
    escapeCsv(r.compliance_type),
    escapeCsv(r.status),
    escapeCsv(r.priority),
    escapeCsv(userMap.get(r.assignee_id ?? "") ?? ""),
    escapeCsv(r.due_date ? r.due_date.toISOString().split("T")[0] : ""),
    escapeCsv(deptMap.get(r.department_id ?? "") ?? ""),
  ].join(","));

  const csv = [csvHeaders.join(","), ...csvRows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="compliance-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
});

