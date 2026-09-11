// Real /api/shell investigation (B3 redirect, D89). Read-only: measures the
// four other callVeridianResult() members of /api/shell's Promise.allSettled
// fan-out (pill-usage, capability-tree, currencies, vendors) directly against
// the real DB, same in-process/no-HTTP methodology as measure-dashboard-perf.ts.
import { readPillStrip } from "../src/lib/services/projexa-pill-usage-service"
import { buildConstructionNodes } from "../src/lib/services/capability-tree-service"
import { listCurrencies } from "../src/lib/services/erp-accounting-service"
import { listSuppliers } from "../src/lib/services/erp-buying-service"
import { withTenantContext } from "../src/lib/db/tenant-scoped"

const orgId = process.argv[2]
if (!orgId) {
  console.error("usage: bun run scripts/measure-shell-siblings-perf.ts <orgId> [userId]")
  process.exit(1)
}
const userId = process.argv[3] ?? "measurement-script-synthetic-user"

async function time<T>(label: string, fn: () => Promise<T>): Promise<void> {
  const t0 = performance.now()
  try {
    const result = await fn()
    const dt = performance.now() - t0
    const size = Array.isArray(result) ? result.length : typeof result === "object" && result !== null ? Object.keys(result).length : "?"
    console.log(`${label}: ${dt.toFixed(1)}ms (size=${JSON.stringify(size)})`)
  } catch (e) {
    const dt = performance.now() - t0
    console.log(`${label}: ${dt.toFixed(1)}ms FAILED: ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  await time("pill-usage (readPillStrip)", () => readPillStrip({ orgId, userId, limit: 6, historyLimit: 6 }))
  await time("capability-tree (buildConstructionNodes)", () => withTenantContext({ orgId, userId }, (db) => buildConstructionNodes(db, orgId)))
  await time("currencies (listCurrencies)", () => listCurrencies({ orgId }))
  await time("vendors (listSuppliers)", () => listSuppliers({ orgId }))
  process.exit(0)
}

main().catch((e) => {
  console.error("measurement failed:", e)
  process.exit(1)
})
