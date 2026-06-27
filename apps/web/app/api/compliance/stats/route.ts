import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliance/db";
import { compliance } from "@compliance/db/schema";
import { eq, and, lte, sql, gte } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const orgFilter = eq(compliance.org_id, ctx.orgId);

  // Fetch all compliance rows for this org to compute stats in-memory
  // (for a large dataset, aggregate in SQL — this is fine for <10K rows)
  const rows = await db
    .select({ status: compliance.status, due_date: compliance.due_date })
    .from(compliance)
    .where(orgFilter);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const total = rows.length;
  const byStatus: Record<string, number> = {};
  let dueTodayCount = 0;
  let overdueCount = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.due_date) {
      const due = new Date(row.due_date);
      if (due >= todayStart && due <= todayEnd && row.status !== "completed") dueTodayCount++;
      if (due < todayStart && row.status !== "completed") overdueCount++;
    }
  }

  return NextResponse.json({
    stats: {
      total,
      completed: byStatus["completed"] ?? 0,
      in_progress: byStatus["in_progress"] ?? 0,
      pending: byStatus["pending"] ?? 0,
      draft: byStatus["draft"] ?? 0,
      overdue: overdueCount || (byStatus["overdue"] ?? 0),
      due_today: dueTodayCount,
    },
  });
});
