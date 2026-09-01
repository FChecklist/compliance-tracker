// Wave 173 (VERIDIAN Review Framework gap-closure: Business Rules Engine /
// Rule Lifecycle Management, task-20260718-080006). See schema.ts's "Wave
// 173" header for the full design rationale. Three findings closed here:
// engine completeness (condition tree + action, author/store/evaluate),
// versioning (append-only snapshot history + rollback-as-new-version), and
// a testing framework (dry-run against a caller-supplied sample record, no
// side effects, no auto-execution). Simulation (the 4th finding, Low
// priority) is deferred per its own recommended approach.
import { businessRules, businessRuleVersions, businessRuleTestRuns } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type BusinessRuleOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "not_contains" | "is_empty" | "is_not_empty"
const OPERATORS: BusinessRuleOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "is_empty", "is_not_empty"]

export type ConditionLeaf = { field: string; operator: BusinessRuleOperator; value?: unknown }
export type ConditionGroup = { all: ConditionNode[] } | { any: ConditionNode[] }
export type ConditionNode = ConditionLeaf | ConditionGroup

export type RuleAction = { type: string; config?: Record<string, unknown> }

export type RuleStatus = "draft" | "active" | "deprecated" | "archived"
const RULE_STATUSES: RuleStatus[] = ["draft", "active", "deprecated", "archived"]

type Ctx = { orgId: string; userId?: string }

// ─── Condition-tree evaluator ─────────────────────────────────────────────
// Pure function, no I/O -- reused by both the lifecycle CRUD's own
// validation (reject a leaf with an unknown operator up front) and the
// dry-run test/simulate paths.

function isLeaf(node: ConditionNode): node is ConditionLeaf {
  return typeof (node as ConditionLeaf).field === "string"
}

function getField(record: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), record)
}

function evaluateLeaf(leaf: ConditionLeaf, record: Record<string, unknown>): boolean {
  const actual = getField(record, leaf.field)
  switch (leaf.operator) {
    case "eq": return actual === leaf.value
    case "neq": return actual !== leaf.value
    case "gt": return typeof actual === "number" && typeof leaf.value === "number" && actual > leaf.value
    case "gte": return typeof actual === "number" && typeof leaf.value === "number" && actual >= leaf.value
    case "lt": return typeof actual === "number" && typeof leaf.value === "number" && actual < leaf.value
    case "lte": return typeof actual === "number" && typeof leaf.value === "number" && actual <= leaf.value
    case "contains": return typeof actual === "string" && typeof leaf.value === "string" && actual.includes(leaf.value)
    case "not_contains": return !(typeof actual === "string" && typeof leaf.value === "string" && actual.includes(leaf.value))
    case "is_empty": return actual === undefined || actual === null || actual === ""
    case "is_not_empty": return !(actual === undefined || actual === null || actual === "")
    default: return false
  }
}

export function evaluateConditionTree(node: ConditionNode, record: Record<string, unknown>): boolean {
  if (isLeaf(node)) return evaluateLeaf(node, record)
  if ("all" in node) return node.all.every((child) => evaluateConditionTree(child, record))
  if ("any" in node) return node.any.some((child) => evaluateConditionTree(child, record))
  return false
}

// Validates shape recursively -- rejects an unknown operator, a leaf
// missing `field`, or a group whose key isn't `all`/`any` with an array.
// Called on every create/update so a malformed rule can never reach
// 'active' status.
export function validateConditionTree(node: unknown, depth = 0): ConditionNode {
  if (depth > 10) throw new ServiceError("Condition tree exceeds max nesting depth (10)", 400)
  if (!node || typeof node !== "object") throw new ServiceError("Condition node must be an object", 400)
  const n = node as Record<string, unknown>
  if ("all" in n || "any" in n) {
    const key = "all" in n ? "all" : "any"
    const children = n[key]
    if (!Array.isArray(children) || children.length === 0) throw new ServiceError(`Condition group "${key}" must be a non-empty array`, 400)
    children.forEach((c) => validateConditionTree(c, depth + 1))
    return n as ConditionGroup
  }
  if (typeof n.field !== "string" || !n.field.trim()) throw new ServiceError("Condition leaf requires a non-empty field", 400)
  if (!OPERATORS.includes(n.operator as BusinessRuleOperator)) throw new ServiceError(`Condition leaf has unknown operator: ${String(n.operator)}`, 400)
  return n as ConditionLeaf
}

function validateAction(action: unknown): RuleAction {
  if (!action || typeof action !== "object") throw new ServiceError("action must be an object", 400)
  const a = action as Record<string, unknown>
  if (typeof a.type !== "string" || !a.type.trim()) throw new ServiceError("action.type is required", 400)
  return { type: a.type, config: (a.config as Record<string, unknown>) || {} }
}

// ─── Lifecycle state machine ──────────────────────────────────────────────
// draft -> active -> deprecated -> archived, with draft/active reachable
// again from deprecated (reactivate). archived is terminal -- matches this
// codebase's training_course_status precedent of a terminal 'archived'
// state, generalized with the extra 'deprecated' step this finding's
// "rule lifecycle management" title specifically asks for.
const ALLOWED_TRANSITIONS: Record<RuleStatus, RuleStatus[]> = {
  draft: ["active", "archived"],
  active: ["deprecated", "archived"],
  deprecated: ["active", "archived"],
  archived: [],
}

// Exported (pure, no I/O) so the state machine itself is unit-testable
// without a database -- see business-rules-service.test.ts.
export function canTransitionRuleStatus(from: RuleStatus, to: RuleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

function assertTransition(from: RuleStatus, to: RuleStatus) {
  if (!canTransitionRuleStatus(from, to)) {
    throw new ServiceError(`Cannot transition a business rule from "${from}" to "${to}"`, 400)
  }
}

// ─── CRUD + versioning ─────────────────────────────────────────────────────

export async function listBusinessRules(ctx: { orgId: string }, filters: { moduleKey?: string; status?: string } = {}) {
  if (filters.status && !RULE_STATUSES.includes(filters.status as RuleStatus)) {
    throw new ServiceError(`Invalid status filter: ${filters.status}`, 400)
  }
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(businessRules.orgId, ctx.orgId)]
    if (filters.moduleKey) conditions.push(eq(businessRules.moduleKey, filters.moduleKey))
    if (filters.status) conditions.push(eq(businessRules.status, filters.status as RuleStatus))
    return db.query.businessRules.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

export async function getBusinessRule(ctx: { orgId: string }, ruleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rule = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!rule) throw new ServiceError("Business rule not found", 404)
    return rule
  })
}

export async function createBusinessRule(
  ctx: Ctx,
  input: { moduleKey: string; name: string; description?: string; conditionTree: unknown; action: unknown }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.moduleKey?.trim()) throw new ServiceError("moduleKey is required", 400)
  const conditionTree = validateConditionTree(input.conditionTree)
  const action = validateAction(input.action)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [rule] = await db.insert(businessRules).values({
      orgId: ctx.orgId, moduleKey: input.moduleKey, name, description: input.description || null,
      status: "draft", currentVersion: 1, conditionTree, action, createdById: ctx.userId, updatedById: ctx.userId,
    }).returning()

    await db.insert(businessRuleVersions).values({
      orgId: ctx.orgId, ruleId: rule.id, version: 1, name, conditionTree, action,
      changeNote: "Initial version", createdById: ctx.userId,
    })

    return rule
  })
}

// Updating conditionTree/action/name always writes a NEW version (Business
// Rule Versioning finding) -- never mutates a prior businessRuleVersions
// row. Metadata-only patches (description) do not bump the version.
export async function updateBusinessRule(
  ctx: Ctx,
  ruleId: string,
  patch: Partial<{ name: string; description: string | null; conditionTree: unknown; action: unknown; changeNote: string }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Business rule not found", 404)
    if (existing.status === "archived") throw new ServiceError("Cannot edit an archived business rule", 400)

    const nextName = patch.name?.trim() || existing.name
    const contentChanged = patch.conditionTree !== undefined || patch.action !== undefined || patch.name !== undefined
    const conditionTree = patch.conditionTree !== undefined ? validateConditionTree(patch.conditionTree) : existing.conditionTree
    const action = patch.action !== undefined ? validateAction(patch.action) : existing.action

    const nextVersion = contentChanged ? existing.currentVersion + 1 : existing.currentVersion

    const [rule] = await db.update(businessRules).set({
      name: nextName,
      description: patch.description !== undefined ? patch.description : existing.description,
      conditionTree, action, currentVersion: nextVersion, updatedById: ctx.userId, updatedAt: new Date(),
    }).where(eq(businessRules.id, ruleId)).returning()

    if (contentChanged) {
      await db.insert(businessRuleVersions).values({
        orgId: ctx.orgId, ruleId, version: nextVersion, name: nextName, conditionTree, action,
        changeNote: patch.changeNote || null, createdById: ctx.userId,
      })
    }

    return rule
  })
}

export async function listBusinessRuleVersions(ctx: { orgId: string }, ruleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rule = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!rule) throw new ServiceError("Business rule not found", 404)
    return db.query.businessRuleVersions.findMany({ where: eq(businessRuleVersions.ruleId, ruleId), orderBy: (t, { desc }) => desc(t.version) })
  })
}

// Rollback writes a NEW version whose content is a copy of `toVersion`'s
// snapshot -- history is never rewritten, matching the "append-only" design
// noted in schema.ts.
export async function rollbackBusinessRule(ctx: Ctx, ruleId: string, toVersion: number) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Business rule not found", 404)
    if (existing.status === "archived") throw new ServiceError("Cannot roll back an archived business rule", 400)

    const target = await db.query.businessRuleVersions.findFirst({ where: and(eq(businessRuleVersions.ruleId, ruleId), eq(businessRuleVersions.version, toVersion)) })
    if (!target) throw new ServiceError(`Version ${toVersion} not found for this rule`, 404)

    const nextVersion = existing.currentVersion + 1
    const [rule] = await db.update(businessRules).set({
      name: target.name, conditionTree: target.conditionTree, action: target.action,
      currentVersion: nextVersion, updatedById: ctx.userId, updatedAt: new Date(),
    }).where(eq(businessRules.id, ruleId)).returning()

    await db.insert(businessRuleVersions).values({
      orgId: ctx.orgId, ruleId, version: nextVersion, name: target.name, conditionTree: target.conditionTree, action: target.action,
      changeNote: `Rollback to v${toVersion}`, createdById: ctx.userId,
    })

    return rule
  })
}

async function transitionBusinessRule(ctx: Ctx, ruleId: string, to: RuleStatus, timestampField: "activatedAt" | "deprecatedAt" | "archivedAt") {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Business rule not found", 404)
    assertTransition(existing.status, to)

    const [rule] = await db.update(businessRules).set({
      status: to, [timestampField]: new Date(), updatedById: ctx.userId, updatedAt: new Date(),
    }).where(eq(businessRules.id, ruleId)).returning()
    return rule
  })
}

export function activateBusinessRule(ctx: Ctx, ruleId: string) {
  return transitionBusinessRule(ctx, ruleId, "active", "activatedAt")
}

export function deprecateBusinessRule(ctx: Ctx, ruleId: string) {
  return transitionBusinessRule(ctx, ruleId, "deprecated", "deprecatedAt")
}

export function archiveBusinessRule(ctx: Ctx, ruleId: string) {
  return transitionBusinessRule(ctx, ruleId, "archived", "archivedAt")
}

// ─── Testing framework (dry-run) ───────────────────────────────────────────
// Pure evaluation against a caller-supplied sample record -- never fetches
// or mutates a real live entity, never executes the action, only logs what
// WOULD have happened. Defaults to the rule's current version; an older
// version can be tested explicitly via `version`.
export async function testBusinessRule(ctx: Ctx, ruleId: string, input: { sampleRecord: Record<string, unknown>; version?: number }) {
  if (!input.sampleRecord || typeof input.sampleRecord !== "object") throw new ServiceError("sampleRecord is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const rule = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!rule) throw new ServiceError("Business rule not found", 404)

    const version = input.version ?? rule.currentVersion
    const versionRow = version === rule.currentVersion
      ? { conditionTree: rule.conditionTree, action: rule.action }
      : await db.query.businessRuleVersions.findFirst({ where: and(eq(businessRuleVersions.ruleId, ruleId), eq(businessRuleVersions.version, version)) })
    if (!versionRow) throw new ServiceError(`Version ${version} not found for this rule`, 404)

    let matched = false
    let actionPreview: RuleAction | null = null
    let errorMessage: string | null = null
    try {
      matched = evaluateConditionTree(versionRow.conditionTree as ConditionNode, input.sampleRecord)
      actionPreview = matched ? (versionRow.action as RuleAction) : null
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    const [testRun] = await db.insert(businessRuleTestRuns).values({
      orgId: ctx.orgId, ruleId, version, sampleRecord: input.sampleRecord,
      matched, actionPreview, errorMessage, createdById: ctx.userId,
    }).returning()

    return testRun
  })
}

export async function listBusinessRuleTestRuns(ctx: { orgId: string }, ruleId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rule = await db.query.businessRules.findFirst({ where: and(eq(businessRules.id, ruleId), eq(businessRules.orgId, ctx.orgId)) })
    if (!rule) throw new ServiceError("Business rule not found", 404)
    return db.query.businessRuleTestRuns.findMany({ where: eq(businessRuleTestRuns.ruleId, ruleId), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}
