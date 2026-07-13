// Priority 12 (OPEN-07 point 8 follow-on, 2026-07-14): the Reports &
// Analysis Engine (report-engine-service.ts/report-catalog-service.ts) had
// zero branch-check anywhere -- any org could run an ERP or construction
// report_definitions row through executeReportDefinition() regardless of
// package (confirmed directly by the Owner's own gap note in
// ai-os/MASTER-TRACKER.yaml's OPEN-07 entry). This is a thin dispatcher over
// the per-branch enablement services (erp-enablement-service.ts/
// construction-enablement-service.ts), not a new enforcement mechanism --
// mirrors erp-enablement-service.ts/crm-enablement-service.ts's own shape,
// just fanned out by ReportDomain instead of hardcoded to one branch.
//
// Deliberately NOT in report-catalog-service.ts: that file is imported by
// ReportCatalogList.tsx, a CLIENT component, and is documented there as
// DATA-ONLY with no DB access (see its own header comment on why -- a prior
// wave broke the production build by pulling the `postgres` driver into the
// client bundle). requireReportDomainEnabled() calls into
// erp-enablement-service.ts/construction-enablement-service.ts, which touch
// the DB, so it lives here instead, alongside report-engine-service.ts (the
// dispatcher that actually calls it) -- already a server-only file.
import type { ReportDomain } from "./report-catalog-service"
import { requireErpEnabled, isErpEnabledForOrg } from "./erp-enablement-service"
import { requireConstructionEnabled, isConstructionEnabledForOrg } from "./construction-enablement-service"

// Pure branch-mapping table, isolated from the async DB calls so it's
// independently unit-testable (this repo's own established pattern -- see
// report-engine-service.test.ts's own header note on testing pure functions
// only). 'compliance' is the platform's always-included core (never a
// purchasable product_branches row -- confirmed live via Supabase MCP,
// 2026-07-14: no 'compliance' branch_key exists). 'AI-ops' reports are
// internal cron-only artifacts with no user-facing route at all (see their
// REPORT_CATALOG entries' own routeNote), and 'custom' reports are
// per-user saved queries -- neither is a purchasable module, so neither maps
// to a branch. Only 'ERP' and 'construction' correspond to real
// product_branches rows ('erp', 'construction').
const REPORT_DOMAIN_BRANCH_GATE: Partial<Record<ReportDomain, { branchKey: string; moduleName: string }>> = {
  ERP: { branchKey: "erp", moduleName: "ERP" },
  construction: { branchKey: "construction", moduleName: "Construction" },
}

/** Pure lookup -- which branch (if any) gates a given report domain. Exported for unit testing. */
export function getReportDomainGate(domain: ReportDomain): { branchKey: string; moduleName: string } | null {
  return REPORT_DOMAIN_BRANCH_GATE[domain] ?? null
}

/**
 * Shared 403 gate for every report/analysis run and catalog listing.
 * No-ops for 'compliance' (core, always included), 'AI-ops' and 'custom'
 * (platform/user-level, not tied to any purchasable branch) -- only 'ERP'
 * and 'construction' are actually gated.
 */
export async function requireReportDomainEnabled(orgId: string, domain: ReportDomain): Promise<void> {
  const gate = getReportDomainGate(domain)
  if (!gate) return
  if (gate.branchKey === "erp") return requireErpEnabled(orgId)
  if (gate.branchKey === "construction") return requireConstructionEnabled(orgId)
}

/** Non-throwing check for catalog filtering (hide what an org can't run, rather than show-then-403 on click). */
export async function isReportDomainEnabledForOrg(orgId: string, domain: ReportDomain): Promise<boolean> {
  const gate = getReportDomainGate(domain)
  if (!gate) return true
  if (gate.branchKey === "erp") return isErpEnabledForOrg(orgId)
  if (gate.branchKey === "construction") return isConstructionEnabledForOrg(orgId)
  return true
}
