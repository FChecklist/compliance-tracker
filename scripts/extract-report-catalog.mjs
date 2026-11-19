// Generates ai-os/REPORT_CATALOG.json mechanically from the real, typed REPORT_CATALOG array
// (src/lib/services/report-catalog-service.ts). Not AI-written. Run: bun scripts/extract-report-catalog.mjs
import { REPORT_CATALOG } from "../src/lib/services/report-catalog-service.ts"
import { writeFileSync } from "node:fs"

const byDomain = {}
for (const r of REPORT_CATALOG) byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1
const out = {
  generated_by: "extract-report-catalog.mjs (imports REPORT_CATALOG from report-catalog-service.ts, not AI-written)",
  source: "src/lib/services/report-catalog-service.ts",
  report_count: REPORT_CATALOG.length,
  by_domain: byDomain,
  reports: REPORT_CATALOG,
}
writeFileSync(new URL("../ai-os/REPORT_CATALOG.json", import.meta.url), JSON.stringify(out) + "\n")
console.log("reports:", out.report_count, byDomain)
