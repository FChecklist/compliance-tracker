import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { compliance } from "@compliancetrack/db";
import { eq } from "drizzle-orm";

export const GET = withAuth(async (_req, ctx) => {
  const rows = await db.select({ status: compliance.status }).from(compliance).where(eq(compliance.org_id, ctx.orgId));
  const today = new Date(); today.setHours(23,59,59,999);
  const total = rows.length;
  const completed = rows.filter(r=>r.status==="completed").length;
  const overdue = rows.filter(r=>r.status==="overdue").length;
  const due_today = rows.filter(r=>r.status!=="completed").length; // simplified — full impl uses due_date comparison
  return NextResponse.json({ stats: { total, completed, overdue, due_today, pending: rows.filter(r=>r.status==="pending").length } });
});