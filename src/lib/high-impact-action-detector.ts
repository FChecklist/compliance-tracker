// Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2): "High-Impact
// Action Confirmation Gate" -- VERIDIAN.docx CSV 205 §26 (Human-in-Control
// Rules) names Delete/Archive/Payment/Approval/Rejection/Compliance
// Submission/Access Changes/Data Export/Configuration Changes as intents
// that must never execute silently -- "prediction is acceptable, execution
// requires policy or approval." The full Intent Engine this ideally builds
// on is a deferred Phase 3 item; this is a deterministic keyword-based
// stand-in, matching this codebase's existing preference for cheap
// deterministic gates over LLM classification wherever a gate needs to be
// unconditionally reliable (see policy-enforcement-engine.ts's own
// reasoning for the same choice).

export type HighImpactCategory =
  | "delete" | "archive" | "payment" | "approval" | "rejection"
  | "compliance_submission" | "access_changes" | "data_export" | "configuration_changes"

const TRIGGERS: Record<HighImpactCategory, string[]> = {
  delete: ["delete", "remove", "erase", "permanently delete"],
  archive: ["archive"],
  payment: ["pay ", "payment", "make a payment", "release payment", "transfer funds", "disburse"],
  approval: ["approve", "approval", "sign off", "authorize", "authorise"],
  rejection: ["reject", "rejection", "decline", "deny"],
  compliance_submission: ["submit", "file return", "file gst", "file tds", "file the return", "submit compliance", "submit return"],
  access_changes: ["grant access", "revoke access", "change permission", "change role", "add admin", "remove admin", "change password", "reset password"],
  data_export: ["export data", "export report", "bulk export", "download all"],
  configuration_changes: ["change setting", "update configuration", "modify config", "change config"],
}

export type HighImpactDetection = { isHighImpact: boolean; category: HighImpactCategory | null; matchedPhrase: string | null }

function toWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
}

/** Deterministic, case-insensitive phrase match -- no LLM call. */
export function detectHighImpactAction(text: string): HighImpactDetection {
  const normalized = text.trim()
  if (!normalized) return { isHighImpact: false, category: null, matchedPhrase: null }

  for (const [category, phrases] of Object.entries(TRIGGERS) as [HighImpactCategory, string[]][]) {
    for (const phrase of phrases) {
      if (toWordBoundaryRegex(phrase).test(normalized)) {
        return { isHighImpact: true, category, matchedPhrase: phrase.trim() }
      }
    }
  }
  return { isHighImpact: false, category: null, matchedPhrase: null }
}

export const HIGH_IMPACT_CATEGORY_LABELS: Record<HighImpactCategory, string> = {
  delete: "Delete",
  archive: "Archive",
  payment: "Payment",
  approval: "Approval",
  rejection: "Rejection",
  compliance_submission: "Compliance Submission",
  access_changes: "Access Change",
  data_export: "Data Export",
  configuration_changes: "Configuration Change",
}
