// Stage 12 (VERIDIAN_CONSOLIDATED_COMPLETION plan): closes the AI Dev Team
// dispatch system's persistent-memory gap flagged in
// SYSTEM_MEMORY_ARCHITECTURE.yaml's layer_5 entry -- until now, nothing
// wrote down what an AI Dev Team dispatch (runRole() in team-service.ts /
// dispatchRepoTask() in dispatch-repo.ts) actually produced, or whether the
// same work had already been attempted. See drizzle/0269's own header for
// the full RLS/schema design trail (platform.dispatch_outcomes mirrors
// platform.task_capabilities' fail-closed, org-agnostic posture).
//
// Two responsibilities, both intentionally narrow:
//   1. recordDispatchOutcome() -- called once per real dispatch completion
//      (success or failure), from runRole() and dispatchRepoTask(). Never
//      throws -- a persistence failure must not take down the dispatch
//      itself, so failures are logged and swallowed (same "never throws"
//      posture as advisory-dispatch-service.ts's own dispatchAdvisoryTask).
//   2. checkForDuplicateDispatch() -- called before a dispatch fires, mirrors
//      ai-os/scripts/superboss-register.py's check_duplicate() (search
//      existing records by category/keyword before building something new),
//      applied here against real dispatch_outcomes history instead of the
//      server's own sqlite system_index. Returns a warning rather than
//      throwing -- callers decide whether to proceed, same "surface, don't
//      silently block" posture the task calls for.
import { createHash } from "node:crypto"
import { db, dispatchOutcomes } from "@/lib/db"
import { and, desc, eq } from "drizzle-orm"

export type DispatchPath = "advisory" | "repo_write"
export type DispatchStatus = "success" | "failure" | "blocked"

export type DispatchRequest = {
  roleKey: string
  objective: string
  scope?: string | null
  successCriteria?: string | null
  complexityTier?: string | null
}

export type RecordDispatchOutcomeInput = DispatchRequest & {
  dispatchPath: DispatchPath
  status: DispatchStatus
  prUrl?: string | null
  errorDetail?: string | null
  modelUsed?: string | null
  orgId?: string | null
  dispatchedBy?: string | null
  dispatchedAt?: Date
  completedAt?: Date
}

/**
 * Normalizes free-text for fingerprinting: trim, collapse internal
 * whitespace runs to a single space, lowercase. Deliberately simple (no
 * stemming/tokenization) -- this is an exact-match-after-normalization
 * check, not a semantic-similarity search; two requests that mean the same
 * thing but are worded differently will NOT collide, which is the correct,
 * conservative failure mode for a duplicate-WARNING (a false negative just
 * means no warning shown; a false positive would wrongly block/flag
 * legitimate distinct work).
 */
function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * sha256(roleKey + normalized objective + normalized scope) -- the exact-
 * duplicate key. Included in every persisted row (request_fingerprint) so
 * checkForDuplicateDispatch() can do a single indexed lookup
 * (idx_dispatch_outcomes_fingerprint) rather than a full-table scan/text
 * comparison on every check.
 */
export function fingerprintDispatchRequest(request: DispatchRequest): string {
  const key = `${normalize(request.roleKey)}::${normalize(request.objective)}::${normalize(request.scope)}`
  return createHash("sha256").update(key).digest("hex")
}

/**
 * Persists one real dispatch completion. Never throws: a write failure here
 * must never surface as a failure of the dispatch itself (the LLM call/repo
 * dispatch already happened, successfully or not, by the time this runs) --
 * logged via console.error for operational visibility instead, same
 * graceful-degradation posture as advisory-dispatch-service.ts.
 */
export async function recordDispatchOutcome(input: RecordDispatchOutcomeInput): Promise<void> {
  try {
    await db.insert(dispatchOutcomes).values({
      roleKey: input.roleKey,
      dispatchPath: input.dispatchPath,
      objective: input.objective,
      scope: input.scope ?? null,
      successCriteria: input.successCriteria ?? null,
      complexityTier: input.complexityTier ?? null,
      requestFingerprint: fingerprintDispatchRequest(input),
      status: input.status,
      prUrl: input.prUrl ?? null,
      errorDetail: input.errorDetail ?? null,
      modelUsed: input.modelUsed ?? null,
      orgId: input.orgId ?? null,
      dispatchedBy: input.dispatchedBy ?? null,
      dispatchedAt: input.dispatchedAt ?? new Date(),
      completedAt: input.completedAt ?? new Date(),
    })
  } catch (err) {
    console.error(
      `[ai-team] dispatch_outcomes: failed to persist outcome for role '${input.roleKey}' (status=${input.status}): ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export type DuplicateDispatchWarning = {
  isDuplicate: true
  priorOutcome: {
    id: string
    status: DispatchStatus
    dispatchPath: DispatchPath
    prUrl: string | null
    dispatchedAt: Date
  }
  message: string
}

export type NoDuplicateDispatch = { isDuplicate: false }

/**
 * "Check before dispatch": the check_duplicate() principle
 * (superboss-register.py) applied to real dispatch_outcomes history. Looks
 * for the most recent prior dispatch with the same request_fingerprint. A
 * PRIOR SUCCESS is the strongest signal ("this exact work already shipped,
 * dispatching again is very likely wasted spend/effort") -- surfaced as a
 * warning rather than a thrown error, so a caller who genuinely wants to
 * retry (e.g. the prior success was later reverted) still can. A prior
 * FAILURE or BLOCKED result is also surfaced -- worth knowing the same
 * request was already tried and didn't land -- but is weighted the same way
 * (still just a warning, never a silent block), since retrying a
 * previously-failed dispatch is often exactly the right call.
 *
 * Never throws: a lookup failure (e.g. transient DB issue) fails OPEN (no
 * warning) rather than blocking a real dispatch on a duplicate-check outage
 * -- same fail-open posture as cost-policy.ts's checkOpenRouterBalance()
 * for network errors, applied here to the analogous "advisory, not a hard
 * gate" check.
 */
export async function checkForDuplicateDispatch(
  request: DispatchRequest
): Promise<DuplicateDispatchWarning | NoDuplicateDispatch> {
  const fingerprint = fingerprintDispatchRequest(request)
  try {
    const prior = await db.query.dispatchOutcomes.findFirst({
      where: and(eq(dispatchOutcomes.requestFingerprint, fingerprint)),
      orderBy: [desc(dispatchOutcomes.dispatchedAt)],
    })
    if (!prior) return { isDuplicate: false }
    return {
      isDuplicate: true,
      priorOutcome: {
        id: prior.id,
        status: prior.status as DispatchStatus,
        dispatchPath: prior.dispatchPath as DispatchPath,
        prUrl: prior.prUrl,
        dispatchedAt: prior.dispatchedAt,
      },
      message: `Role '${request.roleKey}' was already dispatched with this exact objective/scope on ${prior.dispatchedAt.toISOString()} (outcome: ${prior.status}${prior.prUrl ? `, PR: ${prior.prUrl}` : ""}). Dispatching again will likely repeat already-completed work.`,
    }
  } catch (err) {
    console.error(
      `[ai-team] dispatch_outcomes: duplicate-check failed for role '${request.roleKey}', failing open (no warning): ${err instanceof Error ? err.message : String(err)}`
    )
    return { isDuplicate: false }
  }
}
