import { complianceItems } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { logActivity } from "@/lib/audit";
import { addMonths } from "date-fns";

const RECURRENCE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annually: 12,
};

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth();
  if (response) return response;
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  try {
    const { complianceItemId } = await request.json();
    if (!complianceItemId) {
      return NextResponse.json({ error: "complianceItemId is required" }, { status: 400 });
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      // RLS-scoped -- returns null if the item belongs to another org, not
      // just if it doesn't exist (previously any org's item id could be used
      // here, and the new recurring item would inherit THAT org's orgId).
      const parent = await db.query.complianceItems.findFirst({
        where: eq(complianceItems.id, complianceItemId),
      });
      if (!parent) return { error: "Compliance item not found", status: 404 as const };

      if (parent.recurrenceType === "none" || !parent.recurrenceType) {
        return { message: "Item is not recurring" };
      }

      const monthsToAdd = RECURRENCE_MONTHS[parent.recurrenceType];
      if (!monthsToAdd) return { error: "Invalid recurrence type", status: 400 as const };

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

      const [newItem] = await db.insert(complianceItems).values({
        title: newTitle,
        description: parent.description,
        complianceType: parent.complianceType,
        priority: parent.priority,
        dueDate: newDueDate,
        departmentId: parent.departmentId,
        assignedToId: parent.assignedToId,
        orgId,
        clientId: parent.clientId,
        period: newPeriod,
        financialYear: parent.financialYear,
        registrationNumber: parent.registrationNumber,
        amount: parent.amount,
        recurrenceType: parent.recurrenceType,
        recurrenceParentId: parent.id,
        isTemplateSuggested: false,
      }).returning();

      await logActivity({
        tx: db,
        action: "create",
        entityType: "ComplianceItem",
        entityId: newItem.id,
        details: `Auto-generated recurring compliance: ${newItem.title} (parent: ${parent.id})`,
        orgId,
        clientId: newItem.clientId,
        dbUser,
        request,
      });

      try {
        const { deliverWebhook } = await import("@/lib/webhook-deliver");
        await deliverWebhook(orgId, "item.created", {
          itemId: newItem.id,
          title: newItem.title,
          recurrenceParentId: parent.id,
          complianceType: newItem.complianceType,
          dueDate: newItem.dueDate.toISOString(),
        });
      } catch { /* best-effort */ }

      return {
        id: newItem.id,
        title: newItem.title,
        dueDate: newItem.dueDate.toISOString(),
        period: newItem.period,
        message: "Next recurring instance created",
      };
    })

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    if ("message" in result && !("id" in result)) return NextResponse.json(result, { status: 200 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Recurrence API error:", error);
    return NextResponse.json({ error: "Failed to create recurring item" }, { status: 500 });
  }
}
