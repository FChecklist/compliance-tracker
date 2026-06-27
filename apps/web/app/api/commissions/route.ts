import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { commissions, salesAgents } from "@compliancetrack/db";
import { eq, and, desc } from "drizzle-orm";

// GET /api/commissions — list commissions for the org (admin only)
// Supports ?agent_id=xxx filter
export const GET = withAuth(async (req, ctx) => {
  const agentId = req.nextUrl.searchParams.get("agent_id");

  const conditions = [eq(salesAgents.org_id, ctx.orgId)];
  if (agentId) {
    conditions.push(eq(salesAgents.id, agentId));
  }

  const rows = await db
    .select({
      id: commissions.id,
      agent_id: commissions.agent_id,
      agent_name: salesAgents.name,
      order_id: commissions.order_id,
      amount: commissions.amount,
      status: commissions.status,
      created_at: commissions.created_at,
    })
    .from(commissions)
    .innerJoin(salesAgents, eq(commissions.agent_id, salesAgents.id))
    .where(and(...conditions))
    .orderBy(desc(commissions.created_at));

  return NextResponse.json({ success: true, data: { commissions: rows } });
}, { roles: ["account_admin"] });