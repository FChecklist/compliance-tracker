/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  AUDIT_TRIGGER_REGISTRY,
  didFeatureComplete,
  didRevenuePost,
  getAuditTriggerDefinition,
  type AuditTriggerEventName,
} from "./audit-event-triggers"

const EXPECTED_EVENTS: AuditTriggerEventName[] = [
  "feature_completed",
  "report_generated",
  "knowledge_updated",
  "revenue_posted",
  "ai_escalation",
  "customer_complaint",
  "new_prompt",
  "sop_changed",
  "deployment",
]

describe("AUDIT_TRIGGER_REGISTRY", () => {
  test("wires all 9 remaining named events (Priority 10 added sop_changed, Priority 11 added deployment -- all of D15.B2.S1's 10 events are now wired, #10/Code Changed via the pre-existing CI workflow)", () => {
    expect(Object.keys(AUDIT_TRIGGER_REGISTRY).sort()).toEqual([...EXPECTED_EVENTS].sort())
  })

  test("registers Deployment, routed to roster.ts's pre-existing deployment_auditor role -- fired from the real Vercel webhook receiver, not force-fit", () => {
    expect("deployment" in AUDIT_TRIGGER_REGISTRY).toBe(true)
    expect(getAuditTriggerDefinition("deployment").roleKey).toBe("deployment_auditor")
  })

  test("every entry has a non-empty roleKey, auditType, and sourceRequirement traceable to D15.B2.S1's named event list", () => {
    for (const event of EXPECTED_EVENTS) {
      const def = getAuditTriggerDefinition(event)
      expect(def.roleKey.length).toBeGreaterThan(0)
      expect(def.auditType.length).toBeGreaterThan(0)
      expect(def.sourceRequirement).toContain("->")
    }
  })

  test("getAuditTriggerDefinition resolves the correct roleKey for each event", () => {
    expect(getAuditTriggerDefinition("feature_completed").roleKey).toBe("functional_auditor")
    expect(getAuditTriggerDefinition("report_generated").roleKey).toBe("report_auditor")
    expect(getAuditTriggerDefinition("knowledge_updated").roleKey).toBe("knowledge_auditor")
    expect(getAuditTriggerDefinition("revenue_posted").roleKey).toBe("revenue_recognition_auditor")
    expect(getAuditTriggerDefinition("ai_escalation").roleKey).toBe("chief_audit_officer")
    expect(getAuditTriggerDefinition("customer_complaint").roleKey).toBe("exception_auditor")
    expect(getAuditTriggerDefinition("new_prompt").roleKey).toBe("prompt_auditor")
    expect(getAuditTriggerDefinition("sop_changed").roleKey).toBe("sop_auditor")
    expect(getAuditTriggerDefinition("deployment").roleKey).toBe("deployment_auditor")
  })

  test("ai_escalation and customer_complaint carry an honest roleKeyRationale (no dedicated role exists for either)", () => {
    expect(getAuditTriggerDefinition("ai_escalation").roleKeyRationale).toBeDefined()
    expect(getAuditTriggerDefinition("customer_complaint").roleKeyRationale).toBeDefined()
  })

  test("events with a clean 1:1 role name match carry no rationale (nothing to explain)", () => {
    expect(getAuditTriggerDefinition("feature_completed").roleKeyRationale).toBeUndefined()
    expect(getAuditTriggerDefinition("new_prompt").roleKeyRationale).toBeUndefined()
    expect(getAuditTriggerDefinition("sop_changed").roleKeyRationale).toBeUndefined()
    expect(getAuditTriggerDefinition("deployment").roleKeyRationale).toBeUndefined()
  })
})

describe("didFeatureComplete", () => {
  test("fires when status transitions into 'completed'", () => {
    expect(didFeatureComplete("in_progress", "completed")).toBe(true)
    expect(didFeatureComplete("pending", "completed")).toBe(true)
    expect(didFeatureComplete(null, "completed")).toBe(true)
    expect(didFeatureComplete(undefined, "completed")).toBe(true)
  })

  test("does not fire when already completed (no real transition)", () => {
    expect(didFeatureComplete("completed", "completed")).toBe(false)
  })

  test("does not fire when the new status isn't 'completed'", () => {
    expect(didFeatureComplete("pending", "in_progress")).toBe(false)
    expect(didFeatureComplete("in_progress", "failed")).toBe(false)
    expect(didFeatureComplete("completed", "in_progress")).toBe(false)
  })
})

describe("didRevenuePost", () => {
  test("fires when an invoice transitions into 'submitted'", () => {
    expect(didRevenuePost("draft", "submitted")).toBe(true)
    expect(didRevenuePost(null, "submitted")).toBe(true)
  })

  test("does not fire when already submitted (no real transition)", () => {
    expect(didRevenuePost("submitted", "submitted")).toBe(false)
  })

  test("does not fire for a non-submitted next status", () => {
    expect(didRevenuePost("draft", "cancelled")).toBe(false)
    expect(didRevenuePost("submitted", "paid")).toBe(false)
  })
})
