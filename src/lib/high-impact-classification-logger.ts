// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain Risks Before Actions" (Low, two duplicate findings) -- the
// keyword/regex gate in high-impact-action-detector.ts can miss a risky
// action phrased unusually (e.g. "wipe this record" instead of "delete").
// detectHighImpactAction() itself stays a pure, side-effect-free function so
// it's still safe to call speculatively/in tests; this is a SEPARATE,
// best-effort call a real AI-initiated-write call site can make right after
// detection, logging the classification outcome (matched OR not) so a human
// can later sample rows where isHighImpact=false and check whether that was
// actually correct. Fire-and-forget, same posture as recordOrchestraExecution's
// own callers -- audit logging must never block or fail the real write it's
// observing.
//
// Deliberately a separate file from high-impact-action-detector.ts: that
// file is imported directly by ApprovalMatrixSection.tsx (a client
// component), and recordOrchestraExecution's module pulls in @/lib/db (the
// `postgres` package, Node-only) -- keeping that import here instead of
// there is what keeps the client bundle buildable (see that file's own
// header for the exact build failure this split fixes).
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import type { HighImpactDetection } from "@/lib/high-impact-action-detector"

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
