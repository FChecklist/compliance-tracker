# Preview Deployment Spot-Check — 2026-07-26

**Task**: V2-14-PREVIEW-SPOTCHECK ("Preview deployment spot-check") — redispatch of a task
originally created ~2026-07-20 that was pre-emptively blocked by a spend-governance gate
(`credit_accountant_rejected`, `openrouter_balance_exhausted`) before any real work started.
A 2026-07-26 triage pass independently re-confirmed the objective was still open (no
verification note existed anywhere in `ai-os/` for this row), so this redispatch targets the
**current** most-recent open PR rather than whatever PR was most recent on 2026-07-20 (which is
now ~6 days and ~70 PRs stale).

## What was checked

- **Repo**: `FChecklist/compliance-tracker`
- **PR spot-checked**: [#571](https://github.com/FChecklist/compliance-tracker/pull/571) —
  "Expand guardrail-registration coverage" (branch
  `worker/task-20260726-154345-phase-2-guardrail-coverage-expansion`), confirmed via
  `gh pr list --state open --limit 5` to be the most-recently-created open PR at check time
  (`createdAt: 2026-07-26T16:03:12Z`).
- **HEAD commit checked**: `eae511a2a01c92289a0b461e6c2e70efa02fd9dd`
- **Vercel deployment ID**: `dpl_Fn3XLWBzPLJJRb4LH3EXXxnkAEan`
- **Preview URL**: `https://veridian-compliance-ixmhnkxe3-meet-track-s-projects.vercel.app`

## Method

1. `gh pr checks 571` — confirmed the PR's own `Vercel` GitHub status check reports `pass`,
   alongside Build/Lint/Type Check/Unit Tests/E2E Tests/Analyze all green (two unrelated
   pre-existing failures on this PR — `Metadata Index Coverage Check` and `audit-check` — are
   out of scope for this task; not a Vercel/deploy problem).
2. Resolved the real preview URL for the PR's HEAD commit via the GitHub Deployments API
   (`gh api repos/FChecklist/compliance-tracker/deployments` → matched `ref` to the PR's head
   SHA → `deployments/{id}/statuses` → `environment_url`), rather than trusting a possibly-stale
   PR comment.
3. Attempted a live anonymous `curl` against the resolved preview URL (both plain and with an
   `Authorization: Bearer` header using the session's `VERCEL_ACCESS_TOKEN`).
4. Cross-checked deployment health server-side via `vercel inspect <url> --token
   $VERCEL_ACCESS_TOKEN` and the Vercel REST API (`GET /v13/deployments/get`), since anonymous
   HTTP was blocked (see Result below) — this is an authenticated, read-only check against
   Vercel's own API, not a bypass of the protection itself.

## Result: **PASS** (deployment healthy; anonymous browser render not verifiable, by design)

- `vercel inspect` reports: `status: ● Ready`, `target: preview`, build output includes 2000+
  serverless function/route artifacts (`index`, `_not-found`, `access-review`, …) — i.e. a
  genuinely complete app build, not a stub or partial failure.
- `GET /v13/deployments/get` (Vercel REST API) independently confirms `readyState: READY`.
- A plain anonymous `curl` to the preview URL returns `HTTP 302` redirecting to
  `vercel.com/sso-api?url=...` with `set-cookie: _vercel_sso_nonce=...` — this is Vercel's
  **Deployment Protection (team SSO)** gate on the `meet-track-s-projects` team, not an app bug.
  It behaves identically with or without the `VERCEL_ACCESS_TOKEN` bearer header (that token
  authenticates Vercel API calls; it is not a "Protection Bypass for Automation" secret, which is
  a separate per-project value not configured for this project). No app-level 500s, build
  failures, or broken routing were observed or possible to distinguish from this state — the
  wall sits in front of the entire app.
- **Honest limitation**: this spot-check verifies the deployment built and is serving traffic
  (readyState, route count, CI's own `Vercel` check) but could not render an actual page in a
  browser or confirm app-level correctness (e.g., a specific page loading without a client-side
  error) end-to-end, because doing so requires an interactive Vercel SSO login this headless
  session cannot perform, or a `VERCEL_AUTOMATION_BYPASS_SECRET` that isn't currently provisioned
  for this project. That is a scope boundary of what "live spot-check" can mean from a
  non-interactive session, not a finding about the app itself.

## Recommendation

If a future session wants full page-render verification (not just deploy-health), provision a
Vercel "Protection Bypass for Automation" secret for the `veridian-compliance-ai` project and
pass it as the `x-vercel-protection-bypass` header — that is the supported, non-interactive way
to get past this same wall next time, rather than re-discovering the SSO redirect from scratch.

**Status**: row closed as PASS with the limitation above disclosed; no code change needed.
