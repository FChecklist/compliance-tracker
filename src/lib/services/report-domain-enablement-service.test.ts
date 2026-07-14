/// <reference types="bun-types" />
// Tests the pure branch-mapping table only -- requireReportDomainEnabled()/
// isReportDomainEnabledForOrg() both touch the DB (via erp-enablement-
// service.ts/construction-enablement-service.ts) and are deliberately left
// untested here, matching this repo's established pattern (see
// report-engine-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { getReportDomainGate } from "./report-domain-enablement-service"

describe("getReportDomainGate", () => {
  test("ERP maps to the 'erp' product branch", () => {
    expect(getReportDomainGate("ERP")).toEqual({ branchKey: "erp", moduleName: "ERP" })
  })

  test("construction maps to the 'construction' product branch", () => {
    expect(getReportDomainGate("construction")).toEqual({ branchKey: "construction", moduleName: "Construction" })
  })

  test("compliance is never gated -- platform core, not a purchasable branch", () => {
    expect(getReportDomainGate("compliance")).toBeNull()
  })

  test("AI-ops is never gated -- internal cron-only artifacts, not a purchasable branch", () => {
    expect(getReportDomainGate("AI-ops")).toBeNull()
  })

  test("custom is never gated -- per-user saved queries, not a purchasable branch", () => {
    expect(getReportDomainGate("custom")).toBeNull()
  })
})
