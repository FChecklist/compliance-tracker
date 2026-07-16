# Sev-1 Incident Command Runbook

**Written 2026-07-16, VERIDIAN Review Framework Wave A.** The audit that
produced this workstream found the only disaster-recovery/RTO code in this
repo is a **customer-facing** GRC feature (`src/app/(app)/it-dr/**`,
`src/lib/services/it-dr-service.ts`, `src/app/(app)/bcm/**` — VERIDIAN's own
product for *tenants* to track *their* DR posture). There has never been an
internal runbook for what this platform's own operators do when VERIDIAN AI
OS itself goes down, and no disaster-recovery drill has ever been rehearsed
against it. This document is that runbook. It is grounded in this repo's
actual infrastructure — read `docs/master/ARCHITECTURE.md` and
`AGENTS.md`/`ai-os/CONSTITUTION.yaml` alongside it, not instead of it — and
it names its own gaps rather than implying a maturity this platform doesn't
have yet.

---

## 1. What counts as Sev-1

A **Sev-1** is anything where VERIDIAN AI OS is down or actively causing
harm for real tenants, right now, with no workaround:

- Production is unreachable (5xx/timeout on the live URL) or the app fails
  to boot after a deploy.
- Auth is broken platform-wide (no org can log in) — see `auth-guard.ts`
  and Supabase Auth SSR dependency.
- Cross-tenant data leakage is suspected — an RLS regression, a bug that
  returns another org's rows. Treat any *plausible* report of this as
  Sev-1 immediately; do not wait to confirm before starting §4's rollback
  path, per the "any failure mode gets treated as escalate, nothing is
  silently assumed fine" principle already established in
  `dispatch-completion-monitor.ts`'s fail-closed pattern
  (`docs/ESCALATION_MATRIX.md` §5).
- A secret/credential has leaked (committed, logged, or exposed in a
  response) — see the real precedent in
  `ai-os/boss/fchecklist_security_sweep_2026-07-04` memory: a leaked
  password was rotated same-day; this runbook generalizes that response.
- Database writes are failing platform-wide (pooler outage, exhausted
  connections, a bad migration).

**Not Sev-1**: a single org/user-scoped bug, a degraded (not down) AI
provider with a working fallback (see §6's honest note on how thin that
fallback actually is), a failed cron job that isn't blocking user-facing
functionality.

---

## 2. Roles

This platform's real operating model (`AGENTS.md`) has no dedicated 24/7
on-call rotation or pager tool — say so plainly rather than inventing one.
The roles below map onto the agents `AGENTS.md` actually authorizes:

| Role | Who | Does |
|---|---|---|
| **Incident Commander (IC)** | Whichever authorized agent (Super Boss / Claude Code Secondary Agent / Z.ai GLM) first detects or is dispatched to the incident | Owns the incident end-to-end: declares Sev-1, drives §4/§5, decides when to hand off or stand down. Does not need to be the agent that caused the incident. |
| **Owner** | raajat.agarwal@gmail.com (repo owner, `AGENTS.md` line 4) | The only human in this loop. Required for anything irreversible per the safety boundary every agent already operates under (financial/credential/security-setting actions) and for the Rule 6 exception in §4.3 below. The IC pings the Owner immediately on Sev-1 declaration — do not wait for a full diagnosis first. |
| **Auditor** | Whichever authorized agent did **not** cause or does not own the fix | Reviews the rollback/fix PR before it merges, per `AGENTS.md` Rule 7(c)'s doer-!= auditor principle — the same rule that already governs every other change in this repo, not a new one invented for incidents. |

**Honest gap**: there is no status page, no PagerDuty/Opsgenie-equivalent,
and no defined human on-call schedule beyond "the Owner, whenever reached."
If a Sev-1 happens while no agent session is active and the Owner is
unreachable, nothing in this repo pages anyone. Building real alerting is
out of scope for this doc — see `ai-os/CONSTITUTION.yaml` RES-01/RES-02
(status `PARTIALLY_ENFORCED`, one documented AI-provider failover path,
no generalized monitoring) for the underlying, already-tracked gap this
runbook does not close.

---

## 3. Detection

There is no dedicated uptime monitor wired to this platform as of this
writing — grep for `statuspage`, `pingdom`, `betteruptime`, `UptimeRobot`
in this repo before assuming otherwise; none exist. Realistic detection
paths, in order of how fast they actually fire:

1. **Vercel's own deployment/build failure notification** — a `next build`
   failure blocks the deploy outright; you'll see it in the Vercel
   dashboard for project `compliance-tracker-ai`
   (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`) or in `.github/workflows/ci.yml`'s
   `build` job, which runs the identical `bun run build` independently
   (see §4.1 for why these two are **not** the same guarantee).
2. **CI red on `main`** — `.github/workflows/ci.yml` (Lint → Type Check →
   Build → Unit Tests, plus `mandatory-audit-check.yml` and
   `sentinel.yml`). A red run on `main` itself (not a PR) means a bad
   commit already landed.
3. **A user or the Owner reports it directly** — currently the most likely
   real detection path, given the gap in #1 above.
4. **`vercel.json`'s cron jobs going silent** — 16 scheduled jobs run
   daily (`/api/internal/*/run`). A cluster of them failing together is a
   platform-wide signal, not 16 independent bugs. (Real precedent:
   `docs/master/TEST_LOG.md` — `CRON_SECRET` was empty in production,
   silently disabling all cron jobs including the self-improvement loop
   runner, since creation, until caught by an E2E pass. Nothing paged
   anyone; it was found by a human-directed test sweep.)

---

## 4. Rollback procedure

### 4.1 The one fact that shapes everything below

`docs/master/AUDIT_2026-07-09.md` §25 (HIGH finding, still open) documents
that **CI and Vercel's auto-deploy are two independent, unlinked
systems**: Vercel deploys straight off pushes to `main` via its own GitHub
integration; `ci.yml` triggers on the same `push: main` event but runs in
parallel, not as a gate in front of it. A red CI run does **not** stop or
roll back a deployment that's already live from the same commit. Do not
assume "CI is green" or "CI is red" tells you anything about what's
currently serving traffic — check the Vercel dashboard directly.

### 4.2 Fast path — roll back the deployment, not the code (do this first)

The fastest real mitigation for a bad deploy is **not** reverting the
commit and waiting for a new PR to merge and build — it's telling Vercel
to serve a previous, known-good deployment immediately:

1. In the Vercel dashboard for `compliance-tracker-ai`
   (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`, region `sin1`), open
   **Deployments**, find the last deployment that was confirmed healthy,
   and use **Promote to Production** (Instant Rollback if the plan has
   it enabled; otherwise the same effect via "Redeploy").
2. Equivalently, from a machine with the Vercel CLI and
   `VERCEL_ACCESS_TOKEN` configured: `vercel rollback` targets the
   previous production deployment directly.
3. Equivalently, via the same API pattern this repo already uses in
   `.github/workflows/sync-vercel-env.yml`'s "Trigger redeploy" step:
   `POST https://api.vercel.com/v13/deployments` with
   `gitSource.ref` set to the last-known-good commit SHA (not
   necessarily `main`'s current HEAD) and the same `projectId`.

This step requires no PR, no CI run, and no code change — it exists
precisely because §4.1's gap means the fastest fix is switching what's
being served, not what's in the repo. It **does** require Vercel access
(`VERCEL_ACCESS_TOKEN`, currently a GitHub Secret) — confirm the IC or the
Owner can reach it before an incident, not during one.

### 4.3 Getting a real fix onto `main`

Once traffic is stable on the rolled-back deployment, fix the actual
defect properly:

1. Branch, fix, open a PR — the normal Rule 6 path
   (`AGENTS.md` line 37): CI must pass (Lint/Type Check/Build/Unit Tests),
   no self-merge, an Auditor (§2) reviews.
2. **Named tension, not silently glossed over**: Rule 6's branch
   protection has `enforce_admins` on with "no bypass" stated explicitly.
   That rule exists to stop two agents from silently clobbering each
   other's in-flight work (`AGENTS.md` line 37's own stated reason) — it
   was not designed with incident speed in mind, and this runbook does
   not grant itself an exception to it. If a Sev-1 ever seems to require
   bypassing the PR/CI gate to land a fix faster than §4.2's deployment
   rollback already provides safety, that is itself a decision requiring
   the Owner's explicit sign-off in the moment — the same standing rule
   every other exception in this repo already requires
   (`ai-os/CONSTITUTION.yaml`'s `amendment_rule`). Do not treat "it's an
   emergency" as authorization on its own.

### 4.4 Database incidents

- **Bad migration**: `drizzle/` holds every migration as a numbered SQL
  file (`bun run db:generate`/`db:push`/`db:migrate`, `drizzle-kit`).
  There is no automated down-migration tooling in this repo — reverting a
  bad schema change means writing and reviewing a new forward migration
  that undoes it, not running a rollback command. Use the Supabase MCP's
  `get_advisors` first to check for an active RLS/security regression
  before writing the fix.
- **Connection/pooler failure**: `orchestra_changes.md`'s Wave 11 entry
  documents a real, previously-recurring Supavisor pooler `ENOTFOUND`
  failure that blocked live verification for an entire wave. If writes
  are failing platform-wide and the app code is unchanged, check the
  pooler/connection-string configuration (transaction pooler, per
  `veridian_db_credentials_rotated_2026-07-06` memory) before assuming a
  code regression.
- **Suspected cross-tenant leak (RLS regression)**: this is the one
  incident type where the fix itself touches `security_and_guardrails`
  guardrails (`ai-os/CONSTITUTION.yaml` DATA-01, SEC-04). Do not delete or
  modify data to "clean up" a suspected leak without the Owner's
  explicit go-ahead — `AGENTS.md` Rule 9 and this platform's own SEC-04
  rule (no deletion outside an approved workflow) apply during an
  incident exactly as they do outside one.

---

## 5. Communication

There is no external status page. During a Sev-1:

1. The IC posts a running timeline as comments on a tracking GitHub issue
   in `FChecklist/compliance-tracker` (create one immediately on
   declaration — title it `SEV-1: <one-line summary>`), so the record is
   in the same system of record `AGENTS.md` Rule 5 already designates
   ("GitHub is the single source of truth").
2. The Owner is notified directly (email, per §2) at declaration and at
   resolution, not only at the end.
3. There is no customer-facing communication channel wired up in this
   repo today (no status-page integration, no customer-notification
   email template for outages) — flagged here as a real gap, not solved
   by this runbook.

---

## 6. Post-incident

Within the same PR that lands the real fix (§4.3), or a follow-up PR if
the fix was urgent enough to skip straight to §4.2's deployment rollback:

1. Add an entry to this file's **Incident log** (§7) — what happened,
   detection time, mitigation time (§4.2), full-fix time (§4.3), root
   cause, and one concrete follow-up.
2. If the incident exposed a gap this runbook or `ai-os/CONSTITUTION.yaml`
   didn't already name, update the relevant doc in the same PR — don't
   let the finding evaporate the way `runCapabilityAudit()`'s
   never-actually-wired-up gap sat undiscovered for a full wave
   (`docs/ESCALATION_MATRIX.md` §4).

## 7. Incident log

*(none yet — this runbook has not been exercised against a real incident
or a rehearsed drill as of 2026-07-16. The audit finding that produced
this document was specifically that no DR/incident rehearsal had ever
happened; writing this runbook is the first step, not a substitute for
actually rehearsing it.)*

---

## 8. What this runbook honestly does not fix

- No automated uptime/alerting (§3) — detection today is largely
  human-driven.
- No on-call rotation or paging tool (§2).
- The CI/Vercel deploy race (§4.1) is a named, still-open finding from
  `docs/master/AUDIT_2026-07-09.md` §25; this runbook works around it
  (§4.2's deployment-level rollback) rather than closing it. Closing it
  for real means gating Vercel's auto-deploy on CI success, which is
  tracked separately in `docs/master/ROADMAP.md`.
- No down-migration tooling (§4.4).
- No rehearsed drill (§7). A runbook that has never been exercised is a
  hypothesis about what will work under pressure, not a proven procedure
  — treat the first real Sev-1 (or the first deliberate drill, if one is
  scheduled before that) as this document's real test, and correct it
  afterward per §6.
