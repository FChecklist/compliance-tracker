import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliance/db";
import { auditPoints } from "@compliance/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  evidence_required: z.boolean().default(false),
});

const updateSchema = createSchema.partial();

// GET /api/compliance/[id]/audit-points
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select().from(auditPoints).where(eq(auditPoints.compliance_id, id)).orderBy(auditPoints.created_at);
  return NextResponse.json({ audit_points: rows });
}

// POST /api/compliance/[id]/audit-points
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = createSchema.parse(await req.json());
  const [created] = await db.insert(auditPoints).values({
    ...body,
    compliance_id: id,
    due_date: body.due_date ? new Date(body.due_date) : null,
  }).returning();
  return NextResponse.json({ audit_point: created }, { status: 201 });
}