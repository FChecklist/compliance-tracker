// Wave 38 (Grafana-inspired scheduled threshold alerting, PLATFORM_STRATEGY.md
// §22). Grafana itself was evaluated and rejected as software (AGPL-3.0
// core, standalone Go server + own DB, no Vercel-serverless path) -- only
// its "evaluate periodically, notify on breach" pattern is adapted here.
// Reuses custom-report-service.ts's exact sourceEntity/groupByField
// whitelist rather than inventing a second one -- never a new arbitrary-
// query surface. evaluateAllMetricAlertRules() is the cron entry point
// (see /api/internal/metric-alerts/run), using the raw `db` client since a
// scheduled job has no single request-scoped org, same posture as
// instruction-mismatch-audit.ts.
import { db, metricAlertRules, notifications, complianceItems, notices, risks, pmsIssues, incidents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { isValidSourceEntity, isValidGroupByField, type SourceEntity } from "./custom-report-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type MetricAlertContext = { orgId: string; userId: string }

export type MetricAlertOperator = "gt" | "gte" | "lt" | "lte" | "eq"

function compare(value: number, operator: MetricAlertOperator, threshold: number): boolean {
  switch (operator) {
    case "gt": return value > threshold
    case "gte": return value >= threshold
    case "lt": return value < threshold
    case "lte": return value <= threshold
    case "eq": return value === threshold
  }
}

export async function listMetricAlertRules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.metricAlertRules.findMany({
      where: eq(metricAlertRules.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function createMetricAlertRule(
  ctx: MetricAlertContext,
  input: { name: string; sourceEntity: string; filterField?: string; filterValue?: string; operator?: MetricAlertOperator; threshold: number; notifyUserIds: string[] }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!isValidSourceEntity(input.sourceEntity)) throw new ServiceError("Invalid sourceEntity", 400)
  if (input.filterField && !isValidGroupByField(input.sourceEntity, input.filterField)) {
    throw new ServiceError("Invalid filterField for this sourceEntity", 400)
  }
  if (!Number.isFinite(input.threshold)) throw new ServiceError("threshold must be a number", 400)
  if (!input.notifyUserIds?.length) throw new ServiceError("notifyUserIds must have at least one user", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [rule] = await db.insert(metricAlertRules).values({
      orgId: ctx.orgId, name, sourceEntity: input.sourceEntity,
      filterField: input.filterField || null, filterValue: input.filterValue || null,
      operator: input.operator || "gt", threshold: input.threshold,
      notifyUserIds: input.notifyUserIds, createdById: ctx.userId,
    }).returning()
    return rule
  })
}

export async function updateMetricAlertRule(
  ctx: { orgId: string },
  ruleId: string,
  patch: Partial<{ name: string; isActive: boolean; operator: MetricAlertOperator; threshold: number; notifyUserIds: string[]; filterField: string | null; filterValue: string | null }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.metricAlertRules.findFirst({ where: and(eq(metricAlertRules.id, ruleId), eq(metricAlertRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Metric alert rule not found", 404)
    const [rule] = await db.update(metricAlertRules).set({ ...patch, updatedAt: new Date() }).where(eq(metricAlertRules.id, ruleId)).returning()
    return rule
  })
}

export async function deleteMetricAlertRule(ctx: { orgId: string }, ruleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.metricAlertRules.findFirst({ where: and(eq(metricAlertRules.id, ruleId), eq(metricAlertRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Metric alert rule not found", 404)
    await db.delete(metricAlertRules).where(eq(metricAlertRules.id, ruleId))
  })
}

// Whitelisted count query -- mirrors custom-report-service.ts's runReport()
// switch exactly, just producing a single count instead of a grouped table.
async function countMetric(orgId: string, sourceEntity: SourceEntity, filterField: string | null, filterValue: string | null): Promise<number> {
  async function countRows<T extends { orgId: unknown }>(table: T, orgIdCol: unknown, filterCol: unknown | null) {
    const conditions = [eq(orgIdCol as never, orgId)]
    if (filterCol && filterValue !== null) conditions.push(eq(filterCol as never, filterValue as never))
    const rows = await db.select().from(table as never).where(and(...conditions))
    return rows.length
  }

  switch (sourceEntity) {
    case "compliance_items": {
      const col = filterField === "status" ? complianceItems.status : filterField === "priority" ? complianceItems.priority : filterField === "departmentId" ? complianceItems.departmentId : null
      return countRows(complianceItems, complianceItems.orgId, col)
    }
    case "notices": {
      const col = filterField === "status" ? notices.status : filterField === "authority" ? notices.authority : null
      return countRows(notices, notices.orgId, col)
    }
    case "risks": {
      const col = filterField === "status" ? risks.status : filterField === "category" ? risks.category : null
      return countRows(risks, risks.orgId, col)
    }
    case "pms_issues": {
      const col = filterField === "priority" ? pmsIssues.priority : filterField === "statusId" ? pmsIssues.statusId : null
      return countRows(pmsIssues, pmsIssues.orgId, col)
    }
    case "incidents": {
      const col = filterField === "severity" ? incidents.severity : filterField === "stage" ? incidents.stage : null
      return countRows(incidents, incidents.orgId, col)
    }
    default:
      return 0
  }
}

// Cron entry point (see /api/internal/metric-alerts/run) -- iterates every
// active rule across every org, using the raw `db` client since a scheduled
// job has no single request-scoped org (same posture as
// instruction-mismatch-audit.ts). Fires the existing notifications
// mechanism on breach (Wave 14's pattern, reused verbatim, type: "system"
// rather than a new enum value -- no confirmed need for a dedicated type).
export async function evaluateAllMetricAlertRules(): Promise<{ checked: number; breached: number }> {
  const rules = await db.query.metricAlertRules.findMany({ where: eq(metricAlertRules.isActive, true) })
  let breached = 0

  for (const rule of rules) {
    if (!isValidSourceEntity(rule.sourceEntity)) continue
    try {
      const value = await countMetric(rule.orgId, rule.sourceEntity, rule.filterField, rule.filterValue)
      if (compare(value, rule.operator as MetricAlertOperator, rule.threshold)) {
        breached++
        const notifyUserIds = Array.isArray(rule.notifyUserIds) ? (rule.notifyUserIds as string[]) : []
        for (const userId of notifyUserIds) {
          await db.insert(notifications).values({
            userId,
            title: `Metric alert: ${rule.name}`,
            message: `${rule.sourceEntity}${rule.filterField ? ` (${rule.filterField}=${rule.filterValue})` : ""} is ${value}, which is ${rule.operator} ${rule.threshold}.`,
            type: "system",
            metadata: { metricAlertRuleId: rule.id, value, threshold: rule.threshold, operator: rule.operator },
          })
        }
        await db.update(metricAlertRules).set({ lastTriggeredAt: new Date() }).where(eq(metricAlertRules.id, rule.id))
      }
    } catch (err) {
      console.error(`Metric alert rule ${rule.id} evaluation failed:`, err)
    }
  }

  return { checked: rules.length, breached }
}
