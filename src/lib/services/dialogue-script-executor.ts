// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, E3/E4): the
// "dialogue_script" instructionPackages executor -- Lower AI's VERI-
// communication-flow counterpart to task-execution-engine.ts's
// executePackageDispatch(). Given an approved dialogue_script package
// (steps shape: [{question, expectedAnswerPatterns, onMatch, onNoMatch}])
// and the user's latest reply, decides which step comes next.
//
// The MATCHING decision is a PURE function (matchDialogueStep below) --
// deterministic word/pattern overlap via capability-learning-service.ts's
// tokenizePrompt()/wordOverlapScore(), the same substrate that file's own
// findCapabilityByPromptOverlap() uses for capability lookup. No LLM call
// decides routing, by design (a routing decision an LLM could get
// "creative" with defeats the whole "foolproof by construction" premise of
// an approved package). Only the actual reply TEXT -- phrasing the next
// question naturally -- goes through a floor-tier model, and even then
// it's hard-constrained to the matched step's own `question` field (see
// renderDialogueQuestion below), never free-reasoning about what to ask.
import { tokenizePrompt, wordOverlapScore, findOrCreateCapability, findApprovedPackage, findCapabilityByPromptOverlap, recordExecutionOutcome, recordPackageUsage, type InstructionPackage } from "./capability-learning-service"
import { classifyExecutionWithReliability } from "./software-coverage-service"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLM } from "@/lib/llm-client"
import { db, conversations, instructionPackages, dynamicChains } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"

export type DialogueStep = {
  question: string
  expectedAnswerPatterns: string[]
  onMatch: number
  onNoMatch: "escalate" | number
}

// Threshold picked deliberately lower than capability-learning-service.ts's
// own findCapabilityByPromptOverlap() default (0.3): expectedAnswerPatterns
// entries are typically short (1-3 words, e.g. "yes", "already filed"),
// while a real user reply is a full sentence ("Yes, we already filed it
// last week") -- Jaccard overlap against a short pattern is structurally
// lower even on a clear semantic match, since the union grows with every
// extra word the user adds. 0.2 was picked by hand-checking the "Did/We/
// File" style short-answer examples in the tracker's investigation section
// against a handful of natural phrasings; not derived from a labeled
// dataset (none exists yet) -- documented here so a future pass with real
// usage data can tune it with evidence instead of guessing again from
// scratch.
export const DIALOGUE_MATCH_THRESHOLD = 0.2

export type DialogueMatchResult =
  | { matched: true; nextStepIndex: number; matchedPattern: string; score: number }
  | { matched: false; outcome: "escalate" }
  | { matched: false; outcome: "next_step"; nextStepIndex: number }

// The pure routing decision -- no I/O, fully unit-testable. Scores the
// reply against every expectedAnswerPatterns entry for the CURRENT step and
// takes the best match; below DIALOGUE_MATCH_THRESHOLD routes to the step's
// own declared onNoMatch (either "escalate" -- caller falls back to the
// existing free-text AI reply path -- or a specific fallback step index the
// package author wrote for a "didn't understand" branch).
export function matchDialogueStep(step: DialogueStep, replyText: string): DialogueMatchResult {
  const replyTokens = tokenizePrompt(replyText)
  let best: { pattern: string; score: number } | null = null
  for (const pattern of step.expectedAnswerPatterns) {
    const score = wordOverlapScore(replyTokens, tokenizePrompt(pattern))
    if (!best || score > best.score) best = { pattern, score }
  }
  if (best && best.score >= DIALOGUE_MATCH_THRESHOLD) {
    return { matched: true, nextStepIndex: step.onMatch, matchedPattern: best.pattern, score: best.score }
  }
  if (step.onNoMatch === "escalate") return { matched: false, outcome: "escalate" }
  return { matched: false, outcome: "next_step", nextStepIndex: step.onNoMatch }
}

// A step index at or past the end of the script means "the script is
// done" -- pure, tiny, but kept as a named predicate rather than an inline
// `>=` check scattered across call sites (chat-service.ts checks this both
// when advancing on a match and when landing on an onNoMatch fallback step).
export function isScriptComplete(steps: DialogueStep[], stepIndex: number): boolean {
  return stepIndex < 0 || stepIndex >= steps.length
}

// ─── Conversation-scoped script state (encoded into conversations.currentState) ──
//
// No new column for this -- conversations.currentState/previousState (Wave
// 144, schema.ts) already exist specifically as a free-text "no state
// taxonomy designed yet" slot with zero writers before this dispatch. A
// dialogue script's own progress ("which step are we on") is a real,
// narrow state-machine use of exactly that column, so this reuses it
// rather than adding a new migration -- additive, and orthogonal to the
// sibling E1 dispatch's conversations.dynamicChainId gate (a different
// column entirely).
const STATE_PREFIX = "dialogue_script:"

export function buildDialogueScriptState(packageId: string, stepIndex: number): string {
  return `${STATE_PREFIX}${packageId}:${stepIndex}`
}

export function parseDialogueScriptState(currentState: string | null): { packageId: string; stepIndex: number } | null {
  if (!currentState || !currentState.startsWith(STATE_PREFIX)) return null
  const rest = currentState.slice(STATE_PREFIX.length)
  const lastColon = rest.lastIndexOf(":")
  if (lastColon === -1) return null
  const packageId = rest.slice(0, lastColon)
  const stepIndex = Number(rest.slice(lastColon + 1))
  if (!packageId || !Number.isInteger(stepIndex) || stepIndex < 0) return null
  return { packageId, stepIndex }
}

// ─── LLM-touching: phrasing only, never routing ────────────────────────────

// Renders a step's `question` field into a natural reply via the floor
// tier -- hard-constrained by system prompt to that exact question, no
// elaboration, no new questions, no free reasoning. Falls back to the raw
// question text verbatim if no model is configured for this org (still a
// correct, if less conversational, reply -- never blocks the script on a
// missing LLM config the way a free-text plan would).
export async function renderDialogueQuestion(orgId: string, question: string): Promise<string> {
  const modelConfig = await resolveModelConfig(orgId, "user_assistant_oa")
  if (!modelConfig) return question

  const systemPrompt =
    "You are VERI, restating a single pre-approved question from a fixed script. " +
    "Rephrase it naturally and conversationally if you like, but you MUST NOT change its meaning, " +
    "add any other question, add options that aren't implied by it, or answer on the user's behalf. " +
    "Output ONLY the question text, nothing else."
  try {
    const { content } = await callLLM(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey,
      systemPrompt, question,
      { temperature: 0.2, maxTokens: 200 }, modelConfig.fallback
    )
    return content.trim() || question
  } catch {
    return question
  }
}

// ─── DB-touching orchestration: the VERI Chat call site ────────────────────
//
// capability-learning-service.ts's own file already splits "pure functions"
// from "DB-touching lookups/writes" in one module -- this section mirrors
// that same split for this file, rather than pushing the DB wiring into
// chat-service.ts's own already-long generateAiReply() and duplicating the
// capability-resolution logic task-execution-engine.ts's own
// resolveTaskCapability() already establishes the pattern for.

// Resolves a capability for a VERI Chat conversation the two ways the
// tracker's E3/E4 scope describes: the conversation's own resolved Dynamic
// Chain selection first (conversations.dynamicChainId, Wave 161 -- READ
// only here, never written; the sibling E1 dispatch owns wiring an actual
// writer for it), falling back to a fuzzy word-overlap match against known
// capability prompts (capability-learning-service.ts's
// findCapabilityByPromptOverlap()) when there's no chain selection at all
// -- the common case today, since no conversation-creation flow offers a
// Chain Selector step yet.
async function resolveConversationCapability(orgId: string, userId: string, conversationDynamicChainId: string | null, userMessage: string) {
  if (conversationDynamicChainId) {
    const chain = await withTenantContext({ orgId, userId }, (tdb) =>
      tdb.query.dynamicChains.findFirst({ where: eq(dynamicChains.id, conversationDynamicChainId), columns: { modePill: true, pathKeys: true } })
    )
    if (chain?.modePill && Array.isArray(chain.pathKeys) && chain.pathKeys.length > 0) {
      // Deliberately orgId: null -- same platform-wide capability-learning
      // posture task-execution-engine.ts's resolveTaskCapability() uses.
      return findOrCreateCapability({ modePill: chain.modePill, pathKeys: chain.pathKeys as string[], promptText: userMessage, orgId: null })
    }
  }
  return findCapabilityByPromptOverlap(userMessage)
}

async function clearScriptState(orgId: string, userId: string, conversationId: string): Promise<void> {
  await withTenantContext({ orgId, userId }, (tdb) =>
    tdb.update(conversations).set({ currentState: null, previousState: null, updatedAt: new Date() }).where(eq(conversations.id, conversationId))
  )
}

async function persistScriptState(orgId: string, userId: string, conversationId: string, previousState: string | null, packageId: string, stepIndex: number): Promise<void> {
  await withTenantContext({ orgId, userId }, (tdb) =>
    tdb.update(conversations)
      .set({ previousState, currentState: buildDialogueScriptState(packageId, stepIndex), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
  )
}

async function startScript(orgId: string, conversationId: string, userId: string, capabilityId: string, pkg: InstructionPackage): Promise<string | null> {
  const steps = (pkg.steps as DialogueStep[] | null) ?? []
  if (steps.length === 0) {
    // A malformed/empty approved package -- treat as if none existed
    // rather than starting a script with nothing in it.
    await recordExecutionOutcome(capabilityId, "NOVEL").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err))
    return null
  }
  await persistScriptState(orgId, userId, conversationId, null, pkg.id, 0)
  await recordExecutionOutcome(capabilityId, "PACKAGE_AVAILABLE").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err))
  return renderDialogueQuestion(orgId, steps[0].question)
}

async function continueScript(
  orgId: string, userId: string, conversationId: string, capabilityId: string,
  pkg: InstructionPackage, currentStepIndex: number, userMessage: string
): Promise<string | null> {
  const steps = (pkg.steps as DialogueStep[] | null) ?? []
  const currentStep = steps[currentStepIndex]
  if (!currentStep) {
    // Stale state (e.g. the package was re-authored with fewer steps since
    // this conversation started its script) -- clear and fall through.
    await clearScriptState(orgId, userId, conversationId)
    return null
  }

  const result = matchDialogueStep(currentStep, userMessage)
  // Recorded regardless of matched/next_step/escalate outcome below -- the
  // classification decision this turn WAS "an approved package exists and
  // was tried", independent of whether the deterministic match itself
  // succeeded (same "record at classification time" reasoning task-
  // execution-engine.ts's executeTask() documents for its own NOVEL case).
  await recordExecutionOutcome(capabilityId, "PACKAGE_AVAILABLE").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err))

  let nextStepIndex: number
  if (result.matched) {
    nextStepIndex = result.nextStepIndex
  } else if (result.outcome === "next_step") {
    nextStepIndex = result.nextStepIndex
  } else {
    // outcome === "escalate": the tracker's own required behavior -- clear
    // the script and let the caller's ordinary free-text AI reply run this
    // turn instead. Counts as a real package-usage failure (the approved
    // script couldn't route this reply), feeding successRate the same way
    // executePackageDispatch()'s failures do on the task-execution side.
    await clearScriptState(orgId, userId, conversationId)
    await recordPackageUsage(pkg.id, false).catch((err) => console.error("Priority 5: recordPackageUsage failed:", err))
    return null
  }

  await recordPackageUsage(pkg.id, true).catch((err) => console.error("Priority 5: recordPackageUsage failed:", err))

  if (isScriptComplete(steps, nextStepIndex)) {
    await clearScriptState(orgId, userId, conversationId)
    // Deliberately a fixed, deterministic closing line -- not another LLM
    // call. The script's own last question already carried whatever
    // context mattered; there is nothing left to ask.
    return "Got it, thank you -- noted."
  }

  await persistScriptState(orgId, userId, conversationId, buildDialogueScriptState(pkg.id, currentStepIndex), pkg.id, nextStepIndex)
  return renderDialogueQuestion(orgId, steps[nextStepIndex].question)
}

/**
 * The VERI Chat call site for this whole mechanism -- chat-service.ts's
 * generateAiReply() calls this BEFORE its own LLM call/history-building/
 * resolveModelConfig. Returns a reply string when Lower AI's dialogue
 * script handled this turn (the caller persists it as VERI's message and
 * skips ordinary free-text reply generation entirely for this turn);
 * returns null in every other case -- no capability matched, no approved
 * `dialogue_script` package exists or is reliable (isPackageReliable()),
 * or an active script just escalated -- so the caller's existing free-text
 * path runs completely unchanged, per the tracker's own requirement that a
 * no-match "return[s] an escalation signal so the caller falls back to the
 * existing free-text AI reply path."
 */
export async function runDialogueScriptTurn(orgId: string, userId: string, conversationId: string, userMessage: string): Promise<string | null> {
  try {
    const convo = await withTenantContext({ orgId, userId }, (tdb) =>
      tdb.query.conversations.findFirst({ where: eq(conversations.id, conversationId), columns: { dynamicChainId: true, currentState: true } })
    )
    if (!convo) return null

    const capability = await resolveConversationCapability(orgId, userId, convo.dynamicChainId, userMessage)
    if (!capability) return null

    const activeState = parseDialogueScriptState(convo.currentState)
    if (activeState) {
      // Raw `db`, not withTenantContext -- instruction_packages is
      // platform-wide/non-RLS, same posture as capability-learning-
      // service.ts's own findApprovedPackage() (see that file's header).
      const pkg = await db.query.instructionPackages.findFirst({ where: eq(instructionPackages.id, activeState.packageId) })
      if (!pkg || pkg.status !== "approved" || pkg.packageType !== "dialogue_script") {
        await clearScriptState(orgId, userId, conversationId)
        return null
      }
      return continueScript(orgId, userId, conversationId, capability.id, pkg, activeState.stepIndex, userMessage)
    }

    const approvedPackage = await findApprovedPackage(capability.id, "dialogue_script")
    const classification = classifyExecutionWithReliability({ alreadyFullSoftware: false, approvedPackage })
    if (classification.bucket !== "PACKAGE_AVAILABLE") {
      // NOVEL -- no reliable dialogue_script package for this capability
      // yet. Recorded here (mirroring task-execution-engine.ts's own NOVEL
      // recording) so this capability's rolling stats reflect every real
      // chat turn that reached this classification step, not just the ones
      // where a package existed.
      await recordExecutionOutcome(capability.id, "NOVEL").catch((err) => console.error("Priority 5: recordExecutionOutcome failed:", err))
      return null
    }

    return startScript(orgId, conversationId, userId, capability.id, classification.package)
  } catch (err) {
    console.error("Priority 5: runDialogueScriptTurn failed, falling back to the ordinary free-text reply:", err)
    return null
  }
}
