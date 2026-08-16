import { db, webhooks, webhookDeliveries, loopExecutions } from "@/lib/db";
import { eq, and, gte, desc } from "drizzle-orm";

/**
 * Loop 8: Output Management.
 *
 * Read-only audit over the one real "output delivery" mechanism in the
 * schema today: outbound webhooks. For every active webhook, checks its
 * last 10 deliveries and flags ones with a failure rate above 50% in the
 * last 7 days -- a broken customer endpoint that keeps getting retried is
 * wasted output, not successfully delivered output. Doesn't disable or
 * retry anything itself.
 *
 * Uses the raw `db` client deliberately -- platform-level audit spanning
 * every org's webhooks, not a single tenant's.
 */
const LOOKBACK_DAYS = 7;
const FAILURE_RATE_THRESHOLD = 0.5;

export async function runOutputDeliveryAudit(loopId: string): Promise<{
  webhooksChecked: number;
  unhealthyWebhookCount: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const activeWebhooks = await db.query.webhooks.findMany({
    where: eq(webhooks.isActive, true),
    columns: { id: true, orgId: true, name: true, url: true },
  });

  const unhealthy: Array<{ id: string; orgId: string; name: string; failureRate: number; deliveryCount: number }> = [];

  for (const webhook of activeWebhooks) {
    const deliveries = await db.query.webhookDeliveries.findMany({
      where: and(eq(webhookDeliveries.webhookId, webhook.id), gte(webhookDeliveries.createdAt, cutoff)),
      orderBy: desc(webhookDeliveries.createdAt),
      limit: 20,
    });
    if (deliveries.length === 0) continue;

    const failureCount = deliveries.filter((d) => !d.success).length;
    const failureRate = failureCount / deliveries.length;
    if (failureRate > FAILURE_RATE_THRESHOLD) {
      unhealthy.push({ id: webhook.id, orgId: webhook.orgId, name: webhook.name, failureRate, deliveryCount: deliveries.length });
    }
  }

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { webhooksChecked: activeWebhooks.length },
    analysisResult: { unhealthyWebhookCount: unhealthy.length, unhealthyWebhooks: unhealthy },
    actionTaken: { autoDisabled: false },
    measurementResult: {},
    executionTimeMs,
  });

  return { webhooksChecked: activeWebhooks.length, unhealthyWebhookCount: unhealthy.length, executionTimeMs };
}
