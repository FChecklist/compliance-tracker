// The service layer's error class, as a LEAF module (BUILD-002 WP-09b, blocker B6 of the ai-work-link-exec bundle).
//
// It was defined in compliance-service.ts, which imports the postgres client, the email sender (resend) and the reward service, so every service
// (they all import ServiceError from there) dragged those in. The class is moved here VERBATIM and compliance-service.ts re-exports it, so the
// class is the same object for every importer (`instanceof ServiceError` still holds across modules) and no importer changes. The exec bundle
// (scripts/awl-exec-aliases.mjs) maps compliance-service.ts to this file, so a link write reaches none of the heavy modules.
//
// Nothing here may import anything but the error catalog (a data leaf). Keep it that way.
import { lookupErrorCode, type ErrorCode } from "@/lib/errors/error-catalog"

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// `code` is optional and additive -- every existing `new ServiceError(message,
// status)` call site across the codebase keeps working unchanged. When a
// caller does pass a code that matches ERROR_CODES, friendlyMessage/
// remediationSteps are looked up automatically; a caller can also pass its
// own explicit friendlyMessage/remediationSteps to override the catalog
// (e.g. when the technical message already needs a one-off explanation the
// generic catalog entry doesn't cover). `message` remains the precise,
// technical string every current `instanceof ServiceError` catch block
// already reads -- this never changes existing behavior, only adds fields a
// caller can opt into surfacing.
//
// Exception Handling Framework (VERIDIAN Review Framework gap closure,
// Checks & Balances / Exception Handling & Recovery track, 2026-07-18):
// every service function in this codebase already threw a real, meaningful
// ServiceError -- what didn't exist was a single NAMED taxonomy classifying
// those errors so callers could make automatic decisions (retry it, or
// surface it to the user as their own mistake) without special-casing every
// message string. Two axes:
//   - "business" exception: the request itself is invalid or violates a
//     domain rule (e.g. "asOfDate is required", "period is closed").
//     Retrying the identical input fails identically -- terminal.
//   - "system" exception: an unexpected failure in infrastructure the
//     caller doesn't control (DB blip, timeout). Often transient -- worth
//     one automatic retry (see exception-taxonomy.ts::withAutomaticRecovery)
//     before giving up.
// `kind`/`retryable` default from the existing `status` so every one of the
// ~137 files that already do `throw new ServiceError(msg, 400)` classifies
// itself correctly with ZERO changes required (>=500 -> system/retryable,
// <500 -> business/non-retryable). Pass the third arg only to override that
// default (e.g. a 409 conflict from a transient advisory-lock contention,
// which IS worth retrying once despite being a 4xx).
export type ExceptionKind = "business" | "system"

export class ServiceError extends Error {
  public code?: ErrorCode | string
  public friendlyMessage?: string
  public remediationSteps?: string[]
  public readonly kind: ExceptionKind
  public readonly retryable: boolean
  // `fields` is additive and optional (VERIDIAN Review Framework
  // gap-closure, CRM Leads "Error Handling & Data Validation Messaging"):
  // a per-field message map for callers that want to render Zod-style
  // field-level feedback instead of one generic string. Every existing
  // 2-arg `new ServiceError(message, status)` call site across the
  // codebase is unaffected -- this parameter is optional and undefined
  // unless a caller explicitly passes it.
  public fields?: Record<string, string>

  constructor(
    message: string,
    public status: number,
    opts?: {
      code?: ErrorCode | string
      friendlyMessage?: string
      remediationSteps?: string[]
      kind?: ExceptionKind
      retryable?: boolean
      fields?: Record<string, string>
    }
  ) {
    super(message)
    this.code = opts?.code
    const catalogEntry = lookupErrorCode(opts?.code)
    this.friendlyMessage = opts?.friendlyMessage ?? catalogEntry?.friendlyMessage
    this.remediationSteps = opts?.remediationSteps ?? catalogEntry?.remediationSteps
    this.kind = opts?.kind ?? (status >= 500 ? "system" : "business")
    this.retryable = opts?.retryable ?? this.kind === "system"
    this.fields = opts?.fields
  }
}

/**
 * The additive response-body shape a route CAN opt into for a ServiceError
 * catch (existing `{ error: error.message }` call sites are untouched --
 * this is a new, richer alternative, not a required migration).
 */
export function serviceErrorBody(error: ServiceError) {
  return {
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.friendlyMessage ? { friendlyMessage: error.friendlyMessage } : {}),
    ...(error.remediationSteps?.length ? { remediationSteps: error.remediationSteps } : {}),
  }
}
