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
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"

export type HighImpactCategory =
  | "delete" | "archive" | "payment" | "approval" | "rejection"
  | "compliance_submission" | "access_changes" | "data_export" | "configuration_changes"
  // AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
  // see HIGH_IMPACT_CATEGORY_GUIDANCE's own comment below for why these 3.
  | "bulk_operations" | "communication_send" | "financial_posting"

const TRIGGERS: Record<HighImpactCategory, string[]> = {
  // "dispose"/"disposal" added for the Checks & Balances / Four-Eyes cross-
  // wire (approval-workflow-service.ts): a fixed-asset disposal is a real
  // permanent removal of an asset from the books, same category as any
  // other delete, even though the entityType string itself is
  // "erp_asset_disposal" not "erp_asset_delete". Additive -- widens every
  // existing consumer of this detector (AI Team dispatch risk
  // classification, task/chat high-impact confirmation), not just the
  // approval workflow engine.
  delete: ["delete", "remove", "erase", "permanently delete", "dispose", "disposal"],
  archive: ["archive"],
  payment: ["pay ", "payment", "make a payment", "release payment", "transfer funds", "disburse"],
  approval: ["approve", "approval", "sign off", "authorize", "authorise"],
  rejection: ["reject", "rejection", "decline", "deny"],
  compliance_submission: ["submit", "file return", "file gst", "file tds", "file the return", "submit compliance", "submit return"],
  access_changes: ["grant access", "revoke access", "change permission", "change role", "add admin", "remove admin", "change password", "reset password"],
  data_export: ["export data", "export report", "bulk export", "download all"],
  configuration_changes: ["change setting", "update configuration", "modify config", "change config"],
  // "delete" itself is checked earlier in TRIGGERS' iteration order and
  // already catches any "delete ..." phrasing, so it's deliberately not
  // duplicated here (a duplicate trigger here could never actually fire).
  bulk_operations: ["reassign all", "bulk reassign", "bulk update", "apply to all", "update all records"],
  communication_send: ["send email", "send an email", "send message", "notify all", "email all", "broadcast"],
  financial_posting: ["post journal", "post entry", "close the period", "close period", "post to ledger", "finalize the books"],
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
  bulk_operations: "Bulk Operation",
  communication_send: "Send Communication",
  financial_posting: "Financial Posting",
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
// Human Override & Approval (VERIDIAN Review Framework gap closure,
// 2026-07-18, HAB-02's own stated gap: "each module implements its own
// confirmation/authorization independently -- not a single unified generic
// gate"). Before this, the one real "confirmed boolean -> block execution"
// implementation in the codebase was inlined directly inside
// task-service.ts's createTask (detectHighImpactAction + response-shaping,
// duplicated logic any future module would otherwise have had to copy
// rather than call). This is that logic, extracted once so it's a real
// reusable function -- task-service.ts now calls it instead of
// reimplementing it (see that file for the one adjustment layered on top:
// a per-user saved always-approve/always-reject preference, which is a
// task/chat-specific persistence concern, not part of this generic gate).
//
// Honestly scoped: this closes the "each module reimplements the check"
// half of the gap for its first real adopter. It is not yet wired as
// unconditional middleware across every route -- that would require a
// broader Intent Engine (this file's own header already flags that as a
// deferred Phase 3 item) or auditing every high-impact route individually,
// neither of which this pass attempts. Future modules that need the same
// gate should call this function rather than re-inlining the check.
export type ConfirmationCheckInput = { text: string; confirmed?: boolean }
export type ConfirmationCheckResult =
  | { needsConfirmation: false }
  | { needsConfirmation: true; category: HighImpactCategory; categoryLabel: string; matchedPhrase: string; guidance: string }

export function checkHighImpactConfirmation(input: ConfirmationCheckInput): ConfirmationCheckResult {
  if (input.confirmed) return { needsConfirmation: false }
  const detection = detectHighImpactAction(input.text)
  if (!detection.isHighImpact || !detection.category) return { needsConfirmation: false }
  return {
    needsConfirmation: true,
    category: detection.category,
    categoryLabel: HIGH_IMPACT_CATEGORY_LABELS[detection.category],
    matchedPhrase: detection.matchedPhrase ?? "",
    guidance: HIGH_IMPACT_CATEGORY_GUIDANCE[detection.category],
  }
}

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
  // AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
  // "Explain Impact of Decisions" -- broadened from 9 to 12 categories.
  // Picked by re-reading TRIGGERS above against what's actually reachable
  // through this same gate (task-service.ts's createTask, VeriComposer) but
  // had no matching category yet: bulk operations (bulkReassignLeads/
  // bulkReassignOpportunities-style "affect many records at once" actions),
  // outbound communication (email/notification sends this platform's own
  // email-intelligence-service.ts/notifyAssigned() already perform on a
  // user's behalf), and financial-ledger posting specifically (distinct
  // from "payment" above -- posting a journal entry/closing a period
  // doesn't move money but does lock in an accounting record the same way
  // a payment locks in a cash movement).
  bulk_operations: "This affects many records at once. Confirm the count/filter is right, or cancel to narrow it down first.",
  communication_send: "This sends a message to someone outside your own review. Confirm the content and recipient are correct, or cancel to revise first.",
  financial_posting: "This posts a permanent accounting record (e.g. a journal entry or period close). Confirm the figures are correct, or cancel to review first.",
}

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain Risks Before Actions" (Low, two duplicate findings) -- the
// keyword/regex gate above can miss a risky action phrased unusually (e.g.
// "wipe this record" instead of "delete"). detectHighImpactAction() itself
// stays a pure, side-effect-free function (unchanged) so it's still safe to
// call speculatively/in tests; this is a SEPARATE, best-effort call a real
// AI-initiated-write call site can make right after detection, logging the
// classification outcome (matched OR not) so a human can later sample rows
// where isHighImpact=false and check whether that was actually correct.
// Fire-and-forget, same posture as recordOrchestraExecution's own callers --
// audit logging must never block or fail the real write it's observing.
export function logHighImpactClassification(params: {
  orgId: string; userId?: string; layerKey: string; eventType: string
  text: string; detection: HighImpactDetection
}): void {
  recordOrchestraExecution({
    orgId: params.orgId, userId: params.userId, layerKey: params.layerKey,
    eventType: `${params.eventType}.high_impact_classification`,
    // Truncated -- this is a sample-audit trail for classification quality,
    // not a full content log (that's what orchestra_executions' own
    // eventType-specific "completed" row already does for the real action).
    input: { text: params.text.slice(0, 500) },
    output: { isHighImpact: params.detection.isHighImpact, category: params.detection.category, matchedPhrase: params.detection.matchedPhrase },
    status: "completed", durationMs: 0,
  })
}
