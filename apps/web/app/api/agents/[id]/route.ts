import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { db } from "@compliancetrack/db";
import { salesAgents } from "@compliancetrack/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const updateAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
});

// GET /api/agents/[id] — single sales agent
export const GET = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const [agent] = await db
    .select()
    .from(salesAgents)
    .where(and(eq(salesAgents.id, id), eq(salesAgents.org_id, ctx.orgId)));

  if (!agent) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Agent not found" } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: agent });
}, { roles: ["account_admin"] });

// PUT /api/agents/[id] — update agent fields
export const PUT = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const data = updateAgentSchema.parse(await req.json());

  const set: Record<string, unknown> = { updated_at: new Date() };
  if (data.name !== undefined) set.name = data.name;
  if (data.email !== undefined) set.email = data.email;
  if (data.phone !== undefined) set.phone = data.phone;
  if (data.commission_rate !== undefined) set.commission_rate = data.commission_rate.toString();
  if (data.is_active !== undefined) set.is_active = data.is_active;

  await db
    .update(salesAgents)
    .set(set)
    .where(and(eq(salesAgents.id, id), eq(salesAgents.org_id, ctx.orgId)));

  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });

// DELETE /api/agents/[id] — soft-delete (set is_active = false)
export const DELETE = withAuth(async (req, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  await db
    .update(salesAgents)
    .set({ is_active: false, updated_at: new Date() })
    .where(and(eq(salesAgents.id, id), eq(salesAgents.org_id, ctx.orgId)));

  return NextResponse.json({ success: true });
}, { roles: ["account_admin"] });