// D15.B2.S1 (ai-os/tree4-unified/10-merged-governance-layer.yaml, status
// `partial` before this file): "Audits trigger automatically on 10 named
// events (Code Changed->Engineering Audit, Feature Completed->Functional
// Audit, etc.), not only on schedule." 1 of 10 (Code Changed) was already
// wired via .github/workflows/mandatory-audit-check.yml before this file
// existed. This module wires 7 of the other 9 -- deliberately not all 9;
// see this file's own registry comments and the PR description for the
// specific, individual reason each of the remaining 2 (SOP Changed,
// Deployment) is still open, and the honest caveat noted on new_prompt's
// registry entry below (a real trigger, with a real but narrower guarantee
// than the other 6).
//
// Investigated per-event against everything else built this session
// (VERIDIAN_AUDIT_ORGANIZATION.md's ~150-role, 5-division audit
// organization in roster.ts; escalation-ladder.ts; audit_logs via
// logActivity()) specifically to avoid inventing a parallel mechanism:
//
//   - audit_logs (src/lib/audit.ts's logActivity()) is this codebase's one
//     general-purpose, already-wired audit trail -- 13+ call sites already
//     write to it, inside the same withTenantContext transaction as the
//     entity write being logged. Every wired event below writes an
//     `audit_trigger.<event>` row into it, naming which real roster.ts
//     auditor roleKey is responsible for picking the finding up.
//   - Deliberately NOT a synchronous LLM dispatch (e.g. runRole(roleKey,
//     ...)) at each of these 6 routine CRUD write paths -- that would be a
//     materially larger, more expensive, and riskier design than "record
//     that an audit was triggered and who it routes to," and isn't what a
//     narrow slice of this gap calls for. This mirrors the exact posture
//     escalation-ladder.ts's own existing callers already established
//     (task-execution-engine.ts's monitoring_rule_violation/
//     worker_agent_unavailable escalations: compute the rung, write a
//     record, never block or spend an LLM call inline) and
//     capability-audit-service.ts's own "record now, a human or a later
//     process acts on it" precedent (dispatchProposalToHigherAI() is a
//     separate, explicitly-not-auto-invoked step).
//   - escalation-ladder.ts's nextEscalationRung() is reused AS-IS (not
//     duplicated) for the "AI Escalation" event specifically, at its real
//     call site in src/app/api/ai/team/review/route.ts -- the one named
//     event that IS escalation-ladder.ts's own domain.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { users } from "@/lib/db"
import { logActivity } from "@/lib/audit"

export type AuditTriggerEventName =
  | "feature_completed"
  | "report_generated"
  | "knowledge_updated"
  | "revenue_posted"
  | "ai_escalation"
  | "customer_complaint"
  | "new_prompt"

export type AuditTriggerDefinition = {
  event: AuditTriggerEventName
  /** The literal D15.B2.S1 named-event pair, so a reviewer can trace this straight back to the requirement text. */
  sourceRequirement: string
  auditType: string
  /** roster.ts roleKey of the auditor this event's finding should route to. */
  roleKey: string
  /** Present only when roleKey is not a perfect 1:1 name match for the event -- explains the mapping so it isn't a silently invented one. */
  roleKeyRationale?: string
}

// One entry per event this module actually wires (7 of the 9 remaining
// named triggers; #10, Code Changed, was already wired before this file --
// see module header). SOP Changed and Deployment are NOT in this registry:
// investigation (see PR description) found no `sop`/`sops` table or
// SOP-specific status transition anywhere in schema.ts (only the roster.ts
// `sop_auditor` role name exists, with nothing for it to audit yet), and no
// in-app deployment-event table or webhook handler exists (the only real
// "deployment" concept in this repo is the CI workflow already wired for
// event #1). Adding either here would mean inventing a trigger point that
// doesn't correspond to anything real, which this wave deliberately does
// not do.
export const AUDIT_TRIGGER_REGISTRY: Record<AuditTriggerEventName, AuditTriggerDefinition> = {
  feature_completed: {
    event: "feature_completed",
    sourceRequirement: "Feature Completed -> Functional Audit",
    auditType: "Functional Audit",
    roleKey: "functional_auditor",
  },
  report_generated: {
    event: "report_generated",
    sourceRequirement: "Report Generated -> Report Audit",
    auditType: "Report Audit",
    roleKey: "report_auditor",
  },
  knowledge_updated: {
    event: "knowledge_updated",
    sourceRequirement: "Knowledge Updated -> Knowledge Audit",
    auditType: "Knowledge Audit",
    roleKey: "knowledge_auditor",
  },
  revenue_posted: {
    event: "revenue_posted",
    sourceRequirement: "Revenue Posted -> Revenue Audit",
    auditType: "Revenue Audit",
    roleKey: "revenue_recognition_auditor",
  },
  ai_escalation: {
    event: "ai_escalation",
    sourceRequirement: "AI Escalation -> Escalation Audit",
    auditType: "Escalation Audit",
    roleKey: "chief_audit_officer",
    roleKeyRationale:
      "No dedicated 'escalation auditor' role exists among roster.ts's ~150 audit-organization roles -- routed to the Chief Audit Officer (AUDIT_EXECUTIVE) directly, the one role whose mandate is general-purpose per VERIDIAN_AUDIT_ORGANIZATION.md, rather than stretching a differently-scoped division auditor onto this.",
  },
  customer_complaint: {
    event: "customer_complaint",
    sourceRequirement: "Customer Complaint -> Exception Audit",
    auditType: "Exception Audit",
    roleKey: "exception_auditor",
    roleKeyRationale:
      "No dedicated 'complaint auditor' or 'ticket auditor' role exists -- 'Exception Auditor' (AUDIT_BUSINESS_ASSURANCE) is the closest real role: a customer complaint is, in the business-assurance sense, a process exception.",
  },
  new_prompt: {
    event: "new_prompt",
    sourceRequirement: "New Prompt -> Prompt Audit",
    auditType: "Prompt Audit",
    roleKey: "prompt_auditor",
  },
}

export function getAuditTriggerDefinition(event: AuditTriggerEventName): AuditTriggerDefinition {
  return AUDIT_TRIGGER_REGISTRY[event]
}

// ─── Pure transition gates ─────────────────────────────────────────────────
// "feature_completed" and "revenue_posted" are STATUS-TRANSITION events --
// firing on every save (not just the transition into the terminal state)
// would fire once per edit instead of once per completion/posting, which is
// not what "Feature Completed"/"Revenue Posted" mean. The other 5 wired
// events are create-shaped at their own real call site (a new report run, a
// new prompt version, a new ticket, a knowledge-page edit, a guardrail
// escalation) and don't need a transition gate -- calling recordAuditTrigger
// directly at those call sites already fires exactly once per real
// occurrence.

export function didFeatureComplete(previousStatus: string | null | undefined, nextStatus: string | null | undefined): boolean {
  return nextStatus === "completed" && previousStatus !== "completed"
}

export function didRevenuePost(previousStatus: string | null | undefined, nextStatus: string | null | undefined): boolean {
  return nextStatus === "submitted" && previousStatus !== "submitted"
}

// ─── DB-touching: record the trigger ───────────────────────────────────────
//
// Thin wrapper over logActivity() (src/lib/audit.ts) -- deliberately not a
// new table/migration. audit_logs.action is free text by design (see that
// schema column's own comment), so `audit_trigger.<event>` rows sit
// alongside every other action this table already records, queryable the
// same way. Mirrors logActivity()'s own actor/tx contract exactly (not
// re-exported from there because CommonLogActivityParams is module-private
// to audit.ts).
export type RecordAuditTriggerParams = {
  tx: TenantDb
  event: AuditTriggerEventName
  entityType: string
  entityId: string
  orgId: string
  clientId?: string | null
  /** Extra, occurrence-specific context (e.g. "Task \"X\" marked completed.") -- appended after the routing note, never replaces it. */
  details?: string
  request?: Request
} & ({ dbUser: typeof users.$inferSelect; apiKey?: never } | { dbUser?: never; apiKey: { id: string; name: string } })

export async function recordAuditTrigger(params: RecordAuditTriggerParams): Promise<void> {
  const { event, details, ...rest } = params
  const def = getAuditTriggerDefinition(event)
  const routingNote = `${def.auditType} triggered (${def.sourceRequirement}) -- routes to roster.ts role "${def.roleKey}".${
    def.roleKeyRationale ? ` ${def.roleKeyRationale}` : ""
  }`
  await logActivity({
    ...rest,
    action: `audit_trigger.${event}`,
    details: details ? `${routingNote} ${details}` : routingNote,
  } as Parameters<typeof logActivity>[0])
}
