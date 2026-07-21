// Super Boss v2 task V2-9: tests for the loop-derived-insight notification

// renderer + audience decision. Only the PURE functions are tested here
// (summarizeLoopInsight, audienceKindForTarget, describeTarget via
// summarize) -- the DB-touching resolveInsightRecipients / notifyLoopInsight
// are best-effort fan-out wrappers with no correctness logic of their own,
// same split as byo-model-audit.test.ts (detectMissedEscalations pure,
// runByoModelAudit DB) and task-nudge-digest-service.test.ts
// (groupTasksForNudge/summarizeNudgeGroup pure, runTaskNudgeDigest DB).
import { describe, expect, test } from "bun:test"
import { summarizeLoopInsight, audienceKindForTarget } from "./loop-insight-notifier"
import type { LoopImprovementProposal } from "./loop-improvement-proposer"

function proposal(overrides: Partial<LoopImprovementProposal> & { loopId: string }): LoopImprovementProposal {
  return {
    improvementType: "raise_floor_tier_default",
    targetType: "org",
    targetId: "org-1",
    improvementDelta: 0.42,
    ...overrides,
  }
}

describe("audienceKindForTarget", () => {
  test("org -> org audience", () => {
    expect(audienceKindForTarget("org")).toBe("org")
  })
  test("platform -> platform audience", () => {
    expect(audienceKindForTarget("platform")).toBe("platform")
  })
  test("worker_agent -> none (infra-level, no human recipient)", () => {
    expect(audienceKindForTarget("worker_agent")).toBe("none")
  })
  test("api_key -> none", () => {
    expect(audienceKindForTarget("api_key")).toBe("none")
  })
  test("mcp_access_code -> none", () => {
    expect(audienceKindForTarget("mcp_access_code")).toBe("none")
  })
  test("unknown target type -> none (never fabricate an audience)", () => {
    expect(audienceKindForTarget("something_new")).toBe("none")
  })
})

describe("summarizeLoopInsight", () => {
  test("renders a known improvementType to a human label in the title", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", improvementType: "raise_floor_tier_default" }))
    expect(r.title).toBe("Process improvement suggested: raise default AI model tier")
  })

  test("falls through to a space-ized label for an unknown improvementType (no information loss)", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-x", improvementType: "some_new_signal" }))
    expect(r.title).toBe("Process improvement suggested: some new signal")
  })

  test("maps every improvementType the loops currently emit to a readable label", () => {
    const known = [
      "raise_floor_tier_default",
      "review_escalation_signal_coverage",
      "fix_tier_scoping_mismatch",
      "revoke_stale_api_key",
      "revoke_stale_mcp_code",
    ] as const
    for (const t of known) {
      const r = summarizeLoopInsight(proposal({ loopId: "l", improvementType: t }))
      // Never the raw snake_case form -- every known type gets a real label.
      expect(r.title).not.toMatch(/_/)
      expect(r.title.startsWith("Process improvement suggested: ")).toBe(true)
    }
  })

  test("message is conversational ('suggests a review'), never claims an action was taken", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14" }))
    expect(r.message).toMatch(/suggests a review/)
    // The framing is a suggestion, never an autonomous action.
    expect(r.message).not.toMatch(/changed|will change|has been raised|applied/)
  })

  test("includes the signal strength when improvementDelta is present", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", improvementDelta: 0.42 }))
    expect(r.message).toMatch(/signal strength: 0.42/)
  })

  test("omits the signal-strength clause when improvementDelta is null/undefined", () => {
    const r1 = summarizeLoopInsight(proposal({ loopId: "loop-14", improvementDelta: null }))
    const r2 = summarizeLoopInsight(proposal({ loopId: "loop-14", improvementDelta: undefined }))
    expect(r1.message).not.toMatch(/signal strength/)
    expect(r2.message).not.toMatch(/signal strength/)
  })

  test("org target describes the floor-tier-escalation symptom conversationally", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", targetType: "org", targetId: "org-abc" }))
    expect(r.message).toMatch(/an org \(org-abc\) whose AI calls keep tripping floor-tier escalation/)
  })

  test("platform target describes the escalation-signal-coverage framing", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", targetType: "platform", targetId: "floor-tier-escalation.ts" }))
    expect(r.message).toMatch(/platform-level pattern in escalation-signal coverage/)
  })

  test("worker_agent target describes the tier-scoping mismatch", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-13", targetType: "worker_agent", targetId: "agent-9" }))
    expect(r.message).toMatch(/agent \(agent-9\) whose tier scoping doesn't match its access columns/)
  })

  test("api_key / mcp_access_code targets render without crashing", () => {
    const apiKey = summarizeLoopInsight(proposal({ loopId: "loop-9", targetType: "api_key", targetId: "key-1" }))
    expect(apiKey.message).toMatch(/stale API key \(key-1\)/)
    const mcp = summarizeLoopInsight(proposal({ loopId: "loop-9", targetType: "mcp_access_code", targetId: "code-1" }))
    expect(mcp.message).toMatch(/stale MCP access code \(code-1\)/)
  })

  test("metadata is tagged kind:'loop_insight' (discriminator, since type reuses the 'system' enum value)", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", improvementDelta: 0.5 }))
    expect(r.metadata.kind).toBe("loop_insight")
    expect(r.metadata.loopId).toBe("loop-14")
    expect(r.metadata.improvementType).toBe("raise_floor_tier_default")
    expect(r.metadata.targetType).toBe("org")
    expect(r.metadata.targetId).toBe("org-1")
    expect(r.metadata.improvementDelta).toBe("0.5")
  })

  test("metadata.improvementDelta is null when the proposal carries no delta", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", improvementDelta: null }))
    expect(r.metadata.improvementDelta).toBeNull()
  })

  test("metadata.targetId is null when the proposal omits it", () => {
    const r = summarizeLoopInsight(proposal({ loopId: "loop-14", targetId: null }))
    expect(r.metadata.targetId).toBeNull()
  })

  test("title/message are non-empty for every target type (never emits a blank nudge)", () => {
    for (const targetType of ["org", "platform", "worker_agent", "api_key", "mcp_access_code"]) {
      const r = summarizeLoopInsight(proposal({ loopId: "l", targetType, targetId: "x" }))
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.message.length).toBeGreaterThan(0)
    }
  })
})
