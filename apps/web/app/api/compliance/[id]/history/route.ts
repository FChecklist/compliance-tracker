import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliance/db";
import { complianceHistory, users } from "@compliance/db/schema";
import { eq, desc } from "drizzle-orm";

// GET /api/compliance/[id]/history
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select({
    id: complianceHistory.id, old_status: complianceHistory.old_status,
    new_status: complianceHistory.new_status, changed_by: complianceHistory.changed_by,
    change_reason: complianceHistory.change_reason, created_at: complianceHistory.created_at,
    changer_name: users.full_name,
  }).from(complianceHistory).leftJoin(users, eq(complianceHistory.changed_by, users.id))
    .where(eq(complianceHistory.compliance_id, id)).orderBy(desc(complianceHistory.created_at));
  return NextResponse.json({ history: rows });
}