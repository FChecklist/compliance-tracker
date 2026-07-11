// Wave (VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, "Objective/Scope/
// Instruction Validation Guardrails"): a structured, mandatory task
// envelope for every task dispatched to an AI Workforce role, replacing a
// single free-text string.
//
// Why this exists, concretely (not hypothetically): every real "AI agent
// missed part of the task" incident this session's own history recorded
// was a loose free-text brief -- ai-workforce-agent.mjs's z.ai dispatches
// twice ran the full MAX_ITERATIONS budget without ever calling `finish`
// because the brief had no explicit file cap or completion definition
// (see ai-workforce-agent.mjs's own MAX_ITERATIONS comment, and
// veridian_docx_constitution_study memory's "Round 2"/"Phase 2 audit"
// entries). Both times the fix was the same: redispatch with an explicit
// scope cap and an explicit definition of done -- "the tightened-brief
// pattern is now the standard fix." This module makes that fix structural
// instead of something a human/AI has to remember to do each time: a task
// without an objective, a bounded scope, and success criteria is rejected
// before it ever reaches a model, matching the Constitution's Objective
// Guardrail (#4), Scope Guardrail (#3), and Instruction Validation
// Guardrail (#5).
//
// Deterministic only -- no LLM call, matching every other gate in this
// codebase (policy-enforcement-engine.ts, high-impact-action-detector.ts,
// guardrail-engine.ts). This does not judge whether a task is a GOOD
// idea, only whether it is specified completely enough to attempt.

// Wave 163 (Boss directive, 2026-07-11: "every task has mandatory rigid
// tightened narrow instructions... based on complexity given to the AI
// model" -- and a direct callout that this codebase had *designed* tier
// routing without actually *enforcing* it anywhere). Two fields added
// after finding, by grepping the real dispatch surfaces rather than
// assuming, that neither existed: no output contract beyond a generic
// {summary, filesChanged}, and no way to route by task complexity at all.
//
// complexityTier drives model-eligibility (see guardrail-registrations.ts's
// tierEligibilityCheck): this session's own evidence -- GPT-OSS-120B
// burned its full iteration budget twice on a multi-file wiring task,
// zero files written either time, even after a much-tighter second brief
// -- is what fixes these three values, not guessing:
//   'mechanical'   -- one file, one well-defined operation. Every model
//                     eligible, including the cheapest.
//   'integrative'  -- multiple files, requires understanding an existing
//                     component before extending it. GPT-OSS-120B excluded
//                     (its confirmed failure shape); DeepSeek/GLM-5.2 eligible.
//   'judgment'     -- architecture, security, audit verdicts, anything
//                     governance-affecting. GLM-5.2/GPT-5.5 only -- an
//                     auditor weaker than the work it checks isn't real
//                     assurance (VERIDIAN_AUDIT_ORGANIZATION.md's own rule).
export type ComplexityTier = "mechanical" | "integrative" | "judgment"

export type TightTask = {
  objective: string
  scope: string
  successCriteria: string
  complexityTier: ComplexityTier
  /** What the output must actually contain/prove -- not just "did it run", the specific thing to check for. */
  expectedOutput: string
  /** Optional: iteration/file/time caps, explicit exclusions, etc. */
  constraints?: string
  /**
   * What existing code/docs/prior state the executor already has, so it
   * isn't guessing at unfamiliar territory before touching it. Required
   * only for 'integrative'/'judgment' tiers -- see
   * validateKnowledgeSufficiency()'s header for why 'mechanical' is exempt.
   */
  knownContext?: string
}

export type TightTaskValidation =
  | { valid: true }
  | { valid: false; reason: string; guidance: string }

const MIN_FIELD_LENGTH = 10

// Real placeholder text seen in practice (copy-pasted templates, "fill me
// in later" stubs) -- rejected even though it technically clears the
// length bar, so the guardrail can't be satisfied by padding a field with
// filler.
const PLACEHOLDER_PATTERNS = [
  /^(tbd|todo|n\/?a|none|null|undefined|xxx+|\.\.\.|fill.?in|same as (above|objective|scope))$/i,
  /^\s*$/,
]

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim()
  return PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed))
}

// Wave 166 (tree4-unified/50-completion-plan area 7, "Narrow and tightened
// Instructions to Agents"): the completeness checks above (missing/
// placeholder/too-short) don't catch a field that IS present, real, and
// long enough, but still underspecified -- a brief that says "handle edge
// cases as appropriate" is exactly the kind of thing that burned GPT-OSS-
// 120B's iteration budget with zero files written (see module header).
// Deterministic only, same discipline as every other gate here: this
// catches the clearest, narrowest cases (explicit hedge-word phrases, and
// an explicit "don't do X" in constraints against an explicit "do X" in
// the requirement fields) -- it does not attempt general logical
// contradiction detection, which would need an LLM and isn't what this
// module does. False negatives are expected and acceptable; false
// positives on legitimate specific text are not, so the phrase list is
// deliberately short and literal rather than broad.
const AMBIGUITY_PHRASES = [
  "etc.", "and so on", "and so forth", "as appropriate", "as needed",
  "if needed", "if necessary", "when necessary", "handle edge cases",
  "handle appropriately", "figure it out", "use your judgment", "use your judgement",
  "some kind of", "some sort of", "not sure", "we'll see", "tbd later",
]

export function detectAmbiguousLanguage(value: string): { detected: boolean; matchedPhrase?: string } {
  const lower = value.toLowerCase()
  const matchedPhrase = AMBIGUITY_PHRASES.find((phrase) => lower.includes(phrase))
  return matchedPhrase ? { detected: true, matchedPhrase } : { detected: false }
}

// Narrow cross-field check: an explicit negation in constraints ("do not
// X" / "never X" / "excluding X") whose object X substantially overlaps
// (as a bag of content words, not an exact phrase -- a first attempt using
// exact-substring matching broke on ordinary sentence variation like an
// inserted adjective, e.g. "do not delete the X module" vs "delete the
// DEPRECATED X module") with words also present in objective/scope/
// successCriteria/expectedOutput. Requires at least 2 overlapping content
// words AND >=60% overlap of the negation's own object words, so a single
// shared common word (e.g. both mentioning "export") can't trigger a false
// positive on its own.
const NEGATION_TRIGGERS = ["do not", "don't", "never", "must not", "should not", "shouldn't", "excluding", "without"]
const CONTRADICTION_STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "at", "by", "with",
  "it", "this", "that", "under", "any", "all", "circumstances", "as", "is", "be",
])

function contentWords(text: string, limit?: number): string[] {
  const words = text.split(/[^a-z0-9]+/).filter(Boolean).filter((w) => !CONTRADICTION_STOPWORDS.has(w) && w.length > 2)
  return limit ? words.slice(0, limit) : words
}

export function detectFieldContradiction(task: Partial<TightTask>): { detected: boolean; conflictingTerm?: string } {
  const constraintText = (task.constraints ?? "").toLowerCase()
  if (!constraintText.trim()) return { detected: false }
  const requirementText = [task.objective, task.scope, task.successCriteria, task.expectedOutput]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase()
  if (!requirementText.trim()) return { detected: false }
  const requirementWords = new Set(contentWords(requirementText))

  for (const trigger of NEGATION_TRIGGERS) {
    let searchFrom = 0
    while (true) {
      const idx = constraintText.indexOf(trigger, searchFrom)
      if (idx === -1) break
      const after = constraintText.slice(idx + trigger.length)
      const words = contentWords(after, 6)
      if (words.length >= 2) {
        const matched = words.filter((w) => requirementWords.has(w))
        if (matched.length >= 2 && matched.length / words.length >= 0.6) {
          return { detected: true, conflictingTerm: words.join(" ") }
        }
      }
      searchFrom = idx + trigger.length
    }
  }
  return { detected: false }
}

// tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 re-scoped
// item (c) "real pre-execution Knowledge-sufficiency gate": Constitution
// Guardrail 6 ("do I have sufficient knowledge... are referenced documents
// available -- if not, retrieve or escalate") had zero code support
// anywhere in this codebase before this (confirmed by grepping for
// "knowledge"/"sufficient" guardrails -- nothing matched). 'integrative'
// and 'judgment' tiers are DEFINED (see ComplexityTier's own docs above) as
// requiring understanding of an existing component/governance context
// before acting -- a dispatch at those tiers with zero stated prior
// context is the exact same underspecified-brief failure shape this whole
// module exists to prevent (module header), just for prior knowledge
// instead of the task's own definition. 'mechanical' tier is exempt by the
// same definition: "one file, one well-defined operation" needs no
// existing-component understanding to attempt safely.
export function validateKnowledgeSufficiency(task: Partial<TightTask>): TightTaskValidation {
  if (task.complexityTier === "mechanical") return { valid: true }
  const failure = checkField(
    task.knownContext,
    "Known context",
    "Read task-tightening.ts's existing TightTask type and validateTightTask() before extending them; guardrail-registrations.ts's tightTaskCheck is the one real caller"
  )
  if (failure && !failure.valid) {
    return {
      valid: false,
      reason: `Complexity tier "${task.complexityTier}" requires understanding an existing component, but no known context was supplied -- ${failure.reason}`,
      guidance: `Please add knownContext describing what you already know or have read about the existing code or state this task touches. ${failure.guidance}`,
    }
  }
  return { valid: true }
}

function checkField(value: string | undefined, label: string, guidanceExample: string): TightTaskValidation | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Please add a ${label.toLowerCase()} before this can proceed. Example: "${guidanceExample}"` }
  }
  if (isPlaceholder(trimmed)) {
    return { valid: false, reason: `${label} is a placeholder, not a real value ("${trimmed}").`, guidance: `Please replace it with the actual ${label.toLowerCase()}. Example: "${guidanceExample}"` }
  }
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return { valid: false, reason: `${label} is too short to be actionable ("${trimmed}").`, guidance: `Could you be a little more specific -- name the concrete file, behavior, or outcome, not just a category? Example: "${guidanceExample}"` }
  }
  return null
}

/**
 * Validates that a task carries enough structure to be dispatched safely.
 * Rejects tasks missing an objective, a bounded scope, or a definition of
 * done -- the exact three properties whose absence caused real dispatch
 * failures in this codebase's history (see module header).
 */
const VALID_TIERS: ComplexityTier[] = ["mechanical", "integrative", "judgment"]

export function validateTightTask(task: Partial<TightTask>): TightTaskValidation {
  const objectiveFailure = checkField(task.objective, "Objective", "Add real PDF/Excel export to the reports dashboard")
  if (objectiveFailure) return objectiveFailure

  const scopeFailure = checkField(task.scope, "Scope", "Only src/app/(app)/reports/page.tsx and package.json -- no other report surface")
  if (scopeFailure) return scopeFailure

  const successFailure = checkField(task.successCriteria, "Success criteria", "Both export buttons produce a file matching the existing CSV export's columns; typecheck and lint pass")
  if (successFailure) return successFailure

  const outputFailure = checkField(task.expectedOutput, "Expected output", "A new PDF file matching the CSV export's row/column structure, downloadable from the reports page")
  if (outputFailure) return outputFailure

  for (const [label, value] of [["Objective", task.objective], ["Scope", task.scope], ["Success criteria", task.successCriteria], ["Expected output", task.expectedOutput]] as const) {
    const ambiguity = detectAmbiguousLanguage(value ?? "")
    if (ambiguity.detected) {
      return {
        valid: false,
        reason: `${label} contains vague, unresolved language ("${ambiguity.matchedPhrase}").`,
        guidance: `Please replace "${ambiguity.matchedPhrase}" with the actual decision -- stating exactly what should happen helps avoid leaving it for the model to guess.`,
      }
    }
  }

  const contradiction = detectFieldContradiction(task)
  if (contradiction.detected) {
    return {
      valid: false,
      reason: `Constraints say not to do "${contradiction.conflictingTerm}", but that same thing is required elsewhere in the task.`,
      guidance: `Could you resolve this contradiction before dispatch -- either remove it from Constraints, or remove the requirement from Objective/Scope/Success criteria/Expected output?`,
    }
  }

  if (!task.complexityTier) {
    return { valid: false, reason: "Complexity tier is missing.", guidance: `Please set complexityTier to one of: ${VALID_TIERS.join(", ")} -- this determines which models are even eligible to receive this task.` }
  }
  if (!VALID_TIERS.includes(task.complexityTier)) {
    return { valid: false, reason: `Complexity tier "${task.complexityTier}" is not recognized.`, guidance: `Please use one of: ${VALID_TIERS.join(", ")}.` }
  }

  const knowledgeFailure = validateKnowledgeSufficiency(task)
  if (!knowledgeFailure.valid) return knowledgeFailure

  return { valid: true }
}

// Wave 159 (VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, "Customer Task
// Governance" gap closure): the customer-facing `tasks` table has only
// `title`/`description` -- a human creating "Follow up with vendor X" is a
// completely normal, complete task, so requiring the full
// objective/scope/successCriteria TightTask schema at *creation* would
// break real product usage for zero benefit (a human doesn't run out of
// iteration budget the way an unattended AI dispatch does). The real,
// narrower risk is task-execution-engine.ts's free-text LLM-planning path
// (executeTask() when no resolvedWorkerAgentId/engineKey is set) --
// exactly the moment a task's title+description alone drives an
// unattended LLM to invent a plan, the same failure shape as an
// under-specified AI-dispatch brief. validateTaskBrief() is a lighter,
// purpose-fit check for that one entry point, not the full TightTask
// schema forced onto every task a human creates.
export type TaskBrief = { title: string; description?: string | null }

// Deliberately conservative -- this gates a live, real customer product
// with real short task titles ("Follow up", "Call vendor") that must keep
// working. Unlike the AI-dispatch TightTask checks above (which had zero
// production callers to regress), a threshold tuned to "looks incomplete
// to me" without real usage data risks blocking legitimate tasks. This
// catches only the genuinely degenerate case -- empty/near-empty/
// placeholder titles -- not "short but real."
const MIN_PLANNABLE_LENGTH = 4

export function validateTaskBrief(brief: TaskBrief): TightTaskValidation {
  const title = (brief.title ?? "").trim()
  if (!title) {
    return { valid: false, reason: "Task has no title.", guidance: "Please add a title before this can be planned." }
  }
  if (isPlaceholder(title)) {
    return { valid: false, reason: `Task title is a placeholder ("${title}"), not real.`, guidance: "Please replace the title with what actually needs to happen." }
  }
  if (title.length < MIN_PLANNABLE_LENGTH) {
    return {
      valid: false,
      reason: `Task title ("${title}") is too short for an AI to plan reliably.`,
      guidance: "A few more words describing what should happen would help, or you can assign the task directly instead of relying on AI planning.",
    }
  }

  // Same ambiguity check as validateTightTask, applied to title+description
  // combined -- no separate constraints field exists on a customer task, so
  // the cross-field contradiction check (detectFieldContradiction) doesn't
  // apply here.
  const combined = [title, (brief.description ?? "").trim()].filter(Boolean).join(" ")
  const ambiguity = detectAmbiguousLanguage(combined)
  if (ambiguity.detected) {
    return {
      valid: false,
      reason: `Task title/description contains vague, unresolved language ("${ambiguity.matchedPhrase}").`,
      guidance: `Please replace "${ambiguity.matchedPhrase}" with what should actually happen.`,
    }
  }

  return { valid: true }
}

/**
 * Renders a validated TightTask into the text actually sent to a model.
 * Every field is labeled explicitly so the model (and any human reading
 * the dispatch log) sees the same structure the guardrail enforced --
 * this is the "Every Task MUST contain" schema's Input section, narrowed
 * to the fields this codebase can realistically populate and check today.
 */
export function assembleTightTaskPrompt(task: TightTask): string {
  const lines = [
    `Objective: ${task.objective.trim()}`,
    `Scope: ${task.scope.trim()}`,
    `Complexity tier: ${task.complexityTier}`,
    `Success Criteria (definition of done -- call finish once these are met): ${task.successCriteria.trim()}`,
    `Expected Output (what the result must actually contain/prove, not just "it ran"): ${task.expectedOutput.trim()}`,
  ]
  if (task.constraints?.trim()) {
    lines.push(`Constraints: ${task.constraints.trim()}`)
  }
  if (task.knownContext?.trim()) {
    lines.push(`Known Context (already established -- do not re-derive from scratch): ${task.knownContext.trim()}`)
  }
  lines.push(
    "If any of the above is ambiguous or you find you need to go outside the stated scope, stop and say so in `finish` rather than guessing or silently expanding scope."
  )
  return lines.join("\n")
}
