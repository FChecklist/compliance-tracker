// PLATFORM-01 Wave 2, Workstream 6 (per-country compliance engine registry).
// See C:\Users\Dell\.claude\plans\floating-launching-lagoon.md and
// ai-os/boss/ACTIVE-CLAIMS.yaml's PLATFORM-01 Wave 2 entry.
//
// This is a thin resolver, not a new engine. It binds each registered country
// to its real, verified statute-specific engine modules. Every other country
// intentionally has NO entry: fabricating US/UK/etc. tax law from guesses
// would be actively wrong, not just incomplete, so getComplianceEngine()
// throws a clear, explicit error for any unregistered country rather than
// silently falling back to another country's rules or returning a stub that
// looks real.
//
// V2-1 (UAE country pack, 2026-07-20): the registry now binds TWO countries
// -- India (IN) and the United Arab Emirates (AE). Each country registers
// ONLY the slots backed by a real statute module it actually has (India:
// incomeTax/tds/gst; UAE: vat/corporateTax), so the type is per-country
// slots, not a uniform shape -- a country that has no VAT (or no separate
// TDS concept) leaves that slot absent rather than stubbed. The slots key
// off what that country's tax regime genuinely contains, which is the whole
// point of "pluggable": the second country is NOT forced into the first
// country's category names.
//
// The 22 country-agnostic engines in src/lib/engines/ (accounting, banking,
// costing, inventory, hr, payroll, etc.) have no statute-specific logic and
// are NOT part of this registry -- they stay directly imported as before,
// unaffected by this restructuring.

import * as incomeTaxEngineIn from "@/lib/engines/in/income-tax-engine"
import * as tdsEngineIn from "@/lib/engines/in/tds-engine"
import * as gstEngineIn from "@/lib/engines/in/gst-engine"
import * as vatEngineAe from "@/lib/engines/ae/vat-engine"
import * as corporateTaxEngineAe from "@/lib/engines/ae/corporate-tax-engine"

// Each country registers the statute modules it genuinely has. The slot names
// are intentionally NOT a fixed uniform set ("incomeTax/tds/gst"): India has a
// TDS concept and a CGST/SGST/IGST-split GST; the UAE has a single national
// VAT and a flat-threshold Corporate Tax and no statutory TDS withholding of
// the Indian kind. Forcing the second country into the first's slot names would
// either stub non-existent categories or mislabel real ones -- so each country
// carries its own real slots. `country` + the slot record are the contract.
export type ComplianceEngine = {
  country: string
  incomeTax?: typeof incomeTaxEngineIn
  tds?: typeof tdsEngineIn
  gst?: typeof gstEngineIn
  vat?: typeof vatEngineAe
  corporateTax?: typeof corporateTaxEngineAe
}

const REGISTRY: Record<string, ComplianceEngine> = {
  in: {
    country: "IN",
    incomeTax: incomeTaxEngineIn,
    tds: tdsEngineIn,
    gst: gstEngineIn,
  },
  ae: {
    country: "AE",
    vat: vatEngineAe,
    corporateTax: corporateTaxEngineAe,
  },
}

/**
 * Resolve the per-country compliance engine set (income tax / TDS / GST, or
 * their local equivalents like UAE VAT / Corporate Tax) for a given ISO
 * 3166-1 alpha-2 country code. Case-insensitive. Only registered countries
 * are backed by real, verified statute logic -- every other country throws
 * rather than fabricating tax law or silently defaulting to another
 * country's rules. Returned slots vary per country (a country exposes only
 * the statute modules it actually has); callers should narrow with the
 * country code or check the slot's presence before use.
 */
export function getComplianceEngine(country: string): ComplianceEngine {
  const key = (country ?? "").trim().toLowerCase()
  const engine = REGISTRY[key]
  if (!engine) {
    throw new Error(
      `No compliance engine registered for country: ${country} — registered countries are: ${getSupportedComplianceCountries().join(", ")}`
    )
  }
  return engine
}

/** Countries with a real, registered compliance engine today. */
export function getSupportedComplianceCountries(): string[] {
  return Object.values(REGISTRY).map((e) => e.country)
}
