import { db, complianceItems, departments, users, auditLogs } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { addMonths } from "date-fns";

const RECURRENCE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annually: 12,
};

export async function POST(request: NextRequest) {
  const { response } = await requireAuth();
  if (response) return response;

  try {
    const { complianceItemId } = await request.json();
    if (!complianceItemId) {
      return NextResponse.json({ error: "complianceItemId is required" }, { status: 400 });
    }

    const parent = await db.query.complianceItems.findFirst({
      where: eq(complianceItems.id, complianceItemId),
    });

    if (!parent) {
      return NextResponse.json({ error: "Compliance item not found" }, { status: 404 });
    }

    if (parent.recurrenceType === "none" || !parent.recurrenceType) {
      return NextResponse.json({ message: "Item is not recurring" }, { status: 200 });
    }

    const monthsToAdd = RECURRENCE_MONTHS[parent.recurrenceType];
    if (!monthsToAdd) {
      return NextResponse.json({ error: "Invalid recurrence type" }, { status: 400 });
    }

    const newDueDate = addMonths(parent.dueDate, monthsToAdd);

    let newPeriod = parent.period;
    if (parent.period) {
      const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
      const match = parent.period.match(/(\w+)\s*(\d{4})/);
      if (match) {
        const oldMonth = monthNames.indexOf(match[1]);
        if (oldMonth >= 0) {
          const newMonthIdx = (oldMonth + monthsToAdd) % 12;
          const yearAdd = Math.floor((oldMonth + monthsToAdd) / 12);
          const newYear = parseInt(match[2]) + yearAdd;
          newPeriod = `${monthNames[newMonthIdx]} ${newYear}`;
        }
      }
    }

    let newTitle = parent.title;
    if (parent.period && newPeriod && parent.title.includes(parent.period)) {
      newTitle = parent.title.replace(parent.period, newPeriod);
    } else {
      newTitle = `${parent.title} (Next)`;
    }

    const adminUser = await db.query.users.findFirst({ where: eq(users.role, "admin") });

    const [newItem] = await db.insert(complianceItems).values({
      title: newTitle,
      description: parent.description,
      complianceType: parent.complianceType,
      priority: parent.priority,
      dueDate: newDueDate,
      departmentId: parent.departmentId,
      assignedToId: parent.assignedToId,
      orgId: parent.orgId,
      period: newPeriod,
      financialYear: parent.financialYear,
      registrationNumber: parent.registrationNumber,
      amount: parent.amount,
      recurrenceType: parent.recurrenceType,
      recurrenceParentId: parent.id,
      isTemplateSuggested: false,
    }).returning();

    if (adminUser) {
      await db.insert(auditLogs).values({
        action: "create",
        entityType: "ComplianceItem",
        entityId: newItem.id,
        userId: adminUser.id,
        details: `Auto-generated recurring compliance: ${newItem.title} (parent: ${parent.id})`,
      });
    }

    try {
      const { deliverWebhook } = await import("@/lib/webhook-deliver");
      await deliverWebhook(parent.orgId, "item.created", {
        itemId: newItem.id,
        title: newItem.title,
        recurrenceParentId: parent.id,
        complianceType: newItem.complianceType,
        dueDate: newItem.dueDate.toISOString(),
      });
    } catch { /* best-effort */ }

    return NextResponse.json({
      id: newItem.id,
      title: newItem.title,
      dueDate: newItem.dueDate.toISOString(),
      period: newItem.period,
      message: "Next recurring instance created",
    }, { status: 201 });
  } catch (error) {
    console.error("Recurrence API error:", error);
    return NextResponse.json({ error: "Failed to create recurring item" }, { status: 500 });
  }
}