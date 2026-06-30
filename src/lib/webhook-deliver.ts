import { db, webhooks, webhookDeliveries } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

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

    const timestamp = new Date().toISOString();
    const body = JSON.stringify({ event: eventType, timestamp, data: payload });
    const signature = crypto
      .createHmac("sha256", webhook.secret)
      .update(body)
      .digest("hex");

    for (let attempt = 1; attempt <= 3; attempt++) {
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

        await db.insert(webhookDeliveries).values({
          webhookId: webhook.id,
          eventType,
          payload: payload as Record<string, unknown>,
          statusCode: response.status,
          response: await response.text().catch(() => null),
          attempt,
          success: response.status >= 200 && response.status < 300,
        });

        if (response.status >= 200 && response.status < 300) {
          await db
            .update(webhooks)
            .set({ lastDeliveryAt: new Date(), lastStatusCode: response.status })
            .where(eq(webhooks.id, webhook.id));
          break;
        }

        // Exponential backoff: 1s, 5s, 25s
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, Math.pow(5, attempt - 1) * 1000));
        }
      } catch (error) {
        await db.insert(webhookDeliveries).values({
          webhookId: webhook.id,
          eventType,
          payload: payload as Record<string, unknown>,
          statusCode: null,
          response: error instanceof Error ? error.message : "Unknown error",
          attempt,
          success: false,
        });

        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, Math.pow(5, attempt - 1) * 1000));
        }
      }
    }
  }
}