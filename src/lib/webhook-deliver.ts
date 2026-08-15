import { db, webhooks, webhookDeliveries } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { runWebhookDeliveryOutcomeMonitor } from "@/lib/monitors/webhook-delivery-outcome-monitor";

type Webhook = typeof webhooks.$inferSelect;

function signBody(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Sends one HTTP attempt to a webhook's URL and returns the outcome. Shared
 * by the automatic retry loop (deliverWebhook) and the manual "Redeliver"
 * action (redeliverWebhookDelivery) so both attempts are signed, headered,
 * and recorded identically -- see webhook_deliveries.redelivery_of_id
 * (migration 0313) for how a manual replay is distinguished from an
 * automatic one.
 */
// Exported for unit testing (see webhook-deliver.test.ts) -- not part of the
// public API surface other modules should call directly; use deliverWebhook
// or redeliverWebhookDelivery instead.
export async function sendWebhookAttempt(
  webhook: Webhook,
  eventType: string,
  payload: Record<string, unknown>
): Promise<{ statusCode: number | null; response: string | null; success: boolean }> {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ event: eventType, timestamp, data: payload });
  const signature = signBody(webhook.secret, body);

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Veridian-Signature": `sha256=${signature}`,
        "X-Veridian-Event": eventType,
        "X-Veridian-Delivery": `${webhook.id}-${Date.now()}`,
      },
      body,
    });

    return {
      statusCode: response.status,
      response: await response.text().catch(() => null),
      success: response.status >= 200 && response.status < 300,
    };
  } catch (error) {
    return {
      statusCode: null,
      response: error instanceof Error ? error.message : "Unknown error",
      success: false,
    };
  }
}

export async function deliverWebhook(
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const activeWebhooks = await db.query.webhooks.findMany({
    where: and(
      eq(webhooks.orgId, orgId),
      eq(webhooks.isActive, true)
    ),
  });

  for (const webhook of activeWebhooks) {
    const events = webhook.events.split(",").map((e) => e.trim());
    if (!events.includes(eventType)) continue;

    // Retry cap is intentional (3 attempts, exponential backoff 1s/5s/25s).
    // A delivery that still fails after this is left as a terminal failed
    // row -- recoverable via the manual redeliverWebhookDelivery path below,
    // not by raising this cap.
    let delivered = false;
    let lastStatusCode: number | null = null;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= 3; attempt++) {
      attemptsMade = attempt;
      const outcome = await sendWebhookAttempt(webhook, eventType, payload);
      lastStatusCode = outcome.statusCode;

      await db.insert(webhookDeliveries).values({
        webhookId: webhook.id,
        eventType,
        payload,
        statusCode: outcome.statusCode,
        response: outcome.response,
        attempt,
        success: outcome.success,
      });

      if (outcome.success) {
        await db
          .update(webhooks)
          .set({ lastDeliveryAt: new Date(), lastStatusCode: outcome.statusCode })
          .where(eq(webhooks.id, webhook.id));
        delivered = true;
        break;
      }

      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.pow(5, attempt - 1) * 1000));
      }
    }

    // RES-02 Phase 1 (PLATFORM_STRATEGY.md 29.3): one outcome check per
    // webhook per event, after the retry loop concludes -- not per attempt
    // (a retry succeeding on attempt 2 is a successful delivery, not 2
    // separate API_SUCCESS/API_FAILED events). Best-effort: a monitor
    // failure must never break webhook delivery itself, which already
    // completed above.
    await withTenantContext({ orgId }, (tx) =>
      runWebhookDeliveryOutcomeMonitor(tx, orgId, {
        webhookId: webhook.id, eventType, succeeded: delivered, attempts: attemptsMade, lastStatusCode,
      })
    ).catch((err) => console.error(`[webhook-delivery-outcome-monitor] failed for webhook ${webhook.id}:`, err));
  }
}

/**
 * Manually replays a previously-recorded delivery (typically one that
 * exhausted all 3 automatic attempts and never succeeded) against the
 * webhook's current URL/secret, using the payload/eventType already stored
 * on that row -- no re-fetch of the original trigger data needed. Records a
 * new webhook_deliveries row linked back via redeliveryOfId. Caller is
 * responsible for tenant scoping (webhook + delivery must already be
 * confirmed to belong to the requesting org before this is called -- see
 * POST /api/settings/webhooks/[id]/redeliver).
 *
 * Deliberately does NOT invoke runWebhookDeliveryOutcomeMonitor (RES-02
 * Phase 1, see deliverWebhook above): that monitor's per-webhook-per-event
 * accounting is for the automatic delivery pipeline; a manual replay is an
 * explicit, human-initiated action already visible in the UI/audit trail,
 * not a new automatic-pipeline outcome to alert on.
 */
export async function redeliverWebhookDelivery(
  webhook: Webhook,
  originalDelivery: typeof webhookDeliveries.$inferSelect
): Promise<typeof webhookDeliveries.$inferSelect> {
  const outcome = await sendWebhookAttempt(
    webhook,
    originalDelivery.eventType,
    originalDelivery.payload as Record<string, unknown>
  );

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      eventType: originalDelivery.eventType,
      payload: originalDelivery.payload as Record<string, unknown>,
      statusCode: outcome.statusCode,
      response: outcome.response,
      attempt: originalDelivery.attempt + 1,
      success: outcome.success,
      redeliveryOfId: originalDelivery.id,
    })
    .returning();

  if (outcome.success) {
    await db
      .update(webhooks)
      .set({ lastDeliveryAt: new Date(), lastStatusCode: outcome.statusCode })
      .where(eq(webhooks.id, webhook.id));
  }

  return delivery;
}
