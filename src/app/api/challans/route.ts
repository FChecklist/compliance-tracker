import { challans, auditLogs, complianceItems } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ challans: [] });

  try {
    const { searchParams } = request.nextUrl;
    const complianceItemId = searchParams.get("complianceItemId") || "";

    const conditions = [eq(challans.orgId, orgId)];
    if (complianceItemId) {
      conditions.push(eq(challans.complianceItemId, complianceItemId));
    }
    const where = and(...conditions);

    const items = await withTenantContext({ orgId }, (db) =>
      db.query.challans.findMany({
        where,
        orderBy: desc(challans.createdAt),
      })
    );

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
  const { response, orgId, dbUser } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

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

    const result = await withTenantContext({ orgId }, async (db) => {
      // RLS-scoped -- returns null if this compliance item belongs to
      // another org, rather than deriving orgId from whatever item is found.
      const complianceItem = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, complianceItemId),
      });
      if (!complianceItem) return { error: "Compliance item not found", status: 404 as const };

      const [challan] = await db.insert(challans).values({
        complianceItemId,
        bsrCode: bsrCode?.trim() || null,
        challanSerialNumber: challanSerialNumber?.trim() || null,
        paymentDate: paymentDate ? new Date(paymentDate) : null,
        amount: String(amount),
        bankName: bankName?.trim() || null,
        description: description?.trim() || null,
        orgId,
        createdById: dbUser.id,
      }).returning();

      await db.insert(auditLogs).values({
        action: "create",
        entityType: "Challan",
        entityId: challan.id,
        userId: dbUser.id,
        details: `Recorded challan payment ₹${amount} for compliance item ${complianceItemId}`,
      });

      return { challan };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    const { challan } = result;

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
