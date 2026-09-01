import { webhooks, webhookDeliveries } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard";

const VALID_EVENTS = [
  "item.created",
  "item.completed",
  "item.overdue",
  "notice.received",
  "challan.recorded",
  // Wave 58: ERP domain events (see WebhookSection.tsx's WEBHOOK_EVENTS list)
  "erp_journal_entry.submitted",
  "erp_cash_voucher.posted",
  "erp_payslip.finalized",
  "erp_purchase_requisition.approved",
  "erp_sales_invoice.submitted",
  "erp_purchase_invoice.submitted",
];

function generateSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 40; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `whsec_${result}`;
}

// R66 gap-closure (code-quality inspection 2026-09-01, critical finding):
// neither handler in this file previously called requireRole, so any
// authenticated org member -- not just admin -- could read every webhook's
// signing secret and register new webhooks pointed at an arbitrary HTTPS
// URL, exfiltrating internal ERP/CRM events. Both handlers now gate on
// requireRole(dbUser, "admin"), matching every sibling settings/* route
// (branding, sso). GET also switched its per-webhook deliveries lookup from
// an N+1 loop to a single batched query.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
  if (!orgId) return NextResponse.json({ webhooks: [] });

  try {
    const results = await withTenantContext({ orgId }, async (db) => {
      const items = await db.query.webhooks.findMany({
        orderBy: desc(webhooks.createdAt),
      });

      // Batch-fetch the last 5 deliveries per webhook in one query instead
      // of one query per webhook (R66 gap-closure: was an N+1 pattern).
      const webhookIds = items.map((w) => w.id);
      const allDeliveries = webhookIds.length
        ? await db.query.webhookDeliveries.findMany({
            where: inArray(webhookDeliveries.webhookId, webhookIds),
            orderBy: desc(webhookDeliveries.createdAt),
          })
        : [];
      const deliveriesByWebhookId = new Map<string, typeof allDeliveries>();
      for (const d of allDeliveries) {
        const list = deliveriesByWebhookId.get(d.webhookId) ?? [];
        if (list.length < 5) list.push(d);
        deliveriesByWebhookId.set(d.webhookId, list);
      }

      return items.map((w) => {
        const deliveries = deliveriesByWebhookId.get(w.id) ?? [];
        return {
          id: w.id,
          name: w.name,
          url: w.url,
          secret: w.secret,
          events: w.events,
          isActive: w.isActive,
          lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
          lastStatusCode: w.lastStatusCode,
          createdAt: w.createdAt.toISOString(),
          recentDeliveries: deliveries.map((d) => ({
            id: d.id,
            eventType: d.eventType,
            statusCode: d.statusCode,
            success: d.success,
            attempt: d.attempt,
            redeliveryOfId: d.redeliveryOfId,
            createdAt: d.createdAt.toISOString(),
          })),
        };
      });
    });

    return NextResponse.json({ webhooks: results });
  } catch (error) {
    console.error("Webhooks list error:", error);
    return NextResponse.json({ error: "Failed to fetch webhooks" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  const roleErr = requireRole(dbUser, "admin");
  if (roleErr) return roleErr;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const body = await request.json();
    const { name, url, events } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!url || typeof url !== "string" || !url.trim().startsWith("https://")) {
      return NextResponse.json({ error: "Valid HTTPS URL is required" }, { status: 400 });
    }
    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: "At least one event type is required" }, { status: 400 });
    }
    const validEvents = events.filter((e: string) => VALID_EVENTS.includes(e));
    if (validEvents.length === 0) {
      return NextResponse.json({ error: "No valid event types selected" }, { status: 400 });
    }

    const secret = generateSecret();

    const created = await withTenantContext({ orgId }, (db) =>
      db.insert(webhooks).values({
        name: name.trim(),
        url: url.trim(),
        secret,
        events: validEvents.join(","),
        isActive: true,
        orgId,
      }).returning()
    );

    return NextResponse.json(
      {
        id: created[0].id,
        name: created[0].name,
        url: created[0].url,
        secret: created[0].secret,
        events: created[0].events,
        isActive: created[0].isActive,
        createdAt: created[0].createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Webhook create error:", error);
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 });
  }
}
