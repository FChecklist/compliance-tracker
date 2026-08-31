import { webhooks, webhookDeliveries } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { redeliverWebhookDelivery } from "@/lib/webhook-deliver";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";

// Gap-closure (API Governance: Webhook Reliability, 2026-07-18): automatic
// delivery is capped at 3 attempts (webhook-deliver.ts's deliverWebhook) --
// intentionally left as-is here. What was missing was any recovery path for
// a delivery that failed all 3: this endpoint lets a user manually replay a
// specific past delivery (identified by webhookDeliveries.id, e.g. the row
// the "Redeliver" button in WebhookSection.tsx was clicked on) against the
// webhook's *current* URL/secret, using the payload already stored on that
// row -- no re-fetch of the original trigger data needed.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, orgId } = await requireAuth();
  if (response) return response;
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 });

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId : null;
    if (!deliveryId) {
      return NextResponse.json({ error: "deliveryId is required" }, { status: 400 });
    }

    const result = await withTenantContext({ orgId }, async (db) => {
      // Confirm the webhook belongs to this org (RLS-scoped) before doing
      // anything else -- same pattern as PATCH/DELETE in ../route.ts.
      const webhook = await db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
      if (!webhook) return { error: "Webhook not found", status: 404 as const };

      // webhook_deliveries has no org_id column of its own; scope it via
      // the webhookId we just confirmed belongs to this org, not just the
      // raw deliveryId (an id from another org's delivery log must 404
      // here, not be replayed against this org's webhook).
      const original = await db.query.webhookDeliveries.findFirst({
        where: and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, id)),
      });
      if (!original) return { error: "Delivery not found", status: 404 as const };

      const delivery = await redeliverWebhookDelivery(webhook, original);
      return { delivery };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      id: result.delivery.id,
      eventType: result.delivery.eventType,
      statusCode: result.delivery.statusCode,
      success: result.delivery.success,
      attempt: result.delivery.attempt,
      redeliveryOfId: result.delivery.redeliveryOfId,
      createdAt: result.delivery.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Webhook redeliver error:", error);
    return NextResponse.json({ error: "Failed to redeliver webhook" }, { status: 500 });
  }
}
