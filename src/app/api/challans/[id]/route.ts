import { db, challans, auditLogs, users } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;
    const challan = await db.query.challans.findFirst({
      where: eq(challans.id, id),
    });
    if (!challan) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: challan.id,
      complianceItemId: challan.complianceItemId,
      bsrCode: challan.bsrCode,
      challanSerialNumber: challan.challanSerialNumber,
      paymentDate: challan.paymentDate?.toISOString() ?? null,
      amount: challan.amount,
      bankName: challan.bankName,
      description: challan.description,
      createdById: challan.createdById,
      createdAt: challan.createdAt.toISOString(),
      updatedAt: challan.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Challan get API error:", error);
    return NextResponse.json({ error: "Failed to fetch challan" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;
    const existing = await db.query.challans.findFirst({ where: eq(challans.id, id) });
    if (!existing) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.bsrCode !== undefined) updates.bsrCode = body.bsrCode?.trim() || null;
    if (body.challanSerialNumber !== undefined) updates.challanSerialNumber = body.challanSerialNumber?.trim() || null;
    if (body.paymentDate !== undefined) updates.paymentDate = body.paymentDate ? new Date(body.paymentDate) : null;
    if (body.amount !== undefined) updates.amount = String(body.amount);
    if (body.bankName !== undefined) updates.bankName = body.bankName?.trim() || null;
    if (body.description !== undefined) updates.description = body.description?.trim() || null;

    const [updated] = await db
      .update(challans)
      .set(updates)
      .where(eq(challans.id, id))
      .returning();

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });

    await db.insert(auditLogs).values({
      action: "update",
      entityType: "Challan",
      entityId: id,
      userId: userRecord?.id || user!.id,
      details: `Updated challan ${id}`,
    });

    return NextResponse.json({
      id: updated.id,
      complianceItemId: updated.complianceItemId,
      bsrCode: updated.bsrCode,
      challanSerialNumber: updated.challanSerialNumber,
      paymentDate: updated.paymentDate?.toISOString() ?? null,
      amount: updated.amount,
      bankName: updated.bankName,
      description: updated.description,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Challan update API error:", error);
    return NextResponse.json({ error: "Failed to update challan" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const { id } = await params;
    const existing = await db.query.challans.findFirst({ where: eq(challans.id, id) });
    if (!existing) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }

    await db.delete(challans).where(eq(challans.id, id));

    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });

    await db.insert(auditLogs).values({
      action: "delete",
      entityType: "Challan",
      entityId: id,
      userId: userRecord?.id || user!.id,
      details: `Deleted challan ${id}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Challan delete API error:", error);
    return NextResponse.json({ error: "Failed to delete challan" }, { status: 500 });
  }
}