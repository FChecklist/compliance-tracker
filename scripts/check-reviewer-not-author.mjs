#!/usr/bin/env node
// Real, automated "reviewer != author" guard.
//
// UMR-20260805-091629-d8e3 (Owner directive), supporting UMR-20260805-034917-33a9
// (branch-protection hardening) while UMR-20260805-091648-6793 (a real, temporary,
// bounded exception on required_approving_review_count while a real second reviewer
// identity does not exist yet) is active. The Owner's real ask: a real, separate
// GitHub identity that can review PRs but never author/push code, PLUS an automated
// check confirming reviewer and author are never the same account on any given PR.
//
// The identity-provisioning half of that ask is a real, structural gap this script
// cannot close by itself (see ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md
// for the honest finding + the precise recommendation for the Owner's one required
// action). What this script IS: the real, mechanical, buildable half -- a check that
// will matter the moment a distinct reviewer identity exists, and is real, useful
// evidence/tooling regardless. GitHub's own API already refuses a genuine self-
// approval (an author cannot approve their own PR), so this is deliberately a
// defense-in-depth check for a future state where a distinct identity exists but
// something (a misconfigured token, a shared credential, human error) goes wrong --
// not a check that's expected to ever legitimately fire today.
//
// Real signal: ANY review on the PR with state === "APPROVED" whose author login
// matches the PR author's login (case-insensitive -- GitHub logins are themselves
// case-insensitive, so "Alice" and "alice" are the same real account) is a real
// reviewer/author identity collision. A COMMENTED or CHANGES_REQUESTED review from
// the same account does NOT block -- this check's job is identity-mismatch on the
// actual approval, not policing who may comment; presence/count of reviews at all is
// required_pull_request_reviews' job, not this script's.
//
// Usage:
//   node scripts/check-reviewer-not-author.mjs [pr_number]
//     pr_number: optional explicit PR number. If omitted, resolved from
//     GITHUB_EVENT_PATH (both pull_request and pull_request_review events carry a
//     pull_request.number field), matching how check-sec07-ocid-lock.mjs's own
//     main() resolves its real inputs from the same env var. Real review data itself
//     (GitHub's pull_request event payload does NOT include the full review list) is
//     always fetched fresh via `gh pr view <pr_number> --json author,reviews`, same
//     real gh-CLI-backed pattern already used elsewhere in this repo's own tooling
//     (see scripts/validate-audit-verdict.ts).
// Exit code: 0 if not blocked, 1 if blocked.
import { readFile } from "node:fs/promises"
import { execSync } from "node:child_process"

// Pure decision function -- the real gate logic, independent of gh/fs/env, so it can
// be unit-tested directly against synthetic inputs. `reviews` is an array of
// { authorLogin, state } where state is one of GitHub's real review states
// (APPROVED, COMMENTED, CHANGES_REQUESTED, DISMISSED, PENDING).
export function evaluate({ prAuthorLogin, reviews }) {
  const author = String(prAuthorLogin || "").toLowerCase()

  if (!author) {
    return { blocked: false, reason: "No PR author login was resolved -- nothing to compare reviews against. Not this check's job to fail closed on missing author data (see check-sec07-ocid-lock.mjs pattern for a check that legitimately does fail closed on missing data; this one does not, since an empty author can never real-match a real reviewer login)." }
  }

  const selfApproval = (reviews || []).find(
    (r) => r?.state === "APPROVED" && String(r?.authorLogin || "").toLowerCase() === author
  )

  if (selfApproval) {
    return {
      blocked: true,
      reason:
        `BLOCKED: reviewer and author are the same account. An APPROVED review on this PR was ` +
        `submitted by "${selfApproval.authorLogin}", which is the same GitHub account (case-insensitive ` +
        `match) as the PR author, "${prAuthorLogin}". Reviewer and author must never be the same account ` +
        `on any given PR (UMR-20260805-091629-d8e3). GitHub's own API already refuses a literal self-` +
        `approval today, so seeing this means something upstream of GitHub's own guard is wrong -- a ` +
        `shared/misconfigured credential, a token acting as the wrong identity, or similar -- and needs ` +
        `real investigation before this PR merges.`,
    }
  }

  return {
    blocked: false,
    reason: `No APPROVED review on this PR shares an account with the PR author ("${prAuthorLogin}"). Reviewer/author identity check passed.`,
  }
}

// Real PR number resolution: explicit CLI arg wins; otherwise read
// GITHUB_EVENT_PATH (works for both pull_request and pull_request_review CI
// triggers, since both event payloads carry pull_request.number).
async function resolvePrNumber(argvNumber) {
  if (argvNumber) return Number(argvNumber)

  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return null
  try {
    const event = JSON.parse(await readFile(eventPath, "utf8"))
    const n = event?.pull_request?.number
    return n != null ? Number(n) : null
  } catch (err) {
    console.error(`WARNING: could not read GITHUB_EVENT_PATH (${err.message}) -- PR number not resolved from it.`)
    return null
  }
}

// Real inputs: gh CLI is the source of truth for the current, live author + review
// list (the pull_request event payload alone does not carry the full review list).
function fetchPrAuthorAndReviews(prNumber) {
  const raw = execSync(`gh pr view ${prNumber} --json author,reviews`, { encoding: "utf8" })
  const data = JSON.parse(raw)
  const prAuthorLogin = data?.author?.login || ""
  const reviews = (data?.reviews || []).map((r) => ({
    authorLogin: r?.author?.login || "",
    state: r?.state || "",
  }))
  return { prAuthorLogin, reviews }
}

async function main() {
  const prNumber = await resolvePrNumber(process.argv[2])
  if (!prNumber) {
    console.error("FATAL: no PR number given (arg) and none resolved from GITHUB_EVENT_PATH. Cannot evaluate reviewer/author identity.")
    process.exit(1)
  }

  const { prAuthorLogin, reviews } = fetchPrAuthorAndReviews(prNumber)
  const result = evaluate({ prAuthorLogin, reviews })

  console.log(result.blocked ? "=== Reviewer != Author Check FAILED ===" : "Reviewer != Author Check passed.")
  console.log(result.reason)
  process.exit(result.blocked ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("FATAL:", err)
    process.exit(1)
  })
}
