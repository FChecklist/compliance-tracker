// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, Phase C):
// the Auditor -> Higher AI loop. capability-learning-service.ts persists
// WHAT the platform has learned (rolling FULL_SOFTWARE/PACKAGE_AVAILABLE/
// NOVEL history per capability); this file is what actually ACTS on a
// capability that keeps needing AI -- asking the EXISTING chief_audit_officer
// role ("Auditor AI", per the tracker's owner_confirmed_decisions -- not a
// new role) whether the gap is closable in software, and if so, routing a
// real TightTask to the EXISTING AI Dev Team engineering pipeline
// ("Higher AI", dispatched via dispatch-repo.ts -> ai-workforce-agent.mjs,
// also not a new mechanism). The whole point: every NOVEL/PACKAGE_AVAILABLE
// classification is a learning signal, and the Auditor spends real LLM
// budget on it AT MOST ONCE PER CAPABILITY VERSION -- shouldAuditCapability()
// below is that gate, and it is the single most important invariant in this
// file (see its own comment + the unit tests).
//
// Design decisions made in this file that the tracker's spec left to the
// implementer's judgment (documented here, not just in the PR description,
// so the reasoning travels with the code):
//
//   1. The Auditor is called via runRole("chief_audit_officer", ...) exactly
//      as the spec's own dispatch text says -- NOT via the org-scoped
//      resolveModelConfig()+callLLMJson() pattern that instruction-mismatch-
//      audit.ts/loop-engineering-audit.ts use. Those audit an ORG's task
//      activity against an org's own configured task_oa model; this audits
//      the PLATFORM's own capability-coverage gaps, which is exactly the
//      class of work team-service.ts's own header reserves for the AI Dev
//      Team's platform OpenRouter key ("the AI Dev Team builds VERIDIAN, it
//      doesn't run inside it"). Consequence: runRole() has no jsonMode
//      option (only callLLM/callLLMJson do), so this file asks for a
//      trailing fenced ```json block in the prompt and parses it itself
//      (parseAuditVerdict()) rather than trusting response_format to a
//      role whose prompt-OS template this file doesn't own or control.
//
//   2. dispatchProposalToHigherAI() is its own exported function, not
//      inlined into runCapabilityAudit(), even though the spec describes
//      them as one flow. Splitting it out means a failed dispatch never
//      corrupts the audit's own state (the proposal stays 'open', the
//      capability stays needsImprovement='yes') and the Super Boss (or a
//      cron) can retry the dispatch alone by proposal id, without
//      re-spending an Auditor LLM call.
//
//      UPDATE (Priority 12/OPEN-07 decision a, Owner directive 2026-07-14):
//      this used to call dispatch-repo.ts's dispatchRepoTask(), which fires
//      a GitHub repository_dispatch event requiring GITHUB_DISPATCH_PAT --
//      never configured on Vercel, confirmed never fired from the deployed
//      app. Switched to advisory-dispatch-service.ts's dispatchAdvisoryTask(),
//      the same advisory-only runRole() + tier-eligibility + GUARDRAIL_PLATFORM
//      path /api/ai/team/dispatch already uses for a human veridian_admin --
//      no GitHub PAT required. This is advisory-only, not repo-write: it
//      does not open a PR by itself, so the model's advisory output is now
//      persisted to capabilityImprovementProposals.dispatchOutput
//      (drizzle/0189) as the real, queryable artifact a human reviews and
//      acts on (writing the actual code change themselves, or dispatching a
//      separate repo-write role) before calling closeImprovementLoop().
//
//   3. mapFindingsToRole() only ever routes to ENGINEERING-team roles
//      confirmed to exist in roster.ts, on models confirmed 'integrative'-
//      tier eligible in model-tier-eligibility.ts (every dispatch from this
//      file uses complexityTier: 'integrative' -- closing a capability gap
//      always means understanding an existing Dynamic Chain / mode-pill /
//      task-execution-engine.ts concept first, never a from-scratch
//      single-file op, matching 'integrative''s own stated definition).
import { db, taskCapabilities, instructionPackages, capabilityImprovementProposals } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { runRole } from "@/lib/ai-team/team-service"
import { dispatchAdvisoryTask } from "@/lib/ai-team/advisory-dispatch-service"
import type { TightTask } from "@/lib/task-tightening"
import { ServiceError, type TaskCapability, computeCoverageStats, type CoverageStats } from "./capability-learning-service"
// Priority 6 (UMR <-> Software Orchestrator integration): before Higher AI
// is asked to build something net-new, check whether the Universal
// Metadata Registry already has a matching platform asset that's simply
// unwired. queryByKeywords() is the tsvector-GIN-backed search
// asset-query-service.ts exposes (see that file's own header); reused
// as-is here rather than duplicated, same "reuse the existing index-backed
// query layer" discipline this file already follows for capability-
// learning-service.ts's lookups. registerAsset/getAssetBySource/updateAsset
// are the UMR write primitives closeImprovementLoop() below uses to avoid
// creating a duplicate platform_assets row for a capability whose fix
// turned out to be "wire up an asset that already existed."
import { queryByKeywords, type PlatformAsset } from "./asset-query-service"
import { registerAsset, getAssetBySource, updateAsset, type AssetType } from "./asset-registry-service"

export { ServiceError }

export type CapabilityImprovementProposal = typeof capabilityImprovementProposals.$inferSelect

// ─── Findings shape (the spec's exact list) ────────────────────────────────

export type AuditFindings = {
  missingFunction?: string
  missingWorkflow?: string
  missingBusinessRule?: string
  missingReport?: string
  missingConfiguration?: string
  missingModePill?: string
  missingChainOption?: string
  missingMetadata?: string
  missingValidation?: string
  missingScreen?: string
  missingApi?: string
}

const FINDING_KEYS: (keyof AuditFindings)[] = [
  "missingApi", "missingBusinessRule", "missingFunction", "missingWorkflow", "missingValidation",
  "missingReport", "missingConfiguration", "missingMetadata", "missingModePill", "missingChainOption", "missingScreen",
]

export type AuditVerdict = {
  fixableInSoftware: boolean
  findings: AuditFindings
  reasoning?: string
}

// ─── 1. Auditor trigger gate (pure) ────────────────────────────────────────
//
// "Once per Capability Version": the Auditor may look at a given
// (capability, version) pair exactly once. Two conditions block a re-audit:
//   - needsImprovement === 'in_progress' -- a proposal from a PRIOR audit of
//     this same version is already dispatched to Higher AI and awaiting a
//     PR; auditing again before that resolves would just re-discover the
//     same gap and burn a second LLM call on it.
//   - lastAuditedVersion === version -- this exact version has already been
//     judged (either "yes, fixable" -- which is what put it in_progress
//     above -- or "no, genuinely needs judgment"). Either verdict stands
//     until the version changes (closeImprovementLoop() bumps it after a
//     real PR merges), not until someone asks again.
// lastAuditedVersion === null means never audited at all -- always allowed
// (subject to the in_progress check, which can't be true yet on a capability
// that's never been audited, but the check order stays explicit either way).
export function shouldAuditCapability(
  capability: Pick<TaskCapability, "needsImprovement" | "lastAuditedVersion" | "version">
): boolean {
  if (capability.needsImprovement === "in_progress") return false
  return capability.lastAuditedVersion === null || capability.lastAuditedVersion !== capability.version
}

// ─── Prompt construction (pure) ────────────────────────────────────────────

export function buildAuditPrompt(
  capability: Pick<TaskCapability, "capabilityKey" | "modePill" | "pathKeys" | "version">,
  stats: CoverageStats,
  sampleLines: string[] = []
): string {
  const lines = [
    `Capability under review: "${capability.capabilityKey}" (version ${capability.version})`,
    `Mode pill: ${capability.modePill ?? "(none)"}`,
    `Path keys: ${JSON.stringify(capability.pathKeys ?? [])}`,
    "",
    `Recent classification history (rolling counts across ${stats.total} observed request(s)): ` +
      `${stats.fullSoftwarePercent}% required zero AI reasoning (FULL_SOFTWARE), ` +
      `${stats.packageAvailablePercent}% were handled by an approved cheap-model instruction package (PACKAGE_AVAILABLE), ` +
      `${stats.novelPercent}% required a judgment-tier model reasoning fresh (NOVEL).`,
  ]

  if (sampleLines.length > 0) {
    lines.push("", "What the AI has actually had to do for this capability recently:", ...sampleLines.map((l) => `- ${l}`))
  }

  lines.push(
    "",
    "Question: can this task/capability be completed 100% by software -- zero AI reasoning required at request " +
      "time -- either as it stands today or with a well-defined, buildable addition? If yes, name exactly what is " +
      "missing using one or more of these categories: a function, a workflow, a business rule, a report, a " +
      "configuration, a mode pill, a chain option, a piece of metadata, a validation rule, a screen, or an API. " +
      "Give each named gap in concrete, specific terms -- what file/module/behavior it belongs to and what it must " +
      "do -- not a vague category label alone. If the gap genuinely requires case-by-case human or AI judgment and " +
      "cannot be closed in software, say so plainly and set fixableInSoftware to false.",
    "",
    "Respond with your reasoning first, then end your reply with exactly one fenced json code block in this shape " +
      "(omit any missing* key that does not apply; every included value must be a concrete, specific sentence, not " +
      "a placeholder):",
    "```json",
    '{"fixableInSoftware": true, "findings": {"missingValidation": "concrete description here"}, "reasoning": "one paragraph"}',
    "```"
  )

  return lines.join("\n")
}

// Best-effort context: this codebase keeps no per-call execution-history
// log (recordExecutionOutcome() only increments rolling counters), so the
// two real, honest signals available are the capability's accumulated
// prompt-phrasing tokens (what requests actually looked like) and any
// instruction packages Higher AI has already authored for it (what the
// work actually involved) -- never fabricated, both from real persisted
// state or an explicit "(none)" when absent.
function summarizeSampleLines(capability: TaskCapability, packages: { packageType: string; steps: unknown }[]): string[] {
  const lines: string[] = []
  const tokens = (capability.promptWordIndex as string[] | null) ?? []
  if (tokens.length > 0) {
    lines.push(`Recurring request phrasing tokens: ${tokens.slice(0, 20).join(", ")}`)
  }
  for (const pkg of packages.slice(0, 2)) {
    const stepsPreview = JSON.stringify(pkg.steps).slice(0, 400)
    lines.push(`Existing "${pkg.packageType}" instruction package steps: ${stepsPreview}`)
  }
  return lines
}

// ─── Verdict parsing (pure) ────────────────────────────────────────────────
//
// runRole() has no jsonMode -- see module header decision #1. Tries a
// fenced ```json block first (what the prompt above explicitly asks for),
// then falls back to a balanced-brace scan for a bare JSON object anywhere
// in the reply, so a model that skips the fence but still answers in JSON
// isn't punished. Returns null (never throws) on anything unparseable --
// callers treat a null verdict conservatively (see runCapabilityAudit()).
export function parseAuditVerdict(content: string): AuditVerdict | null {
  if (!content?.trim()) return null

  const fenced = content.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : extractBalancedJsonObject(content)
  if (!candidate) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.trim())
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.fixableInSoftware !== "boolean") return null

  const findings: AuditFindings = {}
  if (obj.findings && typeof obj.findings === "object" && !Array.isArray(obj.findings)) {
    for (const key of FINDING_KEYS) {
      const value = (obj.findings as Record<string, unknown>)[key]
      if (typeof value === "string" && value.trim()) findings[key] = value.trim()
    }
  }

  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : undefined
  return { fixableInSoftware: obj.fixableInSoftware, findings, reasoning }
}

// Finds the first top-level `{...}` in text via brace counting -- avoids
// truncating at a nested closing brace the way a naive lastIndexOf('}')
// or non-greedy regex would.
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// ─── Higher AI role routing (pure) ─────────────────────────────────────────
//
// A small, explicit, deterministic map from a finding category to a real
// ENGINEERING-team roster.ts role -- backend-shaped findings (a missing
// function/workflow/business rule/validation/API) go to the Senior Backend
// Engineer; a missing report goes to the Full Stack Developer (spans data +
// display); a missing configuration/metadata field goes to the DevOps/Data
// Engineer (owns schema/config surfaces); anything UI-shaped (a mode pill,
// a chain option, a screen) goes to the Frontend Engineer. When a verdict
// names more than one category, FINDING_KEYS' fixed order picks a single
// primary role rather than fanning one proposal out across multiple
// dispatches -- keeps the loop (one proposal -> one PR -> one close-out)
// simple and traceable.
const FINDING_ROLE_MAP: Record<keyof AuditFindings, string> = {
  missingApi: "senior_backend_engineer",
  missingBusinessRule: "senior_backend_engineer",
  missingFunction: "senior_backend_engineer",
  missingWorkflow: "senior_backend_engineer",
  missingValidation: "senior_backend_engineer",
  missingReport: "fullstack_developer",
  missingConfiguration: "devops_engineer",
  missingMetadata: "devops_engineer",
  missingModePill: "frontend_engineer",
  missingChainOption: "frontend_engineer",
  missingScreen: "frontend_engineer",
}

/** Returns null when findings has no recognized key -- caller must treat that as "nothing to route." */
export function mapFindingsToRole(findings: AuditFindings): string | null {
  for (const key of FINDING_KEYS) {
    if (findings[key]) return FINDING_ROLE_MAP[key]
  }
  return null
}

// ─── UMR cross-check (Priority 6: UMR <-> Software Orchestrator integration) ──
//
// The Auditor->Higher AI loop and the Universal Metadata Registry
// (platform_assets, Priority 3-4) were built in adjacent priorities and
// never talked to each other -- this section is the fix. Before proposing
// net-new work, check whether platform_assets already has a matching
// computation_engine row (247 exist per the Priority 3-4 backfill; 36 of
// them are 'partial'/'not_started' and an unverified number of the
// remaining 'implemented' rows may still have no real `case` in
// task-execution-engine.ts's dispatchEngine() switch -- exactly the "built
// but unwired" gap this check exists to catch). A match never blocks or
// skips the Higher AI dispatch -- it only changes what's asked for (see
// buildTightTaskFromFindings()'s umrCandidate param below): "wire up /
// verify this existing asset" instead of a silent from-scratch build
// request.
export type ExistingAssetMatch = Pick<PlatformAsset, "assetId" | "name" | "sourceTable" | "sourceId" | "assetType">

// Concatenates every concrete finding description the Auditor actually
// wrote (never the bare category key alone) into one search string for
// queryByKeywords()'s tsvector match -- same "quote the concrete text, not
// the category label" discipline buildTightTaskFromFindings() already
// follows below.
export function buildUmrSearchQuery(findings: AuditFindings): string {
  return FINDING_KEYS.map((k) => findings[k]).filter((v): v is string => Boolean(v)).join(" ")
}

// Pure decision over an already-fetched candidate list: is there a strong
// enough match here to note on the proposal? Deliberately narrow --
// active computation_engine rows only, matching this integration's own
// stated scope (an existing catalog entry that's merely unwired, not any
// vaguely-related platform object). queryByKeywords() already orders by
// ts_rank, so the first matching row is the strongest textual match in the
// set.
export function pickExistingAssetMatch(candidates: PlatformAsset[]): ExistingAssetMatch | null {
  const match = candidates.find((a) => a.assetType === "computation_engine" && a.status === "active")
  if (!match) return null
  return { assetId: match.assetId, name: match.name, sourceTable: match.sourceTable, sourceId: match.sourceId, assetType: match.assetType }
}

// Platform-tier UMR search context. computation_engine assets are always
// platform-tier (orgId null -- see asset-registry-service.ts's own header
// on registerAsset()'s convention for that type), so queryByKeywords()'s
// `orgId = ctx.orgId OR orgId IS NULL` clause finds them no matter what
// string is passed here; this constant exists only to satisfy
// AssetQueryContext's required orgId field for a genuinely platform-wide
// audit caller (task_capabilities has no single owning org), never as a
// real tenant scope.
const PLATFORM_AUDIT_QUERY_ORG_ID = "__platform_audit__"

/**
 * DB-touching UMR search. Never throws -- runCapabilityAudit() below treats
 * a lookup failure identically to genuinely finding no candidate (both
 * result in a plain net-new proposal), matching this file's own established
 * "a failed side-lookup degrades gracefully, it never blocks the primary
 * flow" posture (see dispatchProposalToHigherAI()'s own try/catch).
 */
export async function findExistingUmrCandidate(findings: AuditFindings): Promise<ExistingAssetMatch | null> {
  const query = buildUmrSearchQuery(findings)
  if (!query.trim()) return null
  const candidates = await queryByKeywords({ orgId: PLATFORM_AUDIT_QUERY_ORG_ID }, query)
  return pickExistingAssetMatch(candidates)
}

// Maps a finding category to the platform_assets assetType Priority 6's
// closeImprovementLoop() should register the closed capability as, when no
// existing UMR asset was found to update instead. Mirrors FINDING_ROLE_MAP's
// exact precedence-order technique (fixed FINDING_KEYS iteration order picks
// one primary type for a multi-finding verdict, same as mapFindingsToRole()).
const FINDING_ASSET_TYPE_MAP: Record<keyof AuditFindings, AssetType> = {
  missingApi: "api",
  missingBusinessRule: "rule",
  missingFunction: "function",
  missingWorkflow: "workflow",
  missingValidation: "rule",
  missingReport: "report",
  missingConfiguration: "other",
  missingMetadata: "other",
  missingModePill: "screen",
  missingChainOption: "dynamic_chain",
  missingScreen: "screen",
}

/** Returns 'other' when findings has no recognized key -- always a valid assetTypeEnum value, never a guess. */
export function pickAssetTypeForFindings(findings: AuditFindings): AssetType {
  for (const key of FINDING_KEYS) {
    if (findings[key]) return FINDING_ASSET_TYPE_MAP[key]
  }
  return "other"
}

// ─── TightTask assembly (pure) ─────────────────────────────────────────────
//
// Every field is built from the Auditor's own concrete finding text (never
// a generic placeholder) -- task-tightening.ts's validateTightTask() will
// reject placeholder/ambiguous language, so this deliberately quotes the
// finding's own description into objective/scope/successCriteria/
// expectedOutput rather than restating the category name alone.
// existingAssetMatch (Priority 6): optional, from findExistingUmrCandidate()
// -- when present, the objective/knownContext explicitly redirect Higher AI
// toward wiring/reusing the found asset instead of reading as a plain
// from-scratch build request. Never omits or softens the underlying
// gap/success-criteria -- the dispatch still genuinely asks for the gap to
// close, it just adds "check this first" context, matching this
// integration's own "never dispatch Higher AI to build something that
// already exists but is merely unwired" goal without ever blocking the
// dispatch itself.
export function buildTightTaskFromFindings(
  capability: Pick<TaskCapability, "capabilityKey" | "modePill" | "version">,
  findings: AuditFindings,
  stats: CoverageStats,
  existingAssetMatch?: ExistingAssetMatch | null
): TightTask {
  const entries = FINDING_KEYS.filter((k) => findings[k]).map((k) => `${k}: ${findings[k]}`)
  const findingsSummary = entries.join(" | ")

  const umrNote = existingAssetMatch
    ? ` A Universal Metadata Registry search found a possibly related existing platform asset: "${existingAssetMatch.name}" (${existingAssetMatch.assetType}, asset ${existingAssetMatch.assetId}, source ${existingAssetMatch.sourceTable}:${existingAssetMatch.sourceId}). Check whether this asset already implements the missing behavior and only needs to be wired into task-execution-engine.ts's dispatchEngine() switch (or an equivalent real call site) before writing anything new -- prefer wiring/extending a genuine match over a from-scratch build.`
    : ""

  return {
    objective: `Software-close a capability-coverage gap the Auditor identified for "${capability.capabilityKey}" (version ${capability.version}): ${findingsSummary}${umrNote}`,
    scope: `Implement the described addition inside the existing capability/mode-pill/Dynamic Chain surface that "${capability.capabilityKey}"` +
      `${capability.modePill ? ` (mode pill "${capability.modePill}")` : ""} already maps to -- do not touch unrelated capabilities or mode pills while doing this.`,
    successCriteria: `The specific gap described above no longer requires AI reasoning at request time -- a future request that previously classified as NOVEL or PACKAGE_AVAILABLE for "${capability.capabilityKey}" can classify as FULL_SOFTWARE or a reliable PACKAGE_AVAILABLE instead; typecheck and lint both pass.`,
    complexityTier: "integrative",
    expectedOutput: `A real code change (the specific function/workflow/business rule/report/configuration/mode pill/chain option/metadata/validation/screen/API named above) plus a PR description stating exactly what was added and how it closes this gap for "${capability.capabilityKey}".`,
    knownContext: `This capability is tracked in compliance.task_capabilities (capabilityKey="${capability.capabilityKey}"). Read src/lib/services/software-coverage-service.ts and src/lib/services/capability-learning-service.ts to see how capabilities are classified (FULL_SOFTWARE/PACKAGE_AVAILABLE/NOVEL) before extending anything, and src/lib/task-execution-engine.ts for how a Dynamic Chain resolves to a capability. Rolling history so far: ${stats.fullSoftwarePercent}% full-software, ${stats.packageAvailablePercent}% package-available, ${stats.novelPercent}% novel across ${stats.total} observed executions.`,
  }
}

// ─── DB-touching: audit run, proposal dedup, dispatch, close-out ──────────

/**
 * Priority 12 (OPEN-07 point 4, Owner directive 2026-07-14): before this,
 * runCapabilityAudit() had ZERO real callers anywhere in the deployed app --
 * no cron, no API route -- confirmed by grep. This is the query the new
 * cron route (/api/internal/capability-audit/run) uses to find real
 * candidates, mirroring shouldAuditCapability()'s own gate as a SQL
 * predicate (never re-selects a capability with an in-progress proposal or
 * one already audited at its current version) rather than fetching
 * everything and filtering in the app. `limit` bounds one run's LLM spend --
 * a cron sweeping thousands of capabilities in one pass would burn an
 * unbounded Auditor budget; ordering by lastAuditedAt (nulls/oldest first)
 * means every capability eventually gets a turn across repeated runs
 * instead of the same head-of-table rows winning every time.
 */
export async function findCapabilitiesDueForAudit(limit: number): Promise<TaskCapability[]> {
  return db.query.taskCapabilities.findMany({
    where: (t, { and, ne, or, isNull, sql: rawSql }) =>
      and(ne(t.needsImprovement, "in_progress"), or(isNull(t.lastAuditedVersion), rawSql`${t.lastAuditedVersion} != ${t.version}`)),
    orderBy: (t, { asc, sql: rawSql }) => asc(rawSql`${t.lastAuditedAt} nulls first`),
    limit,
  })
}

export type AuditRunResult =
  | { audited: false; reason: string }
  | { audited: true; needsImprovement: "no" }
  | { audited: true; needsImprovement: "yes"; proposalId: string; dispatch: DispatchResult }

/**
 * The Auditor's full turn for one capability: gate check, LLM call, verdict
 * parse, capability update, and (if fixable) proposal upsert + a best-effort
 * Higher AI dispatch attempt. Never spends an LLM call when
 * shouldAuditCapability() says no.
 */
export async function runCapabilityAudit(capabilityId: string): Promise<AuditRunResult> {
  const capability = await db.query.taskCapabilities.findFirst({ where: eq(taskCapabilities.id, capabilityId) })
  if (!capability) throw new ServiceError(`No capability found for ${capabilityId}`, 404)

  if (!shouldAuditCapability(capability)) {
    const reason =
      capability.needsImprovement === "in_progress"
        ? `Capability "${capability.capabilityKey}" already has a proposal in progress -- skipping re-audit.`
        : `Capability "${capability.capabilityKey}" version ${capability.version} was already audited -- skipping re-audit until the version changes.`
    return { audited: false, reason }
  }

  const stats = computeCoverageStats(capability.fullSoftwareCount, capability.packageAvailableCount, capability.novelCount)

  const recentPackages = await db.query.instructionPackages.findMany({
    where: eq(instructionPackages.capabilityId, capability.id),
    orderBy: (t, { desc }) => desc(t.updatedAt),
    limit: 2,
  })
  const sampleLines = summarizeSampleLines(capability, recentPackages)

  const prompt = buildAuditPrompt(capability, stats, sampleLines)
  const { content } = await runRole("chief_audit_officer", prompt)
  const verdict = parseAuditVerdict(content)

  const hasUsableFindings = Boolean(verdict?.fixableInSoftware && verdict.findings && FINDING_KEYS.some((k) => verdict.findings[k]))
  const needsImprovement: "yes" | "no" = hasUsableFindings ? "yes" : "no"

  await db
    .update(taskCapabilities)
    .set({ needsImprovement, lastAuditedAt: new Date(), lastAuditedVersion: capability.version, updatedAt: new Date() })
    .where(eq(taskCapabilities.id, capability.id))

  if (!hasUsableFindings) {
    if (verdict === null) {
      console.error(`[capability-audit] chief_audit_officer returned an unparseable verdict for capability ${capability.id} ("${capability.capabilityKey}") -- treating as not-fixable this version.`)
    }
    return { audited: true, needsImprovement: "no" }
  }

  // Priority 6: cross-check the UMR before proposing net-new work. Never
  // lets a lookup failure block the proposal -- degrades to "no candidate
  // found," identical to a genuine miss, same posture as
  // dispatchProposalToHigherAI()'s own try/catch around the Higher AI call.
  const existingAssetMatch = await findExistingUmrCandidate(verdict!.findings).catch((err) => {
    console.error(`[capability-audit] UMR lookup failed for capability ${capability.id} ("${capability.capabilityKey}") -- continuing without an existing-asset candidate:`, err)
    return null
  })
  if (existingAssetMatch) {
    console.warn(`[capability-audit] UMR candidate found for capability ${capability.id} ("${capability.capabilityKey}"): asset ${existingAssetMatch.assetId} ("${existingAssetMatch.name}") -- noting it on the proposal instead of blindly proposing net-new work.`)
  }

  const proposal = await upsertImprovementProposal(capability.id, capability.version, verdict!.findings, existingAssetMatch)
  const dispatch = await dispatchProposalToHigherAI(proposal.id)
  return { audited: true, needsImprovement: "yes", proposalId: proposal.id, dispatch }
}

/**
 * Finds an open proposal for (capabilityId, capabilityVersion) and
 * increments its occurrenceCount, or inserts a new one -- the schema's real
 * UNIQUE(capability_id, capability_version) constraint (migration 0156)
 * backs this as a true upsert rather than a check-then-insert race.
 * Deliberately does NOT overwrite `findings` OR `existingAssetMatch` on
 * conflict -- the spec's own words are "repeated identical findings
 * increment this", so an existing proposal's original finding text (and the
 * UMR candidate found alongside it, if any) is left standing; only the
 * counter and updatedAt move.
 */
export async function upsertImprovementProposal(
  capabilityId: string,
  capabilityVersion: number,
  findings: AuditFindings,
  existingAssetMatch: ExistingAssetMatch | null = null
): Promise<CapabilityImprovementProposal> {
  const [row] = await db
    .insert(capabilityImprovementProposals)
    .values({ capabilityId, capabilityVersion, findings, existingAssetMatch })
    .onConflictDoUpdate({
      target: [capabilityImprovementProposals.capabilityId, capabilityImprovementProposals.capabilityVersion],
      set: {
        occurrenceCount: sql`${capabilityImprovementProposals.occurrenceCount} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

export type DispatchResult =
  | { dispatched: true; roleKey: string }
  | { dispatched: false; reason: string }

/**
 * Attempts to dispatch an 'open' proposal to Higher AI. Separated from
 * runCapabilityAudit() (see module header decision #2) so a live-environment
 * dispatch failure (GITHUB_DISPATCH_PAT unset, per dispatch-repo.ts's own
 * documented current gap) never corrupts audit state -- the proposal stays
 * 'open' and this function can be called again later by hand once the PAT
 * is configured, without re-spending an Auditor LLM call.
 */
export async function dispatchProposalToHigherAI(proposalId: string): Promise<DispatchResult> {
  const proposal = await db.query.capabilityImprovementProposals.findFirst({ where: eq(capabilityImprovementProposals.id, proposalId) })
  if (!proposal) throw new ServiceError(`No improvement proposal found for ${proposalId}`, 404)

  if (proposal.status !== "open") {
    return { dispatched: false, reason: `Proposal ${proposalId} is already '${proposal.status}', not eligible for dispatch.` }
  }

  const capability = await db.query.taskCapabilities.findFirst({ where: eq(taskCapabilities.id, proposal.capabilityId) })
  if (!capability) throw new ServiceError(`No capability found for proposal ${proposalId}'s capabilityId ${proposal.capabilityId}`, 404)

  const findings = (proposal.findings ?? {}) as AuditFindings
  const roleKey = mapFindingsToRole(findings)
  if (!roleKey) {
    return { dispatched: false, reason: `Proposal ${proposalId}'s findings have no recognized category to route to a Higher AI role.` }
  }

  const stats = computeCoverageStats(capability.fullSoftwareCount, capability.packageAvailableCount, capability.novelCount)
  const existingAssetMatch = (proposal.existingAssetMatch ?? null) as ExistingAssetMatch | null
  const tightTask = buildTightTaskFromFindings(capability, findings, stats, existingAssetMatch)

  let advisoryOutput: string
  try {
    const result = await dispatchAdvisoryTask(roleKey, tightTask)
    if (!result.dispatched) {
      console.error(`[capability-audit] Higher AI dispatch failed for proposal ${proposalId} (role '${roleKey}'): ${result.reason}`)
      return { dispatched: false, reason: result.reason }
    }
    advisoryOutput = result.output
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[capability-audit] Higher AI dispatch failed for proposal ${proposalId} (role '${roleKey}'): ${reason}`)
    return { dispatched: false, reason }
  }

  const now = new Date()
  await Promise.all([
    db
      .update(capabilityImprovementProposals)
      .set({ status: "dispatched", dispatchedToRole: roleKey, dispatchedAt: now, dispatchOutput: advisoryOutput, updatedAt: now })
      .where(eq(capabilityImprovementProposals.id, proposal.id)),
    db
      .update(taskCapabilities)
      .set({ needsImprovement: "in_progress", updatedAt: now })
      .where(eq(taskCapabilities.id, capability.id)),
  ])

  return { dispatched: true, roleKey }
}

/**
 * Manual close-out -- called by the Super Boss by hand once a real PR from
 * dispatchProposalToHigherAI() has been reviewed and merged, matching this
 * session's established discipline of never auto-merging an AI Dev Team PR
 * and never auto-closing a tracker item on dispatch alone. NOT triggered by
 * anything in this file automatically.
 *
 * Bumping `version` (without touching `lastAuditedVersion`) is what
 * reopens shouldAuditCapability()'s gate for the NEXT audit: the old
 * lastAuditedVersion no longer equals the new, bumped version, so the next
 * real request against this capability is eligible for a fresh audit --
 * exactly the "next time either software or a cheap model can do this"
 * loop closing for real.
 */
export async function closeImprovementLoop(proposalId: string, prUrl: string): Promise<void> {
  const proposal = await db.query.capabilityImprovementProposals.findFirst({ where: eq(capabilityImprovementProposals.id, proposalId) })
  if (!proposal) throw new ServiceError(`No improvement proposal found for ${proposalId}`, 404)

  const capability = await db.query.taskCapabilities.findFirst({ where: eq(taskCapabilities.id, proposal.capabilityId) })
  if (!capability) throw new ServiceError(`No capability found for proposal ${proposalId}'s capabilityId ${proposal.capabilityId}`, 404)

  const now = new Date()
  await Promise.all([
    db
      .update(taskCapabilities)
      .set({ version: capability.version + 1, needsImprovement: "no", updatedAt: now })
      .where(eq(taskCapabilities.id, capability.id)),
    db
      .update(capabilityImprovementProposals)
      .set({ status: "resolved", prUrl, updatedAt: now })
      .where(eq(capabilityImprovementProposals.id, proposal.id)),
  ])

  // Priority 6: make the now-closed capability a discoverable UMR asset --
  // best-effort, and deliberately AFTER the two updates above already
  // committed, so a UMR write failure never leaves the close-out itself
  // half-done. `capability` here still holds the PRE-bump version, so
  // `capability.version + 1` below is exactly the new version the update
  // above just set.
  await registerClosedCapabilityAsUmrAsset(capability, proposal, prUrl).catch((err) => {
    console.error(`[capability-audit] UMR registration/update failed for closed capability ${capability.id} ("${capability.capabilityKey}") -- the close-out itself still succeeded:`, err)
  })
}

/**
 * Priority 6: register (or, if Higher AI wired an existing UMR-known asset
 * rather than building net-new, update) the closed capability as a
 * discoverable platform_assets row. Prefers updateAsset() over
 * registerAsset() whenever the proposal carried an existingAssetMatch
 * (findExistingUmrCandidate(), set at audit time) OR a platform_assets row
 * already exists for source (task_capabilities, capability.id) from a prior
 * close-out -- platform_assets' real UNIQUE(source_table, source_id)
 * constraint would reject a second registerAsset() call for either case
 * anyway, so this checks first via getAssetBySource() rather than relying
 * on the constraint to fail loudly, matching registerAsset()'s own
 * documented duplicate-check convention.
 */
async function registerClosedCapabilityAsUmrAsset(
  capability: TaskCapability,
  proposal: CapabilityImprovementProposal,
  prUrl: string
): Promise<void> {
  const findings = (proposal.findings ?? {}) as AuditFindings
  const existingMatch = (proposal.existingAssetMatch ?? null) as ExistingAssetMatch | null
  const purposeNote = `Closes capability "${capability.capabilityKey}"${capability.modePill ? ` (mode pill "${capability.modePill}")` : ""} -- resolved via ${prUrl}.`
  const newVersion = String(capability.version + 1)

  if (existingMatch) {
    const existingRow = await getAssetBySource(existingMatch.sourceTable, existingMatch.sourceId)
    if (existingRow) {
      await updateAsset(existingRow.assetId, {
        status: "active",
        version: newVersion,
        purpose: existingRow.purpose ? `${existingRow.purpose} ${purposeNote}` : purposeNote,
      })
      return
    }
    // Falls through to the register-new-row path below if the candidate
    // row no longer exists (defensive -- should not happen in practice,
    // since platform_assets rows are only ever soft-archived, not deleted).
  }

  const sourceTable = "task_capabilities"
  const sourceId = capability.id
  const already = await getAssetBySource(sourceTable, sourceId)
  if (already) {
    await updateAsset(already.assetId, { status: "active", version: newVersion, purpose: purposeNote })
    return
  }

  await registerAsset({
    name: `Capability: ${capability.capabilityKey}`,
    assetType: pickAssetTypeForFindings(findings),
    sourceTable,
    sourceId,
    module: capability.modePill ?? undefined,
    status: "active",
    version: newVersion,
    purpose: purposeNote,
    searchKeywords: [capability.capabilityKey, capability.modePill].filter(Boolean).join(" "),
    orgId: capability.orgId ?? null,
  })
}
