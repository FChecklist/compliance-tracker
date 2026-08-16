// Reports & Analysis Engine -- shared taxonomy (Priority 11, Owner directive
// 2026-07-13). This is the single source of truth every report/analysis
// definition in the system tags itself with -- report-catalog-service.ts's
// static REPORT_CATALOG, the new report_definitions table (report-engine-
// service.ts), and report-schedule-service.ts's cadence logic all import
// from here rather than each inventing their own vocabulary.
//
// Three independent axes, matching the Owner's own framing exactly:
//   1. CATEGORY    -- who/what produced it (software vs AI vs hybrid),
//                     7 values (Owner left #7 open; defined below as
//                     "external/ingested data" -- a real, existing pattern
//                     in this codebase: GST import batches, bank-statement
//                     imports, connector-pulled documents all produce
//                     reports from data the org didn't type into VERIDIAN
//                     itself, which is genuinely distinct from #1-6).
//   2. CLASSIFICATION -- subject-matter grouping (executive/financial/HR/
//                     sales/...), a growing list per the Owner's own "these
//                     will increase" note -- kept as a plain string array on
//                     each definition (not a closed enum) so adding a new
//                     classification is a one-line addition here, never a
//                     migration.
//   3. PERIODICITY  -- how often it runs, general-purpose enough to express
//                     every cadence in the Owner's list (hourly through
//                     year-to-date/custom-range) without exploding into a
//                     separate enum value per clock time -- a periodicity
//                     value pairs with an optional PeriodicityConfig (times
//                     of day, day of week/month, or a custom date range).

export type ReportCategory =
  | "software_report" // CATEGORY 1 -- deterministic aggregation/listing, zero AI
  | "software_analysis" // CATEGORY 2 -- deterministic calculation/ratio (SPI, CPI, variance, trend), zero AI
  | "software_ai_partial" // CATEGORY 3 -- deterministic data + an AI-written narrative/summary layer on top
  | "ai_analysis" // CATEGORY 4 -- AI judgment is load-bearing (root-cause, prediction, risk scoring), grounded in real queried data, re-run fresh each time
  | "ai_new_report_promoted" // CATEGORY 5 -- originated as an ad-hoc AI report-builder proposal, then promoted into a reusable report_definitions row so it's deterministic (software_report) from then on
  | "ai_new_analysis_promoted" // CATEGORY 6 -- same promotion path as 5, but the promoted definition keeps an ai_recipe execution type (the underlying judgment still needs AI every run, unlike 5)
  | "external_ingested" // CATEGORY 7 -- built from data ingested from outside VERIDIAN's own forms (GST return imports, bank statement imports, connector-pulled documents/emails) rather than from records users typed into the app

export const REPORT_CATEGORIES: Record<ReportCategory, { label: string; description: string }> = {
  software_report: { label: "Software-Generated Report", description: "Deterministic listing/aggregation over live data. No AI involved." },
  software_analysis: { label: "Software-Generated Analysis", description: "Deterministic calculation or ratio (index, variance, trend) over live data. No AI involved." },
  software_ai_partial: { label: "Software + AI Partial Analysis", description: "Deterministic data with an AI-written narrative/summary/recommendation layer on top." },
  ai_analysis: { label: "AI Analysis", description: "AI judgment is load-bearing (prediction, root-cause, risk scoring) -- grounded in real queried data, never fabricated, re-run fresh each time." },
  ai_new_report_promoted: { label: "New Report (AI-Originated, Now Software)", description: "First built ad-hoc by AI from a user's upload/request, then promoted into a reusable deterministic definition -- the software runs it from then on." },
  ai_new_analysis_promoted: { label: "New Analysis (AI-Originated, Still AI)", description: "First built ad-hoc by AI, promoted into a reusable definition -- but the underlying judgment still needs a fresh AI call each run." },
  external_ingested: { label: "External/Ingested-Data Report", description: "Built from data ingested from outside VERIDIAN's own forms -- GST/bank-statement imports, connector-pulled documents/emails -- not from records a user typed into the app." },
}

export const REPORT_CATEGORY_VALUES = Object.keys(REPORT_CATEGORIES) as ReportCategory[]

// Deliberately a plain string union used as documentation/defaults, NOT the
// validation boundary -- validateClassifications() below accepts any
// non-empty trimmed string so a new classification never needs a code
// change here, matching the Owner's "these will increase" instruction.
// This list is what report-engine seed data actually uses today.
export const KNOWN_CLASSIFICATIONS = [
  "user_specific", "org_specific", "executive", "project", "financial",
  "resource", "procurement", "predictive", "hr", "sales", "revenue",
  "quality_safety", "interior_design", "compliance", "operations",
  "construction", "vendor_management", "customer",
] as const
export type KnownClassification = (typeof KNOWN_CLASSIFICATIONS)[number]

export function validateClassifications(values: unknown): { valid: true; classifications: string[] } | { valid: false; reason: string } {
  if (!Array.isArray(values) || values.length === 0) return { valid: false, reason: "classifications must be a non-empty array of strings" }
  const cleaned = values.map((v) => String(v).trim()).filter(Boolean)
  if (cleaned.length === 0) return { valid: false, reason: "classifications must contain at least one non-empty value" }
  return { valid: true, classifications: cleaned }
}

// Base frequency. "Daily N-times-a-day at specific clock times" is
// expressed as ONE value (`daily`) plus `timesOfDay` in PeriodicityConfig,
// not as separate enum members per clock time -- this is the actual
// "flexible, no duplicacy" requirement applied to periodicity itself: the
// Owner's "Daily once (8 AM)" / "Daily once (6 AM)" / "Daily twice (8/8)" /
// "Daily thrice (8/2/6)" examples are all just `daily` + a different
// `timesOfDay` array, not 4 different enum values.
export const PERIODICITY_BASE_VALUES = [
  "hourly", "daily", "weekly", "biweekly", "fortnightly", "monthly", "bimonthly",
  "quarterly", "half_yearly", "yearly", "biyearly", "year_to_date", "custom_range",
  "immediate", "on_demand",
] as const
export type PeriodicityBase = (typeof PERIODICITY_BASE_VALUES)[number]

export const PERIODICITY_LABELS: Record<PeriodicityBase, string> = {
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-Weekly (twice a week)",
  fortnightly: "Fortnightly (every 2 weeks)",
  monthly: "Monthly",
  bimonthly: "Bi-Monthly (every 2 months)",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  yearly: "Yearly",
  biyearly: "Bi-Yearly (every 2 years)",
  year_to_date: "Year to Date",
  custom_range: "Custom Date Range",
  immediate: "Immediate (fires on the triggering event, not a clock)",
  on_demand: "On Demand (no schedule -- user/AI runs it manually)",
}

export type PeriodicityConfig = {
  /** "HH:MM" 24h UTC strings -- only meaningful for `hourly`/`daily`. Empty/omitted = fires once at the schedule's default cron time. */
  timesOfDay?: string[]
  /** 0=Sunday..6=Saturday -- required for `weekly`/`biweekly`/`fortnightly`. */
  dayOfWeek?: number
  /** 1-31, clamped to the real last day of shorter months -- required for `monthly`/`bimonthly`/`quarterly`/`half_yearly`/`yearly`/`biyearly`. */
  dayOfMonth?: number
  /** ISO date strings -- required for `custom_range`; `year_to_date` derives its own start (Jan 1 of the current year) so doesn't need these. */
  startDate?: string
  endDate?: string
}

/** Same validate-then-throw shape as every other *-service.ts's validate*Input(). */
export function validatePeriodicity(
  base: string,
  config: PeriodicityConfig | undefined
): { valid: true } | { valid: false; reason: string } {
  if (!PERIODICITY_BASE_VALUES.includes(base as PeriodicityBase)) {
    return { valid: false, reason: `periodicity must be one of: ${PERIODICITY_BASE_VALUES.join(", ")}` }
  }
  const needsDayOfWeek: PeriodicityBase[] = ["weekly", "biweekly", "fortnightly"]
  const needsDayOfMonth: PeriodicityBase[] = ["monthly", "bimonthly", "quarterly", "half_yearly", "yearly", "biyearly"]
  if (needsDayOfWeek.includes(base as PeriodicityBase) && (config?.dayOfWeek == null || config.dayOfWeek < 0 || config.dayOfWeek > 6)) {
    return { valid: false, reason: `dayOfWeek (0=Sunday..6=Saturday) is required for periodicity "${base}"` }
  }
  if (needsDayOfMonth.includes(base as PeriodicityBase) && (config?.dayOfMonth == null || config.dayOfMonth < 1 || config.dayOfMonth > 31)) {
    return { valid: false, reason: `dayOfMonth (1-31) is required for periodicity "${base}"` }
  }
  if (base === "custom_range" && (!config?.startDate || !config?.endDate)) {
    return { valid: false, reason: "startDate and endDate are required for periodicity \"custom_range\"" }
  }
  return { valid: true }
}
