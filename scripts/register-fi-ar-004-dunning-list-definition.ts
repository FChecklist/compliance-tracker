/// <reference types="bun-types" />
// FI-AR-004 (Dunning List): one-off, idempotent bootstrap that registers
// the Dunning List as a platform-wide report_definitions row (orgId: null,
// via createReportDefinition's asPlatformWide flag -- see report-engine-
// service.ts). executionType 'external_service' is exactly the marker this
// file's own header comment describes it for: "a thin passthrough marker
// for reports that already have a real, working, hand-written
// implementation elsewhere" (erp-invoicing-service.ts#dunningList).
//
// asPlatformWide is pre-existing code with no prior caller anywhere in this
// repo (confirmed by grep before writing this script) -- every built-in
// report before this wave (Trial Balance, P&L, AR Aging, etc.) is only ever
// listed in report-catalog-service.ts's static REPORT_CATALOG, never as a
// report_definitions row. This script is the first real exercise of that
// code path, run once because report_definitions has no unique constraint
// on name -- re-running without this idempotency check would create a
// duplicate row every time.
//
// Usage: bun run scripts/register-fi-ar-004-dunning-list-definition.ts <anyRealOrgId>
// (orgId is only used to open the tenant-scoped transaction; the row itself
// is written with orgId: null so it is visible to every org.)
import { eq, isNull, and } from "drizzle-orm"
import { withTenantContext } from "../src/lib/db/tenant-scoped"
import { reportDefinitions } from "../src/lib/db"
import { createReportDefinition } from "../src/lib/services/report-engine-service"

const REPORT_NAME = "Dunning List"

async function main() {
  const orgId = process.argv[2]
  if (!orgId) {
    console.error("usage: bun run scripts/register-fi-ar-004-dunning-list-definition.ts <anyRealOrgId>")
    process.exit(1)
  }

  const existing = await withTenantContext({ orgId }, (db) =>
    db.query.reportDefinitions.findFirst({ where: and(isNull(reportDefinitions.orgId), eq(reportDefinitions.name, REPORT_NAME)) })
  )
  if (existing) {
    console.log(`Already registered (id=${existing.id}) -- nothing to do.`)
    return
  }

  const created = await createReportDefinition(
    { orgId, asPlatformWide: true },
    {
      name: REPORT_NAME,
      description: "Every overdue, non-fully-paid customer invoice grouped by aging bucket (1-30/31-60/61-90/90+ days overdue), with its real dunning level (Friendly Reminder/Formal Notice/Final Demand) and a suggested next level to drive collections follow-up.",
      category: "software_report",
      classifications: ["financial", "revenue", "customer"],
      periodicity: "on_demand",
      executionType: "external_service",
      executionConfig: { kind: "external_service", sourceService: "erp-invoicing-service.ts", sourceFunction: "dunningList", requiredParams: [] },
      outputFormats: ["JSON (GET /api/v1/projexa/dunning-list)"],
      status: "built",
      createdBy: "system",
    }
  )
  console.log(`Registered platform-wide report_definitions row id=${created.id}`)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
