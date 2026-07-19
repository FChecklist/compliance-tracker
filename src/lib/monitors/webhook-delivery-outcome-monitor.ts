// PLATFORM_STRATEGY.md section 29.3 Phase 1: the API_SUCCESS/API_FAILED
// slice of the ~28 remaining documented event types.
//
// `webhook_deliveries` (schema.ts) is the one real, generic outbound-call
// outcome table in this codebase (inbound api_key_request_log only
// distinguishes rate-limited vs. not, no generic success/failure; Composio
// connector calls persist nothing at all -- see this gap's own PR
// description for the full investigation). Rule: a pure pass/fail check on
// the FINAL delivery attempt for one webhook (not each individual retry --
// retries are an internal delivery-mechanism detail, not a separate
// API_SUCCESS/API_FAILED event each), mirroring meeting-intelligence-
// generation-monitor.ts's own success/failure shape rather than an
// SLA-pair comparison (there's no meaningful elapsed-time SLA on an
// HTTP POST's own retry loop).
//
// Real call site: webhook-deliver.ts's deliverWebhook(), after its existing
// per-webhook attempt loop concludes (breaks on success, or exhausts all 3
// attempts). No human actor exists at this call site (webhooks fire from
// internal domain events, never a request handler) -- uses the same
// dbUser/apiKey ServiceActor duality Wave 9 already established for exactly
// this "no human session" case, with a synthetic system apiKey id (not a
// real api_keys table row -- audit_logs.apiKeyId has no FK constraint, same
// posture as entityId's own free-text precedent).
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { runRuleEngineMonitor, type RuleEngineMonitorResult } from "./rule-engine-monitor"

export const WEBHOOK_DELIVERY_OUTCOME_MONITOR_NAME = "webhook_delivery_outcome_monitor"

export const WEBHOOK_DELIVERY_SYSTEM_ACTOR = { apiKey: { id: "system:webhook-deliver", name: "System: webhook-deliver.ts" } } as const

export type WebhookDeliveryOutcomeMonitorInput = {
  webhookId: string
  eventType: string
  succeeded: boolean
  attempts: number
  lastStatusCode: number | null
}

export async function runWebhookDeliveryOutcomeMonitor(
  db: TenantDb,
  orgId: string,
  input: WebhookDeliveryOutcomeMonitorInput,
  request?: Request
): Promise<RuleEngineMonitorResult> {
  return runRuleEngineMonitor(db, orgId, WEBHOOK_DELIVERY_SYSTEM_ACTOR, {
    monitorName: WEBHOOK_DELIVERY_OUTCOME_MONITOR_NAME,
    entityType: "Webhook",
    entityId: input.webhookId,
    worker: `Webhook ${input.webhookId} (event ${input.eventType})`,
    check: {
      withinRule: input.succeeded,
      protocol: `delivery ${input.succeeded ? "succeeded" : "failed"} after ${input.attempts} attempt(s), lastStatusCode=${input.lastStatusCode ?? "none"}`,
    },
    request,
  })
}
