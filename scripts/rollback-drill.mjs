#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, Cloud Deployment / Deployment
// Automation (2026-08-07), "Rollback Capability": gap was "Rollback
// capability is theoretical (platform feature), never rehearsed."
// Recommended approach: a CLI-based drill first (faster, scriptable).
//
// This is that drill's read-only half: it queries Vercel's real API for the
// project's recent production deployments and identifies the rollback
// candidate (the most recent READY, `isRollbackCandidate: true` production
// deployment BEFORE the one currently live), then prints the exact
// `vercel rollback` command to run next. It makes ZERO deployment/traffic
// changes -- safe to run any time, including in CI, as the rehearsal step.
// Actually executing the printed rollback command is a separate, deliberate
// action an operator takes -- see docs/runbooks/rollback.md for why that
// step is not automated here (AGENTS.md Rule 7(e): a live production
// traffic change needs the repository owner's explicit confirmation, even
// though a rollback is itself easily reversible by rolling forward again).
//
// Usage: node scripts/rollback-drill.mjs
// Requires: VERCEL_ACCESS_TOKEN (already a GitHub Secret, see
// sync-vercel-env.yml). VERCEL_PROJECT_ID defaults to this repo's real,
// live-verified project id (2026-08-07).

const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII"
const DEPLOYMENTS_LIMIT = Number(process.env.ROLLBACK_DRILL_LIMIT || 10)

/**
 * Pure selection logic (exported for unit testing without a live API call):
 * given Vercel's own `/v6/deployments` response shape, returns the current
 * live production deployment and the best rollback candidate before it.
 * Deployments are assumed already sorted newest-first, matching Vercel's
 * real API response order (verified live 2026-08-07).
 */
export function selectRollbackCandidate(deployments) {
  const ready = deployments.filter((d) => (d.state ?? d.readyState) === "READY" && d.isRollbackCandidate)
  const current = ready[0] ?? null
  const candidate = ready[1] ?? null
  return { current, candidate }
}

export function formatDeployment(d) {
  if (!d) return "  (none)"
  const sha = d.meta?.githubCommitSha ? d.meta.githubCommitSha.slice(0, 7) : "unknown"
  const msg = (d.meta?.githubCommitMessage ?? "").split("\n")[0]
  const created = new Date(d.created ?? d.createdAt).toISOString()
  return `  ${d.url}\n  id=${d.uid} state=${d.state ?? d.readyState} created=${created}\n  commit=${sha} "${msg}"`
}

async function main() {
  const token = process.env.VERCEL_ACCESS_TOKEN
  if (!token) {
    console.error("VERCEL_ACCESS_TOKEN is not set -- cannot query Vercel's API. See docs/runbooks/rollback.md.")
    process.exitCode = 1
    return
  }

  const url = `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&limit=${DEPLOYMENTS_LIMIT}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.error(`Vercel API returned ${res.status}: ${await res.text()}`)
    process.exitCode = 1
    return
  }
  const { deployments } = await res.json()
  const { current, candidate } = selectRollbackCandidate(deployments ?? [])

  if (!current) {
    console.log("No READY production deployment found -- nothing to drill against.")
    return
  }

  console.log("Current live production deployment:")
  console.log(formatDeployment(current))

  if (!candidate) {
    console.log("\nNo earlier rollback-candidate production deployment exists yet.")
    return
  }

  console.log("\nRollback candidate (most recent READY production deployment before the current one):")
  console.log(formatDeployment(candidate))

  console.log("\nDrill complete -- no changes made. To execute this rollback for real")
  console.log("(a live production traffic change -- requires the repository owner's")
  console.log("explicit confirmation per AGENTS.md Rule 7(e)):")
  console.log(`  vercel rollback ${candidate.url} --token=$VERCEL_ACCESS_TOKEN --yes`)
  console.log("\nTo check whether a rollback is already in progress:")
  console.log(`  vercel rollback status ${VERCEL_PROJECT_ID} --token=$VERCEL_ACCESS_TOKEN`)
}

// Only run when invoked directly (`node scripts/rollback-drill.mjs`), not
// when imported for its exported pure functions by a test file -- same
// guard style as this repo's other dual-purpose scripts/*.mjs checks.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
