// Wave 30 (n8n-inspired trigger->condition->action, PLATFORM_STRATEGY.md
// §15). Deliberately much smaller than n8n itself: no node-graph, no AI
// action type, no code-execution action type. evaluateAndRunRules() is
// called from existing service functions at the moment something changes
// (see notice-service.ts's updateNotice() and pms-issue-service.ts's
// updateIssue()) -- there is no generic event bus in this codebase and
// building one is out of scope for what a handful of call sites need.
//
// Task #47 (PM feature-parity gap analysis, KERNEL_CONSOLIDATION_STATUS.md
// 2026-07-30 ~15:10 UTC): the reference platform's WorkflowRule trigger
// catalog is generic (Create/Edit/Delete/StatusChange/DueDate/Assignment/
// Comment/Time-based) and its actions aren't limited to single-condition,
// single-hop rules. This wave adds real multi-condition (AND/OR) matching,
// a `trigger_rule` action type that chains into evaluation of other rules
// with real cycle detection, and closes 2 of the trigger-catalog gaps
// (Assignment, Time-based/DueDate). Still zero LLM calls anywhere in this
// file -- every decision below is explicit, deterministic code.
import { after } from "next/server"
import { automationRules, automationRuleRuns, notifications, tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { indexCapability, buildCapabilityContent } from "./capability-registry-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type AutomationContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export const ACTION_TYPES = ["notify_user", "create_task", "trigger_rule"] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export type ConditionOperator = "equals" | "not_equals"

export type TriggerCondition = { field: string; operator?: ConditionOperator; value: unknown }

// Multi-condition matching (Task #47): a rule's triggerConditions column can
// still hold a single legacy condition object (backward compatible with
// every rule created before this wave) OR a group of conditions combined
// with AND/OR. No expression language, no nesting beyond one group -- kept
// to exactly what "multiple conditions" requires.
export type TriggerConditionGroup = { combinator: "AND" | "OR"; conditions: TriggerCondition[] }
export type TriggerConditions = TriggerCondition | TriggerConditionGroup

function getPayloadField(payload: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload)
}

function singleConditionMatches(cond: TriggerCondition, payload: Record<string, unknown>): boolean {
  if (!cond.field) return true // no condition set -- rule fires on every event of this triggerType
  const actual = getPayloadField(payload, cond.field)
  return cond.operator === "not_equals" ? actual !== cond.value : actual === cond.value
}

function isConditionGroup(conditions: object): conditions is TriggerConditionGroup {
  return "combinator" in conditions && Array.isArray((conditions as { conditions?: unknown }).conditions)
}

/** Pure, DB-free -- exported for direct unit testing alongside planRuleChain(). */
export function conditionsMatch(conditions: unknown, payload: Record<string, unknown>): boolean {
  if (!conditions || typeof conditions !== "object") return true
  if (isConditionGroup(conditions)) {
    const { combinator, conditions: group } = conditions
    if (group.length === 0) return true
    return combinator === "OR"
      ? group.some((c) => singleConditionMatches(c, payload))
      : group.every((c) => singleConditionMatches(c, payload))
  }
  return singleConditionMatches(conditions as TriggerCondition, payload)
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
  input: { name: string; description?: string; triggerType: string; triggerConditions?: TriggerConditions; actionType: ActionType; actionConfig: Record<string, unknown> }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.triggerType?.trim()) throw new ServiceError("triggerType is required", 400)
  if (!ACTION_TYPES.includes(input.actionType)) throw new ServiceError(`actionType must be one of: ${ACTION_TYPES.join(", ")}`, 400)
  if (input.actionType === "trigger_rule") {
    if (!input.actionConfig?.targetTriggerType) throw new ServiceError("actionConfig.targetTriggerType is required for trigger_rule", 400)
  } else if (!input.actionConfig?.userId) {
    throw new ServiceError("actionConfig.userId is required", 400)
  }

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

export async function updateAutomationRule(ctx: AutomationContext, ruleId: string, patch: Partial<{ name: string; description: string | null; isActive: boolean; triggerConditions: TriggerConditions; actionConfig: Record<string, unknown> }>) {
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

export type RuleRecord = {
  id: string
  name: string
  triggerType: string
  triggerConditions: unknown
  actionType: string
  actionConfig: Record<string, unknown>
}

export type ChainedFiring = { rule: RuleRecord; triggerType: string }
export type ChainCycle = { ruleId: string; triggerType: string; targetTriggerType: string }
export type ChainPlan = { firings: ChainedFiring[]; cycles: ChainCycle[] }

// A chain that revisited an ancestor trigger type would recurse forever
// without this -- kept as a defense-in-depth backstop alongside the real
// (path-based) cycle detection below, in case a future actionType ever
// makes a genuinely non-cyclical chain grow unexpectedly deep.
const MAX_CHAIN_DEPTH = 20

/**
 * Pure, DB-free chain resolution + cycle detection: given every one of an
 * org's active automation rules and a starting triggerType, walks
 * `trigger_rule` actions to determine (a) every rule that will actually
 * fire, in order, and (b) every place a chain would have revisited a
 * trigger type already on its own path (a real cycle, e.g. A -> B -> A) --
 * those are reported instead of walked, so the chain terminates.
 *
 * Cycle detection is path-based (an ancestor-of-current-node check), not a
 * single global "already seen anywhere" set -- that distinction matters:
 * two independent rules chaining into the same downstream trigger type
 * (fan-in) is legitimate and must not be misreported as a cycle. A trigger
 * type is only skipped a second time (silently, not as a cycle) once its
 * rules have already fired earlier in this same chain, so fan-in still
 * only executes once.
 *
 * Exported so this decision logic is directly unit-testable without a live
 * DB, matching this codebase's existing convention (see
 * computeRoundRobinAssignment in crm-service.ts, predecessorIdsOf in
 * pms-issue-service.ts).
 */
export function planRuleChain(rules: RuleRecord[], startTriggerType: string, payload: Record<string, unknown>): ChainPlan {
  const firings: ChainedFiring[] = []
  const cycles: ChainCycle[] = []
  const firedTriggerTypes = new Set<string>()

  function visit(triggerType: string, path: readonly string[]): void {
    if (path.length >= MAX_CHAIN_DEPTH) return
    if (firedTriggerTypes.has(triggerType)) return // fan-in: already fired earlier in this chain, not a cycle
    firedTriggerTypes.add(triggerType)

    const matching = rules.filter((r) => r.triggerType === triggerType && conditionsMatch(r.triggerConditions, payload))
    for (const rule of matching) {
      firings.push({ rule, triggerType })
      if (rule.actionType !== "trigger_rule") continue
      const targetTriggerType = String(rule.actionConfig?.targetTriggerType ?? "")
      if (!targetTriggerType) continue
      if (path.includes(targetTriggerType) || targetTriggerType === triggerType) {
        cycles.push({ ruleId: rule.id, triggerType, targetTriggerType })
      } else {
        visit(targetTriggerType, [...path, triggerType])
      }
    }
  }

  visit(startTriggerType, [])
  return { firings, cycles }
}

// Called fire-and-forget from existing service functions at the moment an
// event happens -- never blocks the caller's own transaction, matching the
// fire-and-forget style already used for worker_agent_usage_log/mcp_access_codes.
export async function evaluateAndRunRules(ctx: { orgId: string }, triggerType: string, payload: Record<string, unknown>) {
  try {
    await withTenantContext({ orgId: ctx.orgId }, async (db) => {
      // Fetch every active rule once -- a chain can hop across trigger
      // types via `trigger_rule`, so filtering to a single triggerType at
      // the DB layer (as the pre-chaining version did) can't see the rest
      // of the chain. planRuleChain() does the real triggerType filtering
      // in memory via conditionsMatch().
      const rules = await db.query.automationRules.findMany({
        where: and(eq(automationRules.orgId, ctx.orgId), eq(automationRules.isActive, true)),
      })

      const plan = planRuleChain(rules as unknown as RuleRecord[], triggerType, payload)

      for (const cycle of plan.cycles) {
        await db.insert(automationRuleRuns).values({
          ruleId: cycle.ruleId, triggerPayload: payload, status: "failed",
          errorMessage: `Cycle detected: chaining "${cycle.triggerType}" -> "${cycle.targetTriggerType}" would revisit a trigger already evaluated earlier in this chain -- stopped instead of looping.`,
        })
      }

      for (const { rule, triggerType: firedAs } of plan.firings) {
        try {
          const config = rule.actionConfig as Record<string, unknown>
          let resultSummary = `${rule.actionType} executed`

          if (rule.actionType === "notify_user") {
            const targetUserId = String(config.userId ?? "")
            if (!targetUserId) throw new Error("actionConfig.userId missing")
            await db.insert(notifications).values({
              userId: targetUserId,
              title: (config.title as string) || rule.name,
              message: (config.message as string) || `Automation rule "${rule.name}" fired for ${firedAs}`,
              type: "system",
              metadata: { automationRuleId: rule.id, triggerType: firedAs, payload },
            })
          } else if (rule.actionType === "create_task") {
            const targetUserId = String(config.userId ?? "")
            if (!targetUserId) throw new Error("actionConfig.userId missing")
            await db.insert(tasks).values({
              orgId: ctx.orgId,
              userId: targetUserId,
              title: (config.title as string) || rule.name,
              description: (config.description as string) || `Auto-created by rule "${rule.name}" (${firedAs})`,
              status: "pending",
            })
          } else if (rule.actionType === "trigger_rule") {
            // The actual downstream firings (and any cycle this chain
            // link led to) were already resolved by planRuleChain() above
            // and are executed/logged as their own entries in this same
            // loop/cycle list -- this rule's own run just records that it
            // was the chain link, not a second execution.
            const targetTriggerType = String(config.targetTriggerType ?? "")
            resultSummary = `chained to "${targetTriggerType}"`
          }

          await db.insert(automationRuleRuns).values({ ruleId: rule.id, triggerPayload: payload, status: "success", resultSummary })
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
