// Package lf-b3-ai-off (owner directive 2026-10-02, "the user's own AI, never ours"; priority: cost near zero first).
//
// PROJEXA does not call ITS OWN AI models. An outside AI -- the user's own assistant -- works through the AI work link, and is billed
// to that user by its own vendor; the in-app model lanes (Level 1 classification, Discuss, progress summary, photo progress, drawing
// diff, meeting minutes intelligence, ai_recipe reports, real embeddings, speech-to-text, the document-extraction model, and every
// cron/worker job whose work is a model call) are switched OFF behind this one flag, default OFF.
//
// THE SWITCH. PROJEXA_INTERNAL_AI_ENABLED must be exactly "1" to turn the internal model lanes back on. Unset, empty, "0", "true",
// "yes", " 1" -- anything else -- is OFF. Same strict shape as dpdp-internal-ai.ts's DPDP_INTERNAL_AI_ENABLED (a typo stays off). It is an
// owner/PM switch, set in the deployment's environment; no agent sets it.
//
// WHERE IT IS ENFORCED. Twice, on purpose:
//   1. inside every model TRANSPORT -- the only modules that reach a model endpoint or spawn a model CLI (llm-client.ts callLLM /
//      callLLMVision, the claude-cli providers, embeddings.ts, whisper-client.ts, level1.ts runLevel1, the document-extraction Edge
//      caller and the internal model gateway). Off, they make no call: a text/vision call throws ProjexaInternalAiOffError, embeddings
//      fall back to the deterministic hash pseudo-vector, Level 1 resolves nothing. So a call site nobody gated by hand still costs nothing.
//   2. at each user-facing call site, so the user gets the plain answer (USE_YOUR_OWN_AI) in the shape the screen already renders, or a
//      deterministic fallback where one exists, and so the cron/worker paths return quietly instead of logging an error per row.
// src/lib/projexa-internal-ai.architecture.test.ts pins (1): no file outside the transports reaches a model endpoint, and the set of
// files that call a transport is frozen, so a NEW call site fails the build until its off-behaviour is decided and documented in
// ai-os/PROJEXA_AI_OFF.md.
//
// THE REFUSAL SHAPE, and why it needs no PROJEXA UI change (projexa repo, read 2026-10-02):
//   * Discuss: VeriComposer.tsx renders a 200's `data.reply` as VERI's message, and turns ANY non-2xx into the generic toast "VERI AI
//     didn't reply -- try again" (wrong: retrying never helps). So Discuss answers 200 {reply: USE_YOUR_OWN_AI}.
//   * Every other surface (assistant codeReferences, construction AI routes, meeting intelligence, document extraction): the screens toast
//     the proxy's `d.error`, and veridian-client.ts turns a 4xx into VeridianApiError(status, code null) whose message is the body's
//     `error`; veridian-response.ts then answers the browser 403 {error, code: null}. So these throw ProjexaInternalAiOffError, a
//     ServiceError 403 whose message is USE_YOUR_OWN_AI: every route that already maps ServiceError to {error: message} carries it unchanged.
//   * The typed composer (M24Shell.tsx): a "gap" verdict's `message` is shown as the notice, so a Level-0 miss keeps the gap verdict and
//     only its wording changes (dry-run.ts gapAnswer).
//
// A LEAF: it imports only service-error.ts (itself a leaf over the error catalog), so llm-client.ts and the ai-work-link-exec bundle can
// import it without gaining a cycle or a heavy dependency.
import { ServiceError } from "@/lib/services/service-error"

export const PROJEXA_INTERNAL_AI_FLAG = "PROJEXA_INTERNAL_AI_ENABLED"

/** Is the internal AI on? Exactly "1"; unset or anything else is off. */
export function projexaInternalAiEnabled(): boolean {
  return process.env[PROJEXA_INTERNAL_AI_FLAG] === "1"
}

/** The one plain-words answer a person gets wherever an internal model would have answered. */
export const USE_YOUR_OWN_AI =
  "PROJEXA does not run its own AI. Open your own AI assistant and paste your PROJEXA AI link. The buttons and menus still work."

/** The ServiceError code the refusal carries (PROJEXA's proxy keeps it as ruleCode; the browser sees {error, code: null}). */
export const PROJEXA_INTERNAL_AI_OFF_CODE = "PROJEXA_INTERNAL_AI_OFF"

/** Thrown where an internal model call was refused because the switch is off. A ServiceError 403, so routes answer {error: USE_YOUR_OWN_AI}. */
export class ProjexaInternalAiOffError extends ServiceError {
  /** Which call site refused, for logs and tests. Never shown to the person. */
  readonly surface: string
  constructor(surface: string) {
    super(USE_YOUR_OWN_AI, 403, { code: PROJEXA_INTERNAL_AI_OFF_CODE, friendlyMessage: USE_YOUR_OWN_AI, kind: "business", retryable: false })
    this.name = "ProjexaInternalAiOffError"
    this.surface = surface
  }
}

/** Throws ProjexaInternalAiOffError unless the switch is on. `surface` names the call site. */
export function assertProjexaInternalAi(surface: string): void {
  if (!projexaInternalAiEnabled()) throw new ProjexaInternalAiOffError(surface)
}

export function isProjexaInternalAiOff(error: unknown): error is ProjexaInternalAiOffError {
  return error instanceof ProjexaInternalAiOffError
}

/** What a cron/worker job returns when it skipped its run because the switch is off: quiet, countable, never an error. */
export const INTERNAL_AI_OFF_SKIP = { skipped: true as const, reason: "internal_ai_off" as const }
