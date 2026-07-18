// AI Architecture / Explainability & Transparency gap-closure (2026-07-18).
// Three separate framework findings collapse into one mechanism: "Explain
// Errors in Simple Language", "Explains Why an Error Occurred", and
// "Explains How to Fix Errors" all recommended the same fix (an error-code
// lookup table feeding friendlyMessage/remediationSteps). This is that
// table. Additive-only, matching TABLE_REGISTRY/ERROR_CODES-style
// conventions already used elsewhere in this codebase (permission-service.ts's
// ERP_ACTION_ROLES, report-engine-service.ts's TABLE_REGISTRY): a flat,
// hand-reviewed map, new keys only.
//
// Not a replacement for `error.message` (which stays the precise, technical
// string every existing `instanceof ServiceError` catch block already
// reads) -- this is additive context a caller can choose to surface.

export type ErrorCodeEntry = {
  /** Plain-language explanation of what happened and why -- no jargon, no stack trace language. */
  friendlyMessage: string
  /** Concrete, ordered steps the user can actually take. Empty array = nothing actionable (e.g. transient/retry). */
  remediationSteps: string[]
}

export const ERROR_CODES: Record<string, ErrorCodeEntry> = {
  NOT_FOUND: {
    friendlyMessage: "The item you're looking for doesn't exist, or you don't have access to it.",
    remediationSteps: ["Double-check the link or ID you used.", "If you followed a link from elsewhere in VERIDIAN, it may point to something that was deleted."],
  },
  VALIDATION_FAILED: {
    friendlyMessage: "Some of the information you entered isn't valid or is missing.",
    remediationSteps: ["Check the highlighted fields and try again.", "Make sure required fields aren't left blank."],
  },
  ALREADY_EXISTS: {
    friendlyMessage: "Something with this name or identifier already exists.",
    remediationSteps: ["Use a different name/value, or find and edit the existing record instead."],
  },
  ALREADY_PROCESSED: {
    friendlyMessage: "This action already happened, so it can't be repeated.",
    remediationSteps: ["Refresh the page to see the current status.", "If this seems wrong, check the record's history for who made the change."],
  },
  AI_NOT_CONFIGURED: {
    friendlyMessage: "No AI model is set up for your organisation yet, so this AI-powered action can't run.",
    remediationSteps: ["Ask an admin to configure an AI provider in Settings -> AI Configuration.", "Once configured, try this action again."],
  },
  AI_REFUSED: {
    friendlyMessage: "The AI declined this specific request as part of a safety/policy check.",
    remediationSteps: ["Rephrase the request without instructions that try to override the AI's rules.", "If you believe this is a mistake, contact your administrator."],
  },
  FEATURE_DISABLED: {
    friendlyMessage: "This feature isn't turned on for your organisation.",
    remediationSteps: ["Ask an admin to enable this module in Settings.", "Check if a different plan/tier is required."],
  },
  PERMISSION_DENIED: {
    friendlyMessage: "Your account role doesn't have permission to do this.",
    remediationSteps: ["Ask a manager/admin to perform this action, or to grant you the needed role."],
  },
  PRECONDITION_MISSING: {
    friendlyMessage: "This action needs something else to happen first, which hasn't happened yet.",
    remediationSteps: ["Check the error's specific message for what's missing.", "Complete that step, then retry."],
  },
} as const

export type ErrorCode = keyof typeof ERROR_CODES

export function lookupErrorCode(code: string | undefined | null): ErrorCodeEntry | undefined {
  if (!code) return undefined
  return ERROR_CODES[code]
}
