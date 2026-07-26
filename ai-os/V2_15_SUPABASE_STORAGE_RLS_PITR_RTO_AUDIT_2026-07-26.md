# V2-15 — Storage RLS + Backup/PITR + Supabase Monitoring Audit (2026-07-26)

> **Task**: V2-15-SUPABASE-DR-AUDIT (`ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`),
> closes CSV rows #40/#41/#42 in claude-control's
> `VERIDIAN_Review_Framework_evaluated_2045rows.csv` (separate repo — this doc supplies the
> verified evidence for whoever re-scores those rows there; it does not edit that CSV itself,
> the same cross-repo split `REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md` and other V2 audit docs
> already use).
> **Live project audited**: `pcrjmlpuqsbocqfwoxod` ("verdian-ai", org `gycrthstsbvkojggzkjk`
> "MeetTrack"), via the Supabase MCP (`get_advisors`, `execute_sql`, `get_project`,
> `get_organization`) — not the dashboard, per this task's own READ FIRST.
> **Verdict summary**: storage RLS — **no live gap, no fix applied** (see §1, with the reasoning
> for why not). Backup/PITR — **real, severe gap**, not code-fixable (see §2). Sentry — **code
> done, activation still unconfirmed**, not code-fixable (see §3). Both real gaps are
> Owner-dashboard/billing actions, consistent with this task's own constraint that the
> DSN-provisioning half (and, newly confirmed, the plan/PITR-add-on half) is Owner-side.

## 1. `storage.objects` RLS audit — both buckets

**Buckets in scope** (the two named in the task; a third, `org-branding`, exists but is out of
scope — it's `public`, has no confidentiality requirement, and was already audited in
`drizzle/0221_wave_b_white_label_branding.sql`'s own header):

| Bucket | Public | Created |
|---|---|---|
| `compliance-documents` | false | 2026-07-02 |
| `voice-memos` | false | 2026-07-15 |

**`get_advisors(type: security)` result**: zero findings reference `storage.objects`, either
bucket, or RLS on storage at all. The 27 findings returned are all unrelated (3 `SECURITY
DEFINER` views under `public`, several `function_search_path_mutable` warnings, 2 extensions
installed in `public`, 3 `rls_policy_always_true` findings on unrelated marketing-intake tables
`email_subscribers`/`inquiries`/`stage0_submissions`, 4 anon/authenticated-callable
`SECURITY DEFINER` function warnings, 1 auth leaked-password-protection warning). None of this
list is new information this task needs to act on beyond noting it did not surface a storage
finding.

**Direct verification (not just trusting the advisor's silence)**:

```sql
select relrowsecurity, relforcerowsecurity from pg_class
  where relname='objects' and relnamespace = (select oid from pg_namespace where nspname='storage');
-- relrowsecurity=true, relforcerowsecurity=false

select policyname from pg_policies where schemaname='storage' and tablename='objects';
-- zero rows: no explicit policy for either bucket

select rolname, rolbypassrls from pg_roles where rolname in ('service_role','authenticated','anon');
-- service_role: rolbypassrls=true | authenticated: false | anon: false
```

**Why this is not a live vulnerability, despite zero explicit policies existing**: RLS is
*enabled* on `storage.objects` (not disabled — that's the different, real vulnerability class
`drizzle/0179_rls_gap_fix_7_tables.sql` closed for 7 other tables in 2026-07-13). With RLS
enabled and zero matching policies, Postgres default-denies every role that isn't
`BYPASSRLS`/table-owner for every command. `anon` and `authenticated` — the only roles Supabase's
PostgREST/Storage API can be reached as from outside this codebase — are confirmed **not**
bypass-RLS, so they get **zero** direct read/write access to either bucket's objects today. The
only role that ever touches these buckets is `service_role`, confirmed `rolbypassrls=true` —
meaning it would have full access with or without policies; policies are structurally irrelevant
to it.

**Code-level confirmation this design is actually followed everywhere, not just true in
theory**: grepped every call site touching either bucket —
`src/app/api/documents/route.ts`, `src/app/api/documents/[id]/route.ts`,
`src/app/api/client-portal/[token]/documents/route.ts`, `src/app/api/voice-tickets/route.ts`,
`src/lib/services/esignature-service.ts`, `src/lib/services/workspace-memory-service.ts`. Every
one instantiates its own short-lived `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` server-side,
gated behind `requireAuth()`/`requireRole()` first — none uses an anon or user-session Supabase
client for storage. `documents/route.ts`'s own comment states this explicitly: *"the bucket
itself has no anon/authenticated storage policies at all... this is the only code path that can
ever touch it."* Object paths are consistently `${orgId}/...`-prefixed (`voice-tickets/route.ts`,
`documents/route.ts`, `client-portal/[token]/documents/route.ts`, `workspace-memory-service.ts`)
— org-scoping is enforced at the application layer (every route already requires the caller's
own `orgId` via `requireAuth()` before ever building a path), not at the storage-policy layer,
by design.

**Conclusion — no RLS policy fix applied.** This task's own constraint says: *"If the finding
turns out to already be resolved, or doesn't match what you find in the current code, say so in
PROGRESS.md rather than making an unnecessary change."* That's the case here: the premise (an
open RLS gap on these two buckets) does not hold up under direct verification — the buckets are
already in the secure state (RLS enabled, default-deny for every role that could reach them from
outside the server, all real access already service-role-gated and app-layer org-scoped).
Explicit `service_role`-scoped policies would be a redundant no-op (that role bypasses RLS
regardless) and would be a Tier2 schema/RLS change per this task's own constraint — not worth
opening for a change with zero functional or security effect. If a future feature ever needs
direct client-side (anon/authenticated-role) access to either bucket, add a real scoped policy
in its own reviewed migration at that time, following the exact pattern
`0179_rls_gap_fix_7_tables.sql` already established for this repo (`app_runtime`/role-scoped
`USING` clause + paired `service_role_bypass_*` policy) — do not assume today's absence of
findings means it's safe to skip that step later.

## 2. Backup / PITR verification

**`get_organization(gycrthstsbvkojggzkjk)`**: `"plan":"free"`.

This is the real, severe finding. Supabase's Free plan does not include Point-in-Time Recovery
at all — PITR is a paid add-on available only on Pro-tier-and-above projects, billed separately
per day of retention. The Free plan's baseline daily-backup guarantee is also materially weaker
than Pro's (Pro includes 7 daily backups out of the box; Free-tier projects do not carry the same
backup SLA and are also subject to auto-pausing after inactivity, which is itself a separate
availability risk this task did not have scope to also audit).

**No dedicated "list backups" MCP tool exists** to enumerate actual snapshot history directly (no
`get_backups`/`list_backups` tool is exposed by this Supabase MCP server) — the plan tier itself
is the authoritative, load-bearing fact here: a Free-plan project cannot have PITR configured
regardless of what a backups list would show, so the plan check alone is sufficient to close this
finding without needing dashboard access this session doesn't have.

**Confirmed via direct SQL** that the underlying WAL machinery a PITR feature would need is
present at the Postgres level (`archive_mode=on`, `wal_level=logical`, `max_wal_senders=5`) —
i.e., nothing here is a self-inflicted platform-config gap; it's purely the plan tier that's
missing the feature, not a misconfiguration this repo's own migrations or settings caused.

**RTO/RPO statement** (the actual deliverable this section owes):

- **RPO (Recovery Point Objective) today: effectively unbounded / undefined.** With no PITR and
  no confirmed Pro-tier daily-backup guarantee, there is no verified continuous or
  scheduled recovery point for this project's data. In the worst case (data corruption or
  accidental destructive operation with no recent manual export), the recovery point is
  whatever the last manual `pg_dump`/export happens to be — which, per
  `docs/SEV1_INCIDENT_RUNBOOK.md` §6's own honest-gaps list, **has never been rehearsed or
  scheduled** for this platform's own data (the only DR-shaped code in this repo, the `it-dr`
  module, is a customer-facing GRC feature *other tenants* use to track *their own* DR posture —
  it is not this platform's internal practice).
- **RTO (Recovery Time Objective) today: effectively unbounded / undefined**, for the same
  reason — there is no rehearsed restore procedure, so the actual time-to-restore in an incident
  is unknown, not just unmeasured.
- **What would change this**: upgrading the `gycrthstsbvkojggzkjk` organization from Free to
  Pro would grant the default 7-daily-backups baseline (turning RPO from "undefined" to "up to
  ~24h" and RTO to "however long a Supabase-initiated restore takes, typically documented by
  Supabase as low-hours-scale"); additionally enabling the PITR add-on on top of Pro would bring
  RPO down to Supabase's advertised granularity (as low as ~2 minutes, plan-dependent). Both are
  genuine recurring-cost billing decisions, not a code or MCP action — squarely the same class of
  Owner-dashboard action this task's own constraint already carves out for Sentry DSN
  provisioning (V2-6/C17), and the same "free-half-now, paid-half-deferred-on-money" precedent
  `ai-os/STAGING_ENV_2026-07-20.md` and `REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md`'s C19 entry
  already established for this exact organization's Supabase billing.
- **Recommended immediate free mitigation** (no plan upgrade required, and within this task's
  own code/MCP scope): none exists that meaningfully changes the RPO/RTO picture — a manual
  `pg_dump` triggered by this session would only be a single ad hoc point-in-time snapshot, not a
  recurring safety net, and would misrepresent the actual gap as "handled" if left as the only
  action. Not taken, to avoid implying a one-off dump closes a genuinely open recurring-backup
  gap.

## 3. Sentry monitoring activation confirmation

**Code integration status**: complete, confirmed by direct file read.
`sentry.server.config.ts`/`sentry.edge.config.ts` both call `Sentry.init({dsn:
process.env.SENTRY_DSN, ...})` — a safe no-op when `SENTRY_DSN` is unset (verified previously
via `bun run build` with no secret set, per `docs/infra/TOOL_INTEGRATION_PLAN.md` §6 item 1).
`src/instrumentation.ts` additionally runs `warnIfSentryDsnMissing()`
(`src/lib/sentry-dsn-check.ts`, built and merged 2026-07-20 as V2-10, PR #497) at startup for
both the `nodejs` and `edge` runtimes, so a missing DSN is at least logged, not silently absent.

**Activation status: still unconfirmed, not code-verifiable from this repo or this session's
tool access.** `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are Vercel/GitHub secrets, not committed to
this repo (correctly — they'd be a `.env` violation if they were) and not readable via the
Supabase MCP this task has access to; no Vercel MCP connector is authenticated in this session
either (attempted — the `claude.ai Vercel` connector requires interactive OAuth this headless
session cannot perform). This matches `docs/SEV1_INCIDENT_RUNBOOK.md` §6's own existing honest
callout verbatim: *"Sentry's real detection value is unverified. Its DSN configuration in Vercel
hasn't been confirmed as part of this runbook — check it, don't assume it."* This audit does not
change that status — it independently re-confirms the same gap is still open as of 2026-07-26,
rather than silently assuming V2-10's code-side work already means activation happened.

**What would close this**: per `docs/infra/TOOL_INTEGRATION_PLAN.md` §6 item 1 and this task's
own constraint (V2-6/C17 territory), the Owner signs up at sentry.io (free tier), creates a
Next.js project, and adds `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` to Vercel + GitHub Secrets. No
agent action closes this — third-party account creation is out of scope for every agent in
`AGENTS.md`.

## 4. Recommendations for the Owner (all billing/dashboard actions, none code)

1. **Highest priority**: decide whether to upgrade the `gycrthstsbvkojggzkjk` org (currently
   Free) to Pro to get baseline daily backups, and separately whether to add the PITR add-on on
   top of that for continuous recovery — this is the one real, unmitigated severe gap this audit
   found. Until decided, treat this platform's actual RPO/RTO as undefined, not as some assumed
   default.
2. Complete Sentry DSN provisioning (sentry.io signup + `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` in
   Vercel/GitHub Secrets) — code side has been ready since 2026-07-10/2026-07-20.
3. No `storage.objects` RLS action needed — the current default-deny-for-anon/authenticated +
   service-role-only + app-layer-org-scoped design is already the secure state; re-verify only if
   a future feature adds direct client-side (non-service-role) storage access.

## 5. CSV re-score note (for whoever closes rows #40/#41/#42 in claude-control)

- **Row for storage RLS**: re-score as **"Verified — no gap, no fix needed"** (was previously an
  assumed-open finding; §1 above is the verification evidence).
- **Row for backup/PITR**: re-score as **"Confirmed real gap — blocked on Owner billing
  decision"**, not "closed" and not "code gap" — it cannot be closed by code, only by a plan
  upgrade. §2 above (plan=free, RTO/RPO statement) is the evidence.
- **Row for Sentry monitoring**: re-score as **"Code done (V2-10) — activation still unconfirmed,
  blocked on Owner account-creation action (same class as C17)"**. §3 above is the evidence.

This doc lives in compliance-tracker (this repo); the CSV itself lives in claude-control and is
out of this repo's PR scope, per the same cross-repo split this task's own predecessor docs
(`REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md`, `STAGING_ENV_2026-07-20.md`) already used.
