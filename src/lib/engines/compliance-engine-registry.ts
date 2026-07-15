// PLATFORM-01 Wave 2, Workstream 6 (per-country compliance engine registry).
// See C:\Users\Dell\.claude\plans\floating-launching-lagoon.md and
// ai-os/boss/ACTIVE-CLAIMS.yaml's PLATFORM-01 Wave 2 entry.
//
// This is a thin resolver, not a new engine. The only real, verified
// statute-specific logic that exists in this codebase today is India's
// (src/lib/engines/in/{income-tax,tds,gst}-engine.ts, moved here verbatim
// from src/lib/engines/ -- same exports, same logic, just relocated). Every
// other country intentionally has NO entry: fabricating US/UK/UAE/etc. tax
// law from guesses would be actively wrong, not just incomplete, so
// getComplianceEngine() throws a clear, explicit error for any country
// other than "IN" rather than silently falling back to India's rules or
// returning a stub that looks real.
//
// The 22 country-agnostic engines in src/lib/engines/ (accounting, banking,
// costing, inventory, hr, payroll, etc.) have no statute-specific logic and
// are NOT part of this registry -- they stay directly imported as before,
// unaffected by this restructuring.

import * as incomeTaxEngineIn from "@/lib/engines/in/income-tax-engine"
import * as tdsEngineIn from "@/lib/engines/in/tds-engine"
import * as gstEngineIn from "@/lib/engines/in/gst-engine"

export type ComplianceEngine = {
  country: string
  incomeTax: typeof incomeTaxEngineIn
  tds: typeof tdsEngineIn
  gst: typeof gstEngineIn
}

const REGISTRY: Record<string, ComplianceEngine> = {
  in: {
    country: "IN",
    incomeTax: incomeTaxEngineIn,
    tds: tdsEngineIn,
    gst: gstEngineIn,
  },
}

/**
 * Resolve the per-country compliance engine set (income tax, TDS, GST or
 * their local equivalents) for a given ISO 3166-1 alpha-2 country code.
 * Case-insensitive. Only "IN" is currently backed by real, verified
 * statute logic -- every other country throws rather than fabricating tax
 * law or silently defaulting to India's rules.
 */
export function getComplianceEngine(country: string): ComplianceEngine {
  const key = (country ?? "").trim().toLowerCase()
  const engine = REGISTRY[key]
  if (!engine) {
    throw new Error(
      `No compliance engine registered for country: ${country} — only 'IN' is currently supported`
    )
  }
  return engine
}

/** Countries with a real, registered compliance engine today. */
export function getSupportedComplianceCountries(): string[] {
  return Object.values(REGISTRY).map((e) => e.country)
}
