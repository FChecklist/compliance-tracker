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

// Wave 155 (TaskDocx_Evaluation.md, "Guardrail for every task... predefined
// message explaining what's violated and what action to take... polite").
// The confirmation dialog previously showed the same generic templated
// sentence for every category ("This looks like a {category} action...").
// This gives each category a real, specific, polite explanation of WHY it
// was flagged and WHAT the user should do -- predefined text, not
// generated, so it's consistent and can never be manipulated by prompt
// content. Kept here (not in the UI component) so the message stays
// co-located with the category it explains, same file organization
// principle as HIGH_IMPACT_CATEGORY_LABELS above.
export const HIGH_IMPACT_CATEGORY_GUIDANCE: Record<HighImpactCategory, string> = {
  delete: "Deletions can't be undone. If you're sure, confirm below — otherwise cancel and double-check what you're removing.",
  archive: "Archiving hides this from active views but keeps the record. Confirm to proceed, or cancel if you meant something else.",
  payment: "Payments move real money and can't be reversed automatically. Confirm only if the amount and recipient are correct.",
  approval: "Approving marks this as officially signed off. Confirm if you've reviewed it, or cancel to look again first.",
  rejection: "Rejecting will notify the requester and close this out. Confirm if that's the right call, or cancel to reconsider.",
  compliance_submission: "Submissions go to the relevant authority and are hard to retract. Confirm only once everything is verified.",
  access_changes: "This changes who can see or do what. Confirm if the person/role is correct, or cancel to review permissions first.",
  data_export: "This exports data outside the platform. Confirm if you need the export, or cancel if this wasn't intentional.",
  configuration_changes: "This changes shared settings for everyone. Confirm if you're sure, or cancel to check the impact first.",
}
