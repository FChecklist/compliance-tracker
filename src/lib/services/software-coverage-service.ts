// Priority 5 (10-priority5-software-orchestrator-tracker.yaml): the
// Software Orchestrator's classification decision -- the X%/Y%/A%/B% split
// made real. Deliberately a PURE decision function, not a DB-touching
// service: callers (task-execution-engine.ts, chat-service.ts) resolve the
// capability/package lookups themselves via capability-learning-service.ts
// and pass the results in here, so this file's own logic is fully
// unit-testable without a live DB, matching this codebase's established
// separation of pure decision logic from lookup plumbing (see
// asset-registry-service.ts's resolveOrgFilterMode()).
//
// Honest scope: this classifies EACH request/turn into exactly one bucket.
// It does NOT compute a literal per-request fractional coverage number
// ("this ONE request is 83% software-coverable") -- that requires
// decomposing a task into independently-checkable sub-steps, a much harder
// planning problem, explicitly out of scope this pass (see the tracker's
// scope_decision). The X%/Y%/A%/B% numbers the Owner's spec describes are
// a ROLLING AGGREGATE STAT per capability (capability-learning-service.ts's
// computeCoverageStats()), built from real classification history.
import type { InstructionPackage } from "./capability-learning-service"

export type ExecutionBucket = "FULL_SOFTWARE" | "PACKAGE_AVAILABLE" | "NOVEL"

export type ClassificationInput = {
  // The CALLER already knows whether this request is 100% software-
  // executable (task-execution-engine.ts's own engineKey/
  // resolvedWorkerAgentId check; response-engine.ts's own predefined-reply
  // match) -- this function does not re-derive that determination, it only
  // decides what happens for the remainder when the caller says "no, AI is
  // needed here."
  alreadyFullSoftware: boolean
  // The approved instruction package for the matched capability, if one
  // exists (capability-learning-service.ts's findApprovedPackage()) --
  // null if no capability was matched at all, or no approved package
  // exists yet for it.
  approvedPackage: InstructionPackage | null
}

export type ClassificationResult =
  | { bucket: "FULL_SOFTWARE" }
  | { bucket: "PACKAGE_AVAILABLE"; package: InstructionPackage }
  | { bucket: "NOVEL" }

// The core X/Y/A/B decision. Deliberately tiny and exhaustive -- every
// branch is directly testable, and the invariant ("PACKAGE_AVAILABLE
// always carries a real package, NOVEL never does") is enforced by the
// return type itself, not just a runtime check.
export function classifyExecution(input: ClassificationInput): ClassificationResult {
  if (input.alreadyFullSoftware) return { bucket: "FULL_SOFTWARE" }
  if (input.approvedPackage) return { bucket: "PACKAGE_AVAILABLE", package: input.approvedPackage }
  return { bucket: "NOVEL" }
}

// A package can exist and be status='approved' yet still not be safe to
// trust blindly forever -- a package whose own tracked successRate has
// degraded should not keep being served as PACKAGE_AVAILABLE (that would
// be exactly the "confidently wrong, cheaply, at scale" failure mode
// flagged during the Owner's own strategic-review discussion). Callers
// should check this BEFORE treating a found package as usable; a failing
// package routes to NOVEL instead, same as if none existed.
export const MIN_ACCEPTABLE_SUCCESS_RATE = 70

export function isPackageReliable(pkg: InstructionPackage): boolean {
  // No usage history yet -- a freshly approved package is trusted once
  // before its own track record can gate it; usageCount=0 means
  // successRate is null, not yet a real signal to distrust.
  if (pkg.usageCount === 0 || pkg.successRate === null) return true
  return pkg.successRate >= MIN_ACCEPTABLE_SUCCESS_RATE
}

// The full decision, folding in reliability -- what callers should
// actually invoke instead of the bare classifyExecution() above.
export function classifyExecutionWithReliability(input: ClassificationInput): ClassificationResult {
  if (input.alreadyFullSoftware) return { bucket: "FULL_SOFTWARE" }
  if (input.approvedPackage && isPackageReliable(input.approvedPackage)) {
    return { bucket: "PACKAGE_AVAILABLE", package: input.approvedPackage }
  }
  return { bucket: "NOVEL" }
}
