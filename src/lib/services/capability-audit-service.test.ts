/// <reference types="bun-types" />
// Priority 5 (Phase C): unit tests for capability-audit-service.ts's pure
// functions. DB/LLM-touching functions (runCapabilityAudit,
// upsertImprovementProposal, dispatchProposalToHigherAI, closeImprovementLoop,
// findExistingUmrCandidate) are not tested here, matching this codebase's
// established convention (see capability-learning-service.test.ts's own
// stated precedent).
//
// shouldAuditCapability() gets the heaviest coverage on purpose -- it is
// the single most important invariant in this file: the gate that stops
// the Auditor from re-spending a real LLM call on the same
// capability+version combination more than once.
//
// Priority 6 (UMR <-> Software Orchestrator integration) adds coverage for
// the pure decision half of the UMR cross-check: buildUmrSearchQuery,
// pickExistingAssetMatch, pickAssetTypeForFindings, and
// buildTightTaskFromFindings' new existingAssetMatch param.
import { describe, test, expect } from "bun:test"
import {
  shouldAuditCapability,
  buildAuditPrompt,
  parseAuditVerdict,
  mapFindingsToRole,
  buildTightTaskFromFindings,
  buildUmrSearchQuery,
  pickExistingAssetMatch,
  pickAssetTypeForFindings,
  type AuditFindings,
  type ExistingAssetMatch,
} from "./capability-audit-service"
import { computeCoverageStats } from "./capability-learning-service"
import { validateTightTask } from "@/lib/task-tightening"
import type { PlatformAsset } from "./asset-query-service"

function makeAsset(overrides: Partial<PlatformAsset> = {}): PlatformAsset {
  return {
    id: "id-1",
    assetId: "AST-000001",
    name: "GST Penalty Calculator",
    assetType: "computation_engine",
    module: "finance",
    department: null,
    ownerId: null,
    status: "active",
    createdBy: null,
    version: "1.0",
    tags: [],
    aiEnabled: false,
    aiCapabilities: [],
    permissions: [],
    parentAssetId: null,
    searchKeywords: null,
    purpose: "Computes GST late-filing penalties",
    dependencies: [],
    sourceTable: "computation_engines",
    sourceId: "eng-1",
    orgId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as PlatformAsset
}

describe("shouldAuditCapability", () => {
  test("never-audited capability (lastAuditedVersion=null) is eligible", () => {
    expect(shouldAuditCapability({ needsImprovement: "no", lastAuditedVersion: null, version: 1 })).toBe(true)
  })

  test("lastAuditedVersion matching the current version blocks re-audit", () => {
    expect(shouldAuditCapability({ needsImprovement: "no", lastAuditedVersion: 1, version: 1 })).toBe(false)
  })

  test("lastAuditedVersion mismatched with the current version (bumped since) is eligible again", () => {
    expect(shouldAuditCapability({ needsImprovement: "no", lastAuditedVersion: 1, version: 2 })).toBe(true)
  })

  test("needsImprovement='in_progress' blocks re-audit regardless of version state", () => {
    expect(shouldAuditCapability({ needsImprovement: "in_progress", lastAuditedVersion: null, version: 1 })).toBe(false)
    expect(shouldAuditCapability({ needsImprovement: "in_progress", lastAuditedVersion: 1, version: 2 })).toBe(false)
  })

  test("needsImprovement='yes' (audited, fixable, not yet dispatched) does not by itself block re-audit -- only the version match / in_progress do", () => {
    // A capability can be marked 'yes' by a prior audit but dispatch never
    // happened yet (see dispatchProposalToHigherAI()'s own failure path) --
    // it should NOT be silently re-auditable just because it's 'yes' at the
    // SAME version; version-match is still what blocks it here.
    expect(shouldAuditCapability({ needsImprovement: "yes", lastAuditedVersion: 1, version: 1 })).toBe(false)
    expect(shouldAuditCapability({ needsImprovement: "yes", lastAuditedVersion: 1, version: 2 })).toBe(true)
  })

  test("needsImprovement='no' (audited, judged not fixable) stays blocked until version changes", () => {
    expect(shouldAuditCapability({ needsImprovement: "no", lastAuditedVersion: 3, version: 3 })).toBe(false)
    expect(shouldAuditCapability({ needsImprovement: "no", lastAuditedVersion: 3, version: 4 })).toBe(true)
  })
})

describe("buildAuditPrompt", () => {
  const capability = { capabilityKey: "accounts.tax_filing.gst.prepare", modePill: "Accounts", pathKeys: ["GST", "Prepare"], version: 2 }
  const stats = computeCoverageStats(10, 5, 3)

  test("includes the capability key, version, and rolling coverage percentages", () => {
    const prompt = buildAuditPrompt(capability, stats)
    expect(prompt).toContain("accounts.tax_filing.gst.prepare")
    expect(prompt).toContain("version 2")
    expect(prompt).toContain(`${stats.novelPercent}%`)
  })

  test("asks the exact spec question and requests a fenced json block", () => {
    const prompt = buildAuditPrompt(capability, stats)
    expect(prompt.toLowerCase()).toContain("completed 100% by software")
    expect(prompt).toContain("```json")
  })

  test("includes sample lines when provided, omits the section when empty", () => {
    const withSamples = buildAuditPrompt(capability, stats, ["Recurring tokens: gst, filed"])
    expect(withSamples).toContain("Recurring tokens: gst, filed")

    const withoutSamples = buildAuditPrompt(capability, stats, [])
    expect(withoutSamples).not.toContain("actually had to do for this capability recently")
  })

  test("handles a null modePill/pathKeys without throwing", () => {
    expect(() => buildAuditPrompt({ capabilityKey: "x.y", modePill: null, pathKeys: null, version: 1 }, stats)).not.toThrow()
  })
})

describe("parseAuditVerdict", () => {
  test("parses a well-formed fenced json block", () => {
    const content = [
      "The gap here is a missing validator.",
      "```json",
      '{"fixableInSoftware": true, "findings": {"missingValidation": "GSTIN checksum is never validated before submit"}, "reasoning": "Straightforward rule."}',
      "```",
    ].join("\n")
    const verdict = parseAuditVerdict(content)
    expect(verdict).not.toBeNull()
    expect(verdict!.fixableInSoftware).toBe(true)
    expect(verdict!.findings.missingValidation).toBe("GSTIN checksum is never validated before submit")
    expect(verdict!.reasoning).toBe("Straightforward rule.")
  })

  test("falls back to a balanced-brace scan when there's no fenced block", () => {
    const content = 'Some reasoning first. {"fixableInSoftware": false, "findings": {}} trailing text.'
    const verdict = parseAuditVerdict(content)
    expect(verdict).not.toBeNull()
    expect(verdict!.fixableInSoftware).toBe(false)
    expect(verdict!.findings).toEqual({})
  })

  test("balanced-brace scan does not truncate at a nested closing brace", () => {
    const content = '{"fixableInSoftware": true, "findings": {"missingFunction": "needs a helper like foo({x}) somewhere"}}'
    const verdict = parseAuditVerdict(content)
    expect(verdict).not.toBeNull()
    expect(verdict!.findings.missingFunction).toContain("foo({x})")
  })

  test("returns null for empty/whitespace input", () => {
    expect(parseAuditVerdict("")).toBeNull()
    expect(parseAuditVerdict("   ")).toBeNull()
  })

  test("returns null for prose with no JSON at all", () => {
    expect(parseAuditVerdict("This capability cannot be closed in software.")).toBeNull()
  })

  test("returns null when fixableInSoftware is missing or the wrong type", () => {
    expect(parseAuditVerdict('```json\n{"findings": {}}\n```')).toBeNull()
    expect(parseAuditVerdict('```json\n{"fixableInSoftware": "yes", "findings": {}}\n```')).toBeNull()
  })

  test("ignores unrecognized finding keys and non-string finding values", () => {
    const content = '```json\n{"fixableInSoftware": true, "findings": {"missingValidation": "real one", "somethingElse": "ignored", "missingReport": 42}}\n```'
    const verdict = parseAuditVerdict(content)
    expect(verdict!.findings).toEqual({ missingValidation: "real one" })
  })

  test("returns null for malformed JSON inside the fence", () => {
    expect(parseAuditVerdict('```json\n{"fixableInSoftware": true, "findings": {\n```')).toBeNull()
  })
})

describe("mapFindingsToRole", () => {
  test("routes each finding category to a role", () => {
    expect(mapFindingsToRole({ missingFunction: "x" })).toBe("senior_backend_engineer")
    expect(mapFindingsToRole({ missingBusinessRule: "x" })).toBe("senior_backend_engineer")
    expect(mapFindingsToRole({ missingValidation: "x" })).toBe("senior_backend_engineer")
    expect(mapFindingsToRole({ missingApi: "x" })).toBe("senior_backend_engineer")
    expect(mapFindingsToRole({ missingWorkflow: "x" })).toBe("senior_backend_engineer")
    expect(mapFindingsToRole({ missingReport: "x" })).toBe("fullstack_developer")
    expect(mapFindingsToRole({ missingConfiguration: "x" })).toBe("devops_engineer")
    expect(mapFindingsToRole({ missingMetadata: "x" })).toBe("devops_engineer")
    expect(mapFindingsToRole({ missingModePill: "x" })).toBe("frontend_engineer")
    expect(mapFindingsToRole({ missingChainOption: "x" })).toBe("frontend_engineer")
    expect(mapFindingsToRole({ missingScreen: "x" })).toBe("frontend_engineer")
  })

  test("returns null when no recognized finding key is present", () => {
    expect(mapFindingsToRole({})).toBeNull()
  })

  test("is deterministic when multiple findings are present -- picks a single, fixed-precedence role", () => {
    const findings: AuditFindings = { missingScreen: "ui gap", missingApi: "api gap" }
    const a = mapFindingsToRole(findings)
    const b = mapFindingsToRole(findings)
    expect(a).toBe(b)
    expect(a).toBe("senior_backend_engineer") // missingApi precedes missingScreen in FINDING_KEYS order
  })
})

describe("buildTightTaskFromFindings", () => {
  const capability = { capabilityKey: "accounts.tax_filing.gst.prepare", modePill: "Accounts", version: 3 }
  const stats = computeCoverageStats(10, 5, 3)

  test("produces a TightTask that passes validateTightTask (no placeholder/ambiguous text)", () => {
    const task = buildTightTaskFromFindings(capability, { missingValidation: "GSTIN checksum is never validated before submit" }, stats)
    const result = validateTightTask(task)
    expect(result.valid).toBe(true)
  })

  test("embeds the concrete finding text into the objective, not just the category name", () => {
    const task = buildTightTaskFromFindings(capability, { missingFunction: "no helper computes depreciation for asset class X" }, stats)
    expect(task.objective).toContain("no helper computes depreciation for asset class X")
  })

  test("always dispatches at the 'integrative' tier", () => {
    const task = buildTightTaskFromFindings(capability, { missingApi: "no endpoint exists for X" }, stats)
    expect(task.complexityTier).toBe("integrative")
  })

  test("knownContext references real files so validateKnowledgeSufficiency passes", () => {
    const task = buildTightTaskFromFindings(capability, { missingWorkflow: "no workflow strings together steps A and B" }, stats)
    expect(task.knownContext).toContain("capability-learning-service.ts")
    expect(task.knownContext!.length).toBeGreaterThan(10)
  })

  test("multiple findings are all summarized into the objective", () => {
    const task = buildTightTaskFromFindings(
      capability,
      { missingApi: "no endpoint for X", missingScreen: "no screen shows Y" },
      stats
    )
    expect(task.objective).toContain("no endpoint for X")
    expect(task.objective).toContain("no screen shows Y")
  })

  test("Priority 6: omits any UMR note when no existingAssetMatch is given (default)", () => {
    const task = buildTightTaskFromFindings(capability, { missingFunction: "no helper computes X" }, stats)
    expect(task.objective).not.toContain("Universal Metadata Registry")
  })

  test("Priority 6: folds a real existingAssetMatch into the objective, still passes validateTightTask", () => {
    const match: ExistingAssetMatch = {
      assetId: "AST-000042",
      name: "GST Penalty Calculator",
      sourceTable: "computation_engines",
      sourceId: "eng-42",
      assetType: "computation_engine",
    }
    const task = buildTightTaskFromFindings(capability, { missingFunction: "no helper computes GST penalties" }, stats, match)
    expect(task.objective).toContain("Universal Metadata Registry")
    expect(task.objective).toContain("AST-000042")
    expect(task.objective).toContain("GST Penalty Calculator")
    expect(task.objective).toContain("no helper computes GST penalties") // the real gap text is still present, never replaced
    const result = validateTightTask(task)
    expect(result.valid).toBe(true)
  })
})

// ─── Priority 6 (UMR <-> Software Orchestrator integration) ─────────────

describe("buildUmrSearchQuery", () => {
  test("concatenates every present finding's concrete text", () => {
    const query = buildUmrSearchQuery({ missingFunction: "computes GST penalty", missingApi: "no endpoint for filing" })
    expect(query).toContain("computes GST penalty")
    expect(query).toContain("no endpoint for filing")
  })

  test("returns an empty string when findings has no keys", () => {
    expect(buildUmrSearchQuery({})).toBe("")
  })
})

describe("pickExistingAssetMatch", () => {
  test("picks the first active computation_engine candidate", () => {
    const candidates = [makeAsset({ id: "a1", assetType: "report" }), makeAsset({ id: "a2", assetType: "computation_engine", status: "active" })]
    const match = pickExistingAssetMatch(candidates)
    expect(match).not.toBeNull()
    expect(match!.assetId).toBe("AST-000001")
    expect(match!.sourceTable).toBe("computation_engines")
  })

  test("returns null when no candidate is a computation_engine", () => {
    const candidates = [makeAsset({ assetType: "report" }), makeAsset({ assetType: "workflow" })]
    expect(pickExistingAssetMatch(candidates)).toBeNull()
  })

  test("returns null when the only computation_engine candidate is not active", () => {
    const candidates = [makeAsset({ assetType: "computation_engine", status: "archived" })]
    expect(pickExistingAssetMatch(candidates)).toBeNull()
  })

  test("returns null for an empty candidate list", () => {
    expect(pickExistingAssetMatch([])).toBeNull()
  })

  test("respects candidate order (queryByKeywords' own ts_rank ordering) -- picks the first match, not just any match", () => {
    const first = makeAsset({ id: "first", assetId: "AST-000010", assetType: "computation_engine" })
    const second = makeAsset({ id: "second", assetId: "AST-000020", assetType: "computation_engine" })
    const match = pickExistingAssetMatch([first, second])
    expect(match!.assetId).toBe("AST-000010")
  })
})

describe("pickAssetTypeForFindings", () => {
  test("maps each finding category to a valid platform_assets assetType", () => {
    expect(pickAssetTypeForFindings({ missingApi: "x" })).toBe("api")
    expect(pickAssetTypeForFindings({ missingBusinessRule: "x" })).toBe("rule")
    expect(pickAssetTypeForFindings({ missingFunction: "x" })).toBe("function")
    expect(pickAssetTypeForFindings({ missingWorkflow: "x" })).toBe("workflow")
    expect(pickAssetTypeForFindings({ missingValidation: "x" })).toBe("rule")
    expect(pickAssetTypeForFindings({ missingReport: "x" })).toBe("report")
    expect(pickAssetTypeForFindings({ missingConfiguration: "x" })).toBe("other")
    expect(pickAssetTypeForFindings({ missingMetadata: "x" })).toBe("other")
    expect(pickAssetTypeForFindings({ missingModePill: "x" })).toBe("screen")
    expect(pickAssetTypeForFindings({ missingChainOption: "x" })).toBe("dynamic_chain")
    expect(pickAssetTypeForFindings({ missingScreen: "x" })).toBe("screen")
  })

  test("returns 'other' when findings has no recognized key", () => {
    expect(pickAssetTypeForFindings({})).toBe("other")
  })

  test("is deterministic under multiple findings -- picks by fixed FINDING_KEYS precedence", () => {
    const findings: AuditFindings = { missingScreen: "ui gap", missingApi: "api gap" }
    expect(pickAssetTypeForFindings(findings)).toBe("api") // missingApi precedes missingScreen in FINDING_KEYS order
  })
})
