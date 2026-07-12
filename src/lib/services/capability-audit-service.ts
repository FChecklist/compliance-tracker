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
//      them as one flow. Reason: dispatch-repo.ts's own header states
//      GITHUB_DISPATCH_PAT is not yet set on Vercel -- a live dispatch call
//      from the deployed app throws today. Splitting it out means a failed
//      dispatch never corrupts the audit's own state (the proposal stays
//      'open', the capability stays needsImprovement='yes') and the Super
//      Boss (or a cron once the PAT is configured) can retry the dispatch
//      alone by proposal id, without re-spending an Auditor LLM call.
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
import { dispatchRepoTask } from "@/lib/ai-team/dispatch-repo"
import type { TightTask } from "@/lib/task-tightening"
import { ServiceError, type TaskCapability, computeCoverageStats, type CoverageStats } from "./capability-learning-service"

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

// ─── TightTask assembly (pure) ─────────────────────────────────────────────
//
// Every field is built from the Auditor's own concrete finding text (never
// a generic placeholder) -- task-tightening.ts's validateTightTask() will
// reject placeholder/ambiguous language, so this deliberately quotes the
// finding's own description into objective/scope/successCriteria/
// expectedOutput rather than restating the category name alone.
export function buildTightTaskFromFindings(
  capability: Pick<TaskCapability, "capabilityKey" | "modePill" | "version">,
  findings: AuditFindings,
  stats: CoverageStats
): TightTask {
  const entries = FINDING_KEYS.filter((k) => findings[k]).map((k) => `${k}: ${findings[k]}`)
  const findingsSummary = entries.join(" | ")

  return {
    objective: `Software-close a capability-coverage gap the Auditor identified for "${capability.capabilityKey}" (version ${capability.version}): ${findingsSummary}`,
    scope: `Implement the described addition inside the existing capability/mode-pill/Dynamic Chain surface that "${capability.capabilityKey}"` +
      `${capability.modePill ? ` (mode pill "${capability.modePill}")` : ""} already maps to -- do not touch unrelated capabilities or mode pills while doing this.`,
    successCriteria: `The specific gap described above no longer requires AI reasoning at request time -- a future request that previously classified as NOVEL or PACKAGE_AVAILABLE for "${capability.capabilityKey}" can classify as FULL_SOFTWARE or a reliable PACKAGE_AVAILABLE instead; typecheck and lint both pass.`,
    complexityTier: "integrative",
    expectedOutput: `A real code change (the specific function/workflow/business rule/report/configuration/mode pill/chain option/metadata/validation/screen/API named above) plus a PR description stating exactly what was added and how it closes this gap for "${capability.capabilityKey}".`,
    knownContext: `This capability is tracked in compliance.task_capabilities (capabilityKey="${capability.capabilityKey}"). Read src/lib/services/software-coverage-service.ts and src/lib/services/capability-learning-service.ts to see how capabilities are classified (FULL_SOFTWARE/PACKAGE_AVAILABLE/NOVEL) before extending anything, and src/lib/task-execution-engine.ts for how a Dynamic Chain resolves to a capability. Rolling history so far: ${stats.fullSoftwarePercent}% full-software, ${stats.packageAvailablePercent}% package-available, ${stats.novelPercent}% novel across ${stats.total} observed executions.`,
  }
}

// ─── DB-touching: audit run, proposal dedup, dispatch, close-out ──────────

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

  const proposal = await upsertImprovementProposal(capability.id, capability.version, verdict!.findings)
  const dispatch = await dispatchProposalToHigherAI(proposal.id)
  return { audited: true, needsImprovement: "yes", proposalId: proposal.id, dispatch }
}

/**
 * Finds an open proposal for (capabilityId, capabilityVersion) and
 * increments its occurrenceCount, or inserts a new one -- the schema's real
 * UNIQUE(capability_id, capability_version) constraint (migration 0156)
 * backs this as a true upsert rather than a check-then-insert race.
 * Deliberately does NOT overwrite `findings` on conflict -- the spec's own
 * words are "repeated identical findings increment this", so an existing
 * proposal's original finding text is left standing; only the counter and
 * updatedAt move.
 */
export async function upsertImprovementProposal(
  capabilityId: string,
  capabilityVersion: number,
  findings: AuditFindings
): Promise<CapabilityImprovementProposal> {
  const [row] = await db
    .insert(capabilityImprovementProposals)
    .values({ capabilityId, capabilityVersion, findings })
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
  const tightTask = buildTightTaskFromFindings(capability, findings, stats)

  try {
    await dispatchRepoTask(roleKey, tightTask)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[capability-audit] Higher AI dispatch failed for proposal ${proposalId} (role '${roleKey}'): ${reason}`)
    return { dispatched: false, reason }
  }

  const now = new Date()
  await Promise.all([
    db
      .update(capabilityImprovementProposals)
      .set({ status: "dispatched", dispatchedToRole: roleKey, dispatchedAt: now, updatedAt: now })
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
}
