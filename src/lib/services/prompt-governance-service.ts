// VERIDIAN_Architecture_v2.0 phase_3_governance_policy_cost_engines
// (2026-07-26). The Business/Policy engine group the gap analysis confirmed
// has NO real prior art under the prompt-lifecycle domain (engine-business-
// rule, engine-dependency, engine-policy, engine-compliance,
// engine-governance, engine-cost-optimization -- see
// ai-os/VERIDIAN_ARCHITECTURE_V2_GAP_ANALYSIS_2026-07-25.yaml in
// claude-control for each item's exact requirement text and why the
// same-named 20-Engines/compliance-tracker-product mechanisms don't match).
// Every function below composes an EXISTING, live mechanism -- none of them
// opens a new datastore. This module's own job is to be the one place
// prompt-os-service.ts's transitionPromptLifecycle() calls to ask "is this
// specific transition allowed right now", per that function's own phase_1
// comment deferring exactly that question to phase_3.
import { db, promptEvalRuns, promptTemplates, promptVersions, moduleRuleConfigs, users } from "@/lib/db"
import { and, eq, gte, sql } from "drizzle-orm"
import { type TenantDb } from "@/lib/db/tenant-scoped"
import { checkAbacDenyPoliciesWithDb } from "./abac-policy-service"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const MODULE_KEY = "prompt_lifecycle"

// ─── Business Rule Engine (engine-business-rule) ─────────────────────────
// Reuses module_registry/module_rule_configs (Wave 21) -- see
// drizzle/0263's seeded platform defaults -- for storage, but DELIBERATELY
// PLATFORM-ONLY, unlike every other module_rule_configs consumer.
//
// Corrective fix (PR #561 audit, AUDIT: FAIL, 2026-07-26): the original
// version of this file resolved these thresholds through module-rules-
// resolver.ts's org/project/client override chain, keyed on the acting
// user's own orgId, exactly like an ordinary org-scoped module rule. That
// was a real cross-tenant privilege-escalation bug: prompt_templates/
// prompt_versions/prompt_eval_runs are platform-wide, global-read catalogs
// with NO orgId column at all (see prompt-os-service.ts's own header and
// schema.ts's comments on those tables -- "prompt content is a
// platform-governed asset... only service_role may write"), so there is no
// such thing as "this org's" canary duration or eval-pass-rate requirement.
// Any org's own rank-5 'admin' could call setModuleRule() (module-rule-
// service.ts, scope_type='org', gated only on hasRole(dbUser,'admin')) to
// zero out min_canary_duration_hours/min_eval_pass_rate for their own org,
// after which a same-org veridian_admin (rank 6) could promote ANY
// platform-wide prompt template straight to Production, bypassing the
// canary/eval gates every other tenant relies on for that same shared
// content -- not merely weakening their own org's data.
//
// getPromptLifecycleRule() below therefore reads ONLY the scope_type=
// 'platform' row (never org/project/client/user) -- setModuleRule()'s own
// WRITABLE_SCOPE_TYPES set (module-rule-service.ts) can never write
// scope_type='platform' in the first place (only a migration/service_role
// can), so this is a genuine floor, not a role check that could itself be
// routed around. If a future requirement genuinely needs per-org
// customization of these thresholds, the correct fix is giving
// prompt_templates/prompt_versions/prompt_eval_runs a real orgId column
// first (making the underlying resource actually org-scoped) -- resolving
// a shared resource's gates through a per-org override chain is the bug,
// not an acceptable tradeoff.
export type PromptLifecycleRuleKey = "min_eval_pass_rate" | "min_canary_duration_hours" | "eval_daily_budget_usd"

// Mirrors drizzle/0263's seeded platform-scope values -- used only if the
// platform row is somehow missing (e.g. this migration hasn't been applied
// yet in a given environment), never silently overriding a real seeded row.
const RULE_FALLBACK_DEFAULTS: Record<PromptLifecycleRuleKey, number> = {
  min_eval_pass_rate: 0.8,
  min_canary_duration_hours: 24,
  eval_daily_budget_usd: 5,
}

function coerceRuleNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
    const v = (raw as Record<string, unknown>).value
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return fallback
}

/**
 * Resolves a prompt-lifecycle business-rule threshold. PLATFORM-ONLY (see
 * this section's header comment above) -- reads ONLY the scope_type=
 * 'platform' module_rule_configs row (drizzle/0263's seeded defaults),
 * never module-rules-resolver.ts's org/project/client override chain.
 * Takes no orgId/scope parameter at all -- there is no per-org variant of
 * this value to resolve.
 */
export async function getPromptLifecycleRule(ruleKey: PromptLifecycleRuleKey): Promise<number> {
  const fallback = RULE_FALLBACK_DEFAULTS[ruleKey]
  const platformRow = await db.query.moduleRuleConfigs.findFirst({
    where: and(
      eq(moduleRuleConfigs.moduleKey, MODULE_KEY),
      eq(moduleRuleConfigs.ruleKey, ruleKey),
      eq(moduleRuleConfigs.scopeType, "platform"),
      eq(moduleRuleConfigs.isActive, true)
    ),
  })
  return platformRow ? coerceRuleNumber(platformRow.ruleValue, fallback) : fallback
}

// ─── Audit Engine (engine-audit) ─────────────────────────────────────────
// Extends the existing audit_logs mechanism (src/lib/audit.ts's
// logActivity(), the same table recordAuditTrigger() already writes
// "new_prompt" CHANGE events into) to lifecycle-transition and
// eval-EXECUTION events -- the "not ACCESS or EXECUTION events" gap the
// gap analysis flagged. Deliberately calls logActivity() directly rather
// than recordAuditTrigger(): the latter is scoped to D15.B2.S1's fixed
// 9-event registry (audit-event-triggers.ts), which "new_prompt" already
// belongs to for version CREATION -- a lifecycle transition or an eval run
// is a different, real event shape that free-text `action` already
// supports without needing a 10th named D15 event invented here.
export async function recordPromptGovernanceEvent(
  tx: TenantDb,
  params: { orgId: string; dbUser: typeof users.$inferSelect; action: string; entityId: string; details: string }
): Promise<void> {
  await logActivity({
    tx, orgId: params.orgId, dbUser: params.dbUser,
    action: params.action, entityType: "prompt_version", entityId: params.entityId, details: params.details,
  })
}

// ─── Compliance Engine (engine-compliance, prompt-lifecycle sense) ───────
// "GDPR/HIPAA/SOC2 compliance management for prompt content" -- deliberately
// NOT the product's own compliance-tracking business domain (rejected as a
// naming trap by the gap analysis). Deterministic, regex-based PII
// detection (no LLM call, matching this codebase's confidence-banding.ts/
// policy-enforcement-engine.ts posture of pure deterministic gates) --
// blocks promotion to Production of content containing likely PII rather
// than a data-classification platform.
export type PiiScanResult = { clean: boolean; findings: string[] }

// Standard credit-card Luhn checksum (ISO/IEC 7812-1). Applied only to
// digit runs already shaped like a card number (13-19 digits, the real
// range every card network uses, optionally separated by spaces/hyphens --
// matching PCI DSS's own definition of a PAN) -- narrows the prior bare
// `\b(?:\d[ -]?){13,16}\b` regex, which matched almost any long digit run
// (order/ticket/reference IDs, hashes, concatenated dates) and would
// false-positive-block legitimate Production promotions (PR #561 audit
// finding). A Luhn-invalid digit run is never a real card number, so
// rejecting those removes a large class of false positives without
// weakening real detection -- every real card number is Luhn-valid by
// construction.
function isLuhnValid(digitsOnly: string): boolean {
  let sum = 0
  let doubleNext = false
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let digit = digitsOnly.charCodeAt(i) - 48
    if (doubleNext) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleNext = !doubleNext
  }
  return sum % 10 === 0
}

const CARD_CANDIDATE_PATTERN = /\b(?:\d[ -]?){13,19}\b/g

function containsLuhnValidCardNumber(content: string): boolean {
  const candidates = content.match(CARD_CANDIDATE_PATTERN) ?? []
  for (const candidate of candidates) {
    const digitsOnly = candidate.replace(/[ -]/g, "")
    if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && isLuhnValid(digitsOnly)) return true
  }
  return false
}

const PII_PATTERNS: Array<{ label: string; test: (content: string) => boolean }> = [
  { label: "email address", test: (c) => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(c) },
  { label: "US Social Security Number", test: (c) => /\b\d{3}-\d{2}-\d{4}\b/.test(c) },
  { label: "credit card number", test: containsLuhnValidCardNumber },
  { label: "phone number", test: (c) => /\b(?:\+?\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/.test(c) },
]

export function scanPromptContentForPii(content: string): PiiScanResult {
  const findings: string[] = []
  for (const { label, test } of PII_PATTERNS) {
    if (test(content)) findings.push(label)
  }
  return { clean: findings.length === 0, findings }
}

// ─── Governance Engine (engine-governance, prompt-lifecycle sense) ───────
// "Ownership tracking, stewardship assignment" -- promptTemplates.ownerId
// (drizzle/0263), a real column, not a doc convention. No Production
// promotion is allowed for a template with no assigned owner (see
// requireProductionReadiness below).
export async function assignPromptTemplateOwner(
  ctx: { userId: string; dbUser: typeof users.$inferSelect },
  input: { templateId: string; ownerId: string }
) {
  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.id, input.templateId) })
  if (!template) throw new ServiceError("Unknown prompt template", 404)
  const owner = await db.query.users.findFirst({ where: eq(users.id, input.ownerId) })
  if (!owner) throw new ServiceError("Unknown ownerId -- must be a real user", 400)

  const [row] = await db.update(promptTemplates).set({ ownerId: input.ownerId, updatedAt: new Date() })
    .where(eq(promptTemplates.id, input.templateId)).returning()
  return { id: row.id, templateKey: row.templateKey, ownerId: row.ownerId }
}

// ─── Dependency Engine (engine-dependency) ───────────────────────────────
// "Required module identification and dependency graph management for
// prompts." WIRING_ENGINE_REGISTRY_2026-07-25.json (claude-control) is a
// real dependency graph but has no "prompt" entity type and lives in a
// config-only repo with no application code -- rather than duplicating it
// with a second, static, drift-prone registry, this computes the real edge
// list live from source: every resolvePromptTemplate(templateKey) call
// site in the actual application tree. Deliberately server-only / not a hot
// path (governance UI use only), plain fs scan -- no shelling out to grep
// with interpolated input, which would be a command-injection surface for
// no real benefit here.
import { readdirSync, readFileSync, type Dirent } from "node:fs"
import { join } from "node:path"

const DEPENDENCY_SCAN_ROOT = join(process.cwd(), "src")
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"])
const SCAN_IGNORE_DIRS = new Set(["node_modules", ".next", "dist"])

function* walkSourceFiles(dir: string): Generator<string> {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SCAN_IGNORE_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkSourceFiles(full)
    } else if (SCAN_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      yield full
    }
  }
}

export type PromptDependent = { file: string }

/**
 * Real, live-computed list of source files that call
 * resolvePromptTemplate("<templateKey>") (or the equivalent template-literal
 * form) -- the actual "which module depends on this prompt" graph edge.
 * Advisory only (surfaced on the transition response so an operator can see
 * blast radius before promoting) -- not itself a blocking gate, matching
 * the requirement's own "identification and graph management" framing
 * rather than an enforcement one.
 */
export function getPromptTemplateDependents(templateKey: string): PromptDependent[] {
  const needle = `"${templateKey}"`
  const needleAlt = `'${templateKey}'`
  const dependents: PromptDependent[] = []
  try {
    for (const file of walkSourceFiles(DEPENDENCY_SCAN_ROOT)) {
      // Excludes this module's own file (its docstrings mention
      // resolvePromptTemplate() literally) and any *.test.ts(x) fixture
      // (a test asserting against a templateKey string is not a real
      // application dependency on that prompt) -- both would otherwise
      // false-positive as "dependents".
      if (file.endsWith("prompt-governance-service.ts") || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue
      let content: string
      try {
        content = readFileSync(file, "utf8")
      } catch {
        continue
      }
      if (!content.includes("resolvePromptTemplate(")) continue
      if (content.includes(needle) || content.includes(needleAlt)) {
        dependents.push({ file: file.slice(process.cwd().length + 1) })
      }
    }
  } catch {
    // Best-effort: an unreadable source tree (e.g. restricted sandbox) means
    // an empty dependency list, never a thrown error blocking a governance
    // read.
    return []
  }
  return dependents
}

// ─── Cost Optimization Engine (engine-cost-optimization) ─────────────────
// Deepens llm-client.ts's estimateCostUsd() from a per-call estimator into
// a real cumulative BUDGET GUARDRAIL -- the gap analysis's own confirmed
// remaining gap ("no per-prompt-registry BUDGET GUARDRAIL... that blocks/
// warns before an over-budget prompt executes"). Distinct from
// ai-team/cost-policy.ts (that file's MAX_COST_PER_CALL_USD/
// checkOpenRouterBalance guard the platform's own AI-router spend, a
// different budget domain) -- this guards prompt_eval_runs spend
// specifically, using the SAME estimateCostUsd() pricing table, not a
// second pricing model.
export type EvalBudgetDecision = { allowed: boolean; reason?: string; spentTodayUsd: number; budgetUsd: number }

// Deliberately takes no model/usage: the about-to-run call's OWN cost is
// unknown until after it completes (usage isn't known pre-call, and
// estimateCostUsd() needs usage), so this guardrail -- like
// checkOpenRouterBalance()'s cumulative check in ai-team/cost-policy.ts --
// is a pre-check purely against ALREADY-accumulated spend (the sum of
// promptEvalRuns.estimatedCostUsd, each value itself produced by
// estimateCostUsd() at the end of a prior runEval() call). Not a duplicate
// of cost-policy.ts's per-call MAX_COST_PER_CALL_USD check -- a genuinely
// different guard (cumulative vs. single-call), scoped to a different
// spend domain (prompt evals vs. the platform's own AI-router calls).
//
// Takes no orgId: spend is aggregated globally across prompt_eval_runs (the
// table has no orgId column -- it's a platform-wide shared pool, see
// prompt-os-service.ts's header), and getPromptLifecycleRule() is now
// PLATFORM-ONLY for the same reason (see this file's Business Rule Engine
// header comment) -- the original org-parameterized version of this
// function let one org's setModuleRule() override inflate/distort the
// shared budget every other org drew against (PR #561 audit finding).
export async function checkPromptEvalBudget(): Promise<EvalBudgetDecision> {
  const budgetUsd = await getPromptLifecycleRule("eval_daily_budget_usd")

  const spentRow = await db
    .select({ total: sql<string>`coalesce(sum(${promptEvalRuns.estimatedCostUsd}), 0)` })
    .from(promptEvalRuns)
    .where(and(eq(promptEvalRuns.status, "completed"), gte(promptEvalRuns.createdAt, startOfTodayUtc())))
  const spentTodayUsd = Number(spentRow[0]?.total ?? 0)

  if (spentTodayUsd >= budgetUsd) {
    return {
      allowed: false,
      reason: `Prompt eval daily budget exhausted: $${spentTodayUsd.toFixed(4)} already spent today against a $${budgetUsd} cap. Raise module_rule_configs 'eval_daily_budget_usd' (moduleKey='prompt_lifecycle') to run more evals today.`,
      spentTodayUsd, budgetUsd,
    }
  }
  return { allowed: true, spentTodayUsd, budgetUsd }
}

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// ─── Policy Engine (engine-policy, prompt-lifecycle sense) ───────────────
// Reuses abac.ts/abac-policy-service.ts's real deny-only ABAC overlay
// (resourceType='prompt_version') rather than a bespoke content/brand-voice
// rule language. An org can define a deny policy on
// {resourceType:'prompt_version', action:'promote_production'|
// 'promote_staging'} keyed on any attribute this function supplies.
//
// Known, INTENTIONAL architectural limitation (PR #561 audit, carried
// as-documented rather than "fixed" -- see this function's own analysis
// below for why a full fix is out of scope here): abac_policies is a
// genuinely org-scoped table (abacPolicies.orgId NOT NULL, RLS-enforced,
// the single general-purpose ABAC overlay every other resource in this
// codebase -- including genuinely org-owned resources like
// approval_workflow/erp_payment_entry -- already uses) evaluated here
// against a platform-wide resource (prompt_version) that has no real org
// ownership. The result: the SAME transition on the SAME shared prompt
// version can be allowed or denied differently depending on which acting
// org's independently-configured deny policies happen to apply -- e.g. Org
// A's compliance team can require its own admins to clear an extra deny
// gate before promoting shared content that Org B's admins can promote
// unimpeded. This is judged ACCEPTABLE, not a bug, for two reasons: (1) it
// is deny-only (abacEffectEnum defaults to 'deny', no 'allow' effect
// exists anywhere in this system -- see abac-policy-service.ts's own
// header), so the asymmetry can only let an org impose STRICTER limits on
// its own actors, never grant one org's actor a permission another org's
// identical actor lacks -- the actual privilege-escalation direction this
// whole PR exists to close stays closed; (2) giving prompt_version a real
// platform-scoped ABAC concept (a policy that applies to every org's
// actors uniformly) would be a genuine new ABAC capability -- a
// scope_type='platform' policy row plus resolution-chain changes touching
// every other ABAC consumer in this codebase, not a one-function fix --
// and is out of this PR's scope. If a future requirement needs coherent,
// org-independent policy enforcement on prompt-lifecycle transitions, add
// that as a real platform-scope ABAC capability rather than special-casing
// prompt_version's org resolution here.
export async function checkPromptPolicyDeny(
  tx: TenantDb,
  orgId: string,
  params: { action: "promote_staging" | "promote_production"; templateKey: string; fromState: string; toState: string }
): Promise<void> {
  const result = await checkAbacDenyPoliciesWithDb(tx, orgId, {
    resourceType: "prompt_version",
    action: params.action,
    attributes: { templateKey: params.templateKey, fromState: params.fromState, toState: params.toState },
  })
  if (result.denied) throw new ServiceError(`Denied by policy engine: ${result.reason}`, 403)
}

// ─── governance-lifecycle-state-machine: the orchestrating gate ─────────
// Called by prompt-os-service.ts's transitionPromptLifecycle() for every
// transition the bare state machine (phase_1) already confirmed is
// structurally legal. Composes every engine above; fails closed (throws
// ServiceError) on the first violated gate. Read-only for Draft<->Review
// transitions (no eval/canary/compliance/governance/policy requirement --
// those gates apply specifically to the promotions the requirement text
// names: "automated eval gates (Review->Staging), minimum canary duration
// (Staging->Production)").
export type LifecycleTransitionGateInput = {
  versionId: string
  templateId: string
  templateKey: string
  content: string
  createdById: string | null
  fromState: string
  toState: string
  stagingEnteredAt: Date | null
  actingUserId: string
  actingOrgId: string | null
}

export type LifecycleTransitionGateResult = {
  dependents: PromptDependent[]
  setApproval: boolean
  setStagingEnteredAt: boolean
}

export async function runLifecycleTransitionGates(tx: TenantDb, input: LifecycleTransitionGateInput): Promise<LifecycleTransitionGateResult> {
  const isPromotion = input.toState === "Staging" || input.toState === "Production"
  const dependents = getPromptTemplateDependents(input.templateKey)

  if (!isPromotion) {
    return { dependents, setApproval: false, setStagingEnteredAt: false }
  }

  // Maker-checker: the approver of a promotion may not be the same person
  // who authored the version being promoted -- the concrete substance of
  // "approval gates" the requirement text names, not just a role check.
  if (input.createdById && input.createdById === input.actingUserId) {
    throw new ServiceError(
      `Approval gate: ${input.actingUserId} authored this version and cannot also approve its promotion to ${input.toState} (maker-checker).`,
      403
    )
  }

  if (input.toState === "Staging") {
    const passRate = await computeEvalPassRate(input.versionId)
    const threshold = await getPromptLifecycleRule("min_eval_pass_rate")
    if (passRate === null) {
      throw new ServiceError(`Business rule gate: version has no completed eval runs -- at least one is required before Review -> Staging.`, 403)
    }
    if (passRate < threshold) {
      throw new ServiceError(`Business rule gate: eval pass rate ${(passRate * 100).toFixed(1)}% is below the required ${(threshold * 100).toFixed(1)}% for Review -> Staging.`, 403)
    }
  }

  if (input.toState === "Production") {
    const canaryHours = await getPromptLifecycleRule("min_canary_duration_hours")
    if (!input.stagingEnteredAt) {
      throw new ServiceError(`Business rule gate: version has no recorded Staging entry time -- cannot verify the ${canaryHours}h canary duration.`, 403)
    }
    const elapsedHours = (Date.now() - input.stagingEnteredAt.getTime()) / (1000 * 60 * 60)
    if (elapsedHours < canaryHours) {
      throw new ServiceError(`Business rule gate: version has been in Staging for ${elapsedHours.toFixed(1)}h, below the required ${canaryHours}h canary duration.`, 403)
    }

    const pii = scanPromptContentForPii(input.content)
    if (!pii.clean) {
      throw new ServiceError(`Compliance gate: content appears to contain PII (${pii.findings.join(", ")}) -- redact before promoting to Production.`, 403)
    }

    const template = await tx.query.promptTemplates.findFirst({ where: eq(promptTemplates.id, input.templateId) })
    if (!template?.ownerId) {
      throw new ServiceError(`Governance gate: prompt template has no assigned owner -- assign a steward (prompt.template.assign_owner) before promoting to Production.`, 403)
    }
  }

  if (input.actingOrgId) {
    await checkPromptPolicyDeny(tx, input.actingOrgId, {
      action: input.toState === "Staging" ? "promote_staging" : "promote_production",
      templateKey: input.templateKey, fromState: input.fromState, toState: input.toState,
    })
  }

  return { dependents, setApproval: true, setStagingEnteredAt: input.toState === "Staging" }
}

async function computeEvalPassRate(promptVersionId: string): Promise<number | null> {
  const runs = await db.query.promptEvalRuns.findMany({
    where: and(eq(promptEvalRuns.promptVersionId, promptVersionId), eq(promptEvalRuns.status, "completed")),
  })
  if (runs.length === 0) return null
  const passed = runs.filter((r) => r.passed === true).length
  return passed / runs.length
}
