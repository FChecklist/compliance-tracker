import { NextRequest, NextResponse } from "next/server";
import { db } from "@compliance/db";
import { auditPoints } from "@compliance/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  evidence_required: z.boolean().optional(),
});

// PUT /api/audit-points/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = updateSchema.parse(await req.json());
  const [updated] = await db.update(auditPoints).set({
    ...body,
    due_date: body.due_date ? new Date(body.due_date) : (body.due_date === null ? null : undefined),
    updated_at: new Date(),
  }).where(eq(auditPoints.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ audit_point: updated });
}

// DELETE /api/audit-points/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.delete(auditPoints).where(eq(auditPoints.id, id));
  return NextResponse.json({ success: true });
}