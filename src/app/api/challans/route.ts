import { db, challans, auditLogs, users } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET(request: NextRequest) {
  const { response } = await requireAuth();
  if (response) return response;
  try {
    const { searchParams } = request.nextUrl;
    const complianceItemId = searchParams.get("complianceItemId") || "";

    const conditions = [];
    if (complianceItemId) {
      conditions.push(eq(challans.complianceItemId, complianceItemId));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db.query.challans.findMany({
      where: where as Parameters<typeof db.query.challans.findMany>[0]["where"],
      orderBy: desc(challans.createdAt),
    });

    return NextResponse.json({
      challans: items.map((c) => ({
        id: c.id,
        complianceItemId: c.complianceItemId,
        bsrCode: c.bsrCode,
        challanSerialNumber: c.challanSerialNumber,
        paymentDate: c.paymentDate?.toISOString() ?? null,
        amount: c.amount,
        bankName: c.bankName,
        description: c.description,
        createdById: c.createdById,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Challans list API error:", error);
    return NextResponse.json({ error: "Failed to fetch challans" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { response, user } = await requireAuth();
  if (response) return response;
  try {
    const body = await request.json();
    const {
      complianceItemId,
      bsrCode,
      challanSerialNumber,
      paymentDate,
      amount,
      bankName,
      description,
    } = body;

    if (!complianceItemId || typeof complianceItemId !== "string") {
      return NextResponse.json({ error: "complianceItemId is required" }, { status: 400 });
    }
    if (!amount || typeof Number(amount) !== "number" || Number(amount) <= 0) {
      return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });
    }

    // Look up the org from the compliance item
    const complianceItem = await db.query.complianceItems.findFirst({
      where: eq(db.schema.complianceItems.id, complianceItemId),
    });
    if (!complianceItem) {
      return NextResponse.json({ error: "Compliance item not found" }, { status: 404 });
    }

    // Find the user record
    const userRecord = await db.query.users.findFirst({
      where: eq(users.email, user!.email!),
    });

    const [challan] = await db.insert(challans).values({
      complianceItemId,
      bsrCode: bsrCode?.trim() || null,
      challanSerialNumber: challanSerialNumber?.trim() || null,
      paymentDate: paymentDate ? new Date(paymentDate) : null,
      amount: String(amount),
      bankName: bankName?.trim() || null,
      description: description?.trim() || null,
      orgId: complianceItem.orgId,
      createdById: userRecord?.id || user!.id,
    }).returning();

    await db.insert(auditLogs).values({
      action: "create",
      entityType: "Challan",
      entityId: challan.id,
      userId: userRecord?.id || user!.id,
      details: `Recorded challan payment ₹${amount} for compliance item ${complianceItemId}`,
    });

    return NextResponse.json(
      {
        id: challan.id,
        complianceItemId: challan.complianceItemId,
        bsrCode: challan.bsrCode,
        challanSerialNumber: challan.challanSerialNumber,
        paymentDate: challan.paymentDate?.toISOString() ?? null,
        amount: challan.amount,
        bankName: challan.bankName,
        description: challan.description,
        createdAt: challan.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Challan create API error:", error);
    return NextResponse.json({ error: "Failed to create challan" }, { status: 500 });
  }
}