// Wave 30 (n8n-inspired trigger->condition->action, PLATFORM_STRATEGY.md
// §15). Deliberately much smaller than n8n itself: single-condition rules,
// no node-graph, no chained multi-step workflows, no AI action type, no
// code-execution action type. evaluateAndRunRules() is called from
// existing service functions at the moment something changes (see
// notice-service.ts's updateNotice() and pms-issue-service.ts's
// updateIssue()) -- there is no generic event bus in this codebase and
// building one is out of scope for what 2 call sites need.
import { after } from "next/server"
import { automationRules, automationRuleRuns, notifications, tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { indexCapability, buildCapabilityContent } from "./capability-registry-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type AutomationContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type TriggerCondition = { field: string; operator: "equals"; value: unknown }

function getPayloadField(payload: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload)
}

function conditionsMatch(conditions: unknown, payload: Record<string, unknown>): boolean {
  if (!conditions || typeof conditions !== "object") return true
  const cond = conditions as Partial<TriggerCondition>
  if (!cond.field) return true // no condition set -- rule fires on every event of this triggerType
  return getPayloadField(payload, cond.field) === cond.value
}

export async function listAutomationRules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.automationRules.findMany({
      where: eq(automationRules.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

export async function createAutomationRule(
  ctx: AutomationContext,
  input: { name: string; description?: string; triggerType: string; triggerConditions?: TriggerCondition; actionType: "notify_user" | "create_task"; actionConfig: Record<string, unknown> }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.triggerType?.trim()) throw new ServiceError("triggerType is required", 400)
  if (input.actionType !== "notify_user" && input.actionType !== "create_task") throw new ServiceError("actionType must be notify_user or create_task", 400)
  if (!input.actionConfig?.userId) throw new ServiceError("actionConfig.userId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [rule] = await db.insert(automationRules).values({
      orgId: ctx.orgId, name, description: input.description || null,
      triggerType: input.triggerType, triggerConditions: input.triggerConditions || {},
      actionType: input.actionType, actionConfig: input.actionConfig, createdById: ctx.userId,
    }).returning()

    // Wave 43 (Capability Registry) -- fire-and-forget, mirrors
    // proposeWorkerAgent()'s own indexing so VERI FDE's duplicate-check
    // covers automation rules too, not just worker agents.
    //
    // Bug fix (2026-07-06): wrapped in after() -- an un-awaited promise here
    // could be killed by Vercel before it ran, same root cause found in
    // Meeting Intelligence (see veri-meeting-service.ts).
    after(() => indexCapability(
      "automation_rule", rule.id,
      buildCapabilityContent({ name: rule.name, domain: rule.triggerType, description: rule.description }),
      rule.orgId
    ).catch((err) => console.error("Failed to index automation rule capability:", err)))

    return rule
  })
}

export async function updateAutomationRule(ctx: AutomationContext, ruleId: string, patch: Partial<{ name: string; description: string | null; isActive: boolean; triggerConditions: TriggerCondition; actionConfig: Record<string, unknown> }>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.automationRules.findFirst({ where: and(eq(automationRules.id, ruleId), eq(automationRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Automation rule not found", 404)
    const [rule] = await db.update(automationRules).set({ ...patch, updatedAt: new Date() }).where(eq(automationRules.id, ruleId)).returning()
    return rule
  })
}

export async function deleteAutomationRule(ctx: { orgId: string }, ruleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.automationRules.findFirst({ where: and(eq(automationRules.id, ruleId), eq(automationRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Automation rule not found", 404)
    await db.delete(automationRules).where(eq(automationRules.id, ruleId))
  })
}

export async function listAutomationRuleRuns(ctx: { orgId: string }, ruleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rule = await db.query.automationRules.findFirst({ where: and(eq(automationRules.id, ruleId), eq(automationRules.orgId, ctx.orgId)) })
    if (!rule) throw new ServiceError("Automation rule not found", 404)
    return db.query.automationRuleRuns.findMany({ where: eq(automationRuleRuns.ruleId, ruleId), orderBy: (t, { desc }) => desc(t.triggeredAt) })
  })
}

// Called fire-and-forget from existing service functions at the moment an
// event happens -- never blocks the caller's own transaction, matching the
// fire-and-forget style already used for worker_agent_usage_log/mcp_access_codes.
export async function evaluateAndRunRules(ctx: { orgId: string }, triggerType: string, payload: Record<string, unknown>) {
  try {
    await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const rules = await db.query.automationRules.findMany({
        where: and(eq(automationRules.orgId, ctx.orgId), eq(automationRules.triggerType, triggerType), eq(automationRules.isActive, true)),
      })

      for (const rule of rules) {
        if (!conditionsMatch(rule.triggerConditions, payload)) continue

        try {
          const config = rule.actionConfig as Record<string, unknown>
          const targetUserId = String(config.userId ?? "")
          if (!targetUserId) throw new Error("actionConfig.userId missing")

          if (rule.actionType === "notify_user") {
            await db.insert(notifications).values({
              userId: targetUserId,
              title: (config.title as string) || rule.name,
              message: (config.message as string) || `Automation rule "${rule.name}" fired for ${triggerType}`,
              type: "system",
              metadata: { automationRuleId: rule.id, triggerType, payload },
            })
          } else if (rule.actionType === "create_task") {
            await db.insert(tasks).values({
              orgId: ctx.orgId,
              userId: targetUserId,
              title: (config.title as string) || rule.name,
              description: (config.description as string) || `Auto-created by rule "${rule.name}" (${triggerType})`,
              status: "pending",
            })
          }

          await db.insert(automationRuleRuns).values({ ruleId: rule.id, triggerPayload: payload, status: "success", resultSummary: `${rule.actionType} executed` })
        } catch (err) {
          await db.insert(automationRuleRuns).values({ ruleId: rule.id, triggerPayload: payload, status: "failed", errorMessage: err instanceof Error ? err.message : String(err) })
        }
      }
    })
  } catch {
    // Automation must never break the caller's own operation (e.g. a
    // notice status update should still succeed even if rule evaluation
    // itself throws) -- swallow at the top level, individual rule
    // failures are already logged per-rule above.
  }
}
