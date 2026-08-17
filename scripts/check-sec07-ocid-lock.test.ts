/// <reference types="bun-types" />
// Real automated test for the SEC-07/Hard Rule 7 pre-merge gate
// (UMR-20260805-025554-46f9). Proves the gate genuinely blocks a real synthetic PR
// touching locked scope while OCID-020 is not verified, and genuinely allows a real
// synthetic PR touching unrelated scope -- against the same pure evaluate() function
// the real CI workflow calls, no mocked internals.
import { describe, test, expect } from "bun:test"
import { evaluate, findSelfIdentifiedLockedOcids, findManifestMatchedLockedOcids, readOcid020Status, hasValidOverride } from "./check-sec07-ocid-lock.mjs"

const MANIFEST = {
  ocid_038: { paths: ["src/app/login/page.tsx", "src/lib/services/org-branding-service.ts"] },
  ocid_039: { paths: [] },
  ocid_040: { paths: [] },
  ocid_041_046: { paths: [] },
}

const NOT_VERIFIED_TRACKER = `
ocid_020_status:
  status: "NOT_VERIFIED"
`

const VERIFIED_TRACKER = `
ocid_020_status:
  status: "VERIFIED"
`

const NO_BLOCK_TRACKER = `
open_items:
  - id: GAP-SOMETHING
`

const EMPTY_OVERRIDES = `overrides: []`

const OVERRIDE_FOR_PR_900 = `
overrides:
  - pr_number: 900
    umr_id: "UMR-20260804-172011-b839"
    granted_by: "Owner"
    granted_at: "2026-08-04T17:20:11Z"
    reason: "test fixture"
`

describe("REGRESSION: real synthetic PR touching locked scope while OCID-020 not verified is BLOCKED", () => {
  test("changed-file manifest match (PR #886's own real shape) with no override", () => {
    const result = evaluate({
      changedFiles: ["src/app/login/page.tsx", "drizzle/0312_stage1_preauth_brand_host_lookup.sql"],
      prTitle: "OCID-038 real gap closure: Stage 1 pre-authentication domain-based brand resolution",
      prBody: "Real implementation closing the OCID-038 gap.",
      prNumber: 9999,
      manifest: MANIFEST,
      masterTrackerYamlText: NOT_VERIFIED_TRACKER,
      overridesYamlText: EMPTY_OVERRIDES,
    })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain("BLOCKED")
    expect(result.reason).toContain("SEC-07")
    expect(result.reason).toContain("OCID-038")
    expect(result.reason).toContain("NOT_VERIFIED")
  })

  test("self-identification-only match (new file, no manifest entry yet) still blocks", () => {
    const result = evaluate({
      changedFiles: ["src/app/api/some/brand-new-route.ts"],
      prTitle: "OCID-039 real gap closure: production certification wave 1",
      prBody: "",
      prNumber: 9999,
      manifest: MANIFEST,
      masterTrackerYamlText: NOT_VERIFIED_TRACKER,
      overridesYamlText: EMPTY_OVERRIDES,
    })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain("OCID-039")
  })

  test("no ocid_020_status block at all in MASTER-TRACKER.yaml fails closed", () => {
    const result = evaluate({
      changedFiles: ["src/lib/services/org-branding-service.ts"],
      prTitle: "OCID-038 real fix",
      prBody: "",
      prNumber: 9999,
      manifest: MANIFEST,
      masterTrackerYamlText: NO_BLOCK_TRACKER,
      overridesYamlText: EMPTY_OVERRIDES,
    })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain("no ocid_020_status block found")
  })
})

describe("REGRESSION: real synthetic PR touching unrelated scope is ALLOWED", () => {
  test("unrelated file, unrelated title, OCID-020 not verified -- still allowed (no lock concern)", () => {
    const result = evaluate({
      changedFiles: ["src/app/reports/page.tsx", "src/lib/services/report-engine-service.ts"],
      prTitle: "fix: real live-found bug -- reports pagination off-by-one",
      prBody: "Unrelated bug fix, nothing to do with OCID-038/039/040.",
      prNumber: 9999,
      manifest: MANIFEST,
      masterTrackerYamlText: NOT_VERIFIED_TRACKER,
      overridesYamlText: EMPTY_OVERRIDES,
    })
    expect(result.blocked).toBe(false)
    expect(result.reason).toContain("No SEC-07 concern")
  })

  test("a bare OCID-038 mention with no implementation framing does not trigger (legitimate discovery/planning text)", () => {
    const result = evaluate({
      changedFiles: ["ai-os/VERIDIAN_OCID_038_SOME_DISCOVERY_DOC.md"],
      prTitle: "docs: OCID-038 discovery findings, no implementation",
      prBody: "Read-only discovery per SEC-07's own still-allowed scope.",
      prNumber: 9999,
      manifest: MANIFEST,
      masterTrackerYamlText: NOT_VERIFIED_TRACKER,
      overridesYamlText: EMPTY_OVERRIDES,
    })
    expect(result.blocked).toBe(false)
  })
})

describe("OCID-020 VERIFIED status unlocks the gate", () => {
  test("locked scope touched but OCID-020 is VERIFIED -- allowed", () => {
    const result = evaluate({
      changedFiles: ["src/app/login/page.tsx"],
      prTitle: "OCID-038 real gap closure",
      prBody: "",
      prNumber: 9999,
      manifest: MANIFEST,
      masterTrackerYamlText: VERIFIED_TRACKER,
      overridesYamlText: EMPTY_OVERRIDES,
    })
    expect(result.blocked).toBe(false)
    expect(result.reason).toContain("VERIFIED")
  })
})

describe("real, narrowly-scoped override -- never a blanket bypass", () => {
  test("an override entry for THIS exact PR number allows it", () => {
    const result = evaluate({
      changedFiles: ["src/app/login/page.tsx"],
      prTitle: "OCID-038 real gap closure",
      prBody: "",
      prNumber: 900,
      manifest: MANIFEST,
      masterTrackerYamlText: NOT_VERIFIED_TRACKER,
      overridesYamlText: OVERRIDE_FOR_PR_900,
    })
    expect(result.blocked).toBe(false)
    expect(result.reason).toContain("UMR-20260804-172011-b839")
  })

  test("REGRESSION: an override for a DIFFERENT PR number does NOT allow this one (no blanket bypass)", () => {
    const result = evaluate({
      changedFiles: ["src/app/login/page.tsx"],
      prTitle: "OCID-038 real gap closure",
      prBody: "",
      prNumber: 901,
      manifest: MANIFEST,
      masterTrackerYamlText: NOT_VERIFIED_TRACKER,
      overridesYamlText: OVERRIDE_FOR_PR_900,
    })
    expect(result.blocked).toBe(true)
  })
})

describe("pure helper functions", () => {
  test("findSelfIdentifiedLockedOcids requires both an OCID number and implementation framing", () => {
    expect(findSelfIdentifiedLockedOcids("OCID-038 discovery only", "")).toEqual([])
    expect(findSelfIdentifiedLockedOcids("real implementation of the login flow", "")).toEqual([])
    expect(findSelfIdentifiedLockedOcids("OCID-040 real implementation", "")).toEqual(["ocid_040"])
  })

  test("findManifestMatchedLockedOcids matches exact real paths only", () => {
    expect(findManifestMatchedLockedOcids(["src/app/login/page.tsx"], MANIFEST)).toEqual(["ocid_038"])
    expect(findManifestMatchedLockedOcids(["src/app/other.tsx"], MANIFEST)).toEqual([])
  })

  test("readOcid020Status parses a real literal VERIFIED status", () => {
    expect(readOcid020Status(VERIFIED_TRACKER)).toEqual({ verified: true, statusText: "VERIFIED" })
    expect(readOcid020Status(NOT_VERIFIED_TRACKER)).toEqual({ verified: false, statusText: "NOT_VERIFIED" })
  })

  test("hasValidOverride matches by exact PR number only", () => {
    expect(hasValidOverride(OVERRIDE_FOR_PR_900, 900).allowed).toBe(true)
    expect(hasValidOverride(OVERRIDE_FOR_PR_900, 901).allowed).toBe(false)
    expect(hasValidOverride(EMPTY_OVERRIDES, 900).allowed).toBe(false)
  })
})
