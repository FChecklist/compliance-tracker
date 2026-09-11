// B3 measurement script (W-PROD, R75 Part 5). Read-only: calls
// getOrgDashboard() directly against the real DB, exactly as the route does,
// bypassing HTTP/auth so the number is pure service+DB time. Run with:
//   bun run scripts/measure-dashboard-perf.ts <orgId> [iterations]
import { getOrgDashboard } from "../src/lib/services/construction-dashboard-service"

const orgId = process.argv[2]
const iterations = Number(process.argv[3] ?? 5)
if (!orgId) {
  console.error("usage: bun run scripts/measure-dashboard-perf.ts <orgId> [iterations]")
  process.exit(1)
}

async function main() {
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    const result = await getOrgDashboard({ orgId })
    const dt = performance.now() - t0
    times.push(dt)
    console.log(`run ${i + 1}: ${dt.toFixed(1)}ms  (totalProjects=${result.totalProjects})`)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`\nmedian=${median.toFixed(1)}ms  min=${sorted[0].toFixed(1)}ms  max=${sorted[sorted.length - 1].toFixed(1)}ms`)
  process.exit(0)
}

main().catch((e) => {
  console.error("measurement failed:", e)
  process.exit(1)
})
