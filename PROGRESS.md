# PROGRESS -- rebase-1020-v2 (replacement for PR #1020)

## Scope

Replacement PR for #1020 ("Close Commercial/Subscription & Pricing Model
gap: real platform billing"). #1020 was reviewed and approved as real,
additive internal plumbing (invoice generation + usage tracking), but its
branch was 3+ weeks stale against `main` (`mergeable: CONFLICTING`) and its
own PR body self-reported test/lint/CI numbers that no real GitHub Actions
run had ever verified (zero check runs on its head commit). This task
rebases the real code onto current `main`, renumbers a colliding migration,
and gets a genuine green CI run before merging.

## Completed

- [x] Worktree: merged PR #1020's real branch
      (`worker/task-20260718-171007-commercial--subscription---pricing-model`,
      head `4ed3405e`) onto fresh `origin/main` (`db75f449`). 9 real
      conflicts resolved by hand:
      - `PROGRESS.md` -- replaced with this file (per-task scratch doc).
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- PR #1020's own `active:` claim
        entry merged in cleanly as a sibling (no conflict there). The
        `recently_completed:` conflict was PR #1020's branch reintroducing
        two already-stale 2026-07-18 entries that have since rolled off
        main's own "last ~15" rolling window (file's own documented
        convention -- permanent record lives in MASTER-TRACKER.yaml) --
        kept HEAD's current window, dropped the stale reintroduction.
      - `ai-os/registry/asset-registry-coverage.yaml` -- both sides added
        different new table registrations at the same list position (HEAD:
        business_terminology_glossary/ai_model_registry/
        construction_progress_claims; PR #1020: platform_billing_plans/
        platform_billing_invoices) -- kept both as siblings, updated
        PR #1020's two entries' migration-number references from 0225 to
        the renumbered 0400.
      - `src/app/(app)/settings/page.tsx` -- both sides added a different,
        unrelated new settings section (HEAD: "Subscription Plan" /
        SubscriptionPlanSection; PR #1020: "Billing" / BillingSection) --
        kept both as sibling nav items/imports/render blocks.
      - `src/components/AppShell.tsx` -- pure base drift, not a real
        collision: PR #1020's branch predates a later main refactor that
        replaced the old per-branch `veriChatV2Enabled` nested
        VeriComposer/VeriChatPanel duplication inside the *legacy*
        (non-V2) render path with a single `GlobalChatDock`. Kept HEAD's
        current (simpler, already-shipped) structure entirely; PR #1020
        never intended to touch this file.
      - `src/lib/db/schema.ts` -- git rendered this as one whole-file
        conflict (22,975 lines each side; known behavior on this file, not
        a real collision). Diffed PR #1020's branch against the merge-base
        directly (`git diff <merge-base> pr-1020-head -- schema.ts`) to
        isolate its actual 74-line addition (`platformBillingPlans` /
        `platformBillingInvoices` tables + relations), restored HEAD's
        file via `git cat-file -p` (plain `git show >` truncates large
        blobs to ~31 lines in this shell -- known gotcha), and hand-applied
        just that addition after `tokenUsageLedger`, matching its original
        insertion point.
      - `src/lib/services/construction-dashboard-service.ts`,
        `erp-invoicing-service.ts`, `tenant-isolation.test.ts` -- all pure
        base drift (HEAD added unrelated later imports/functions PR #1020's
        older snapshot doesn't have) -- kept HEAD's side in each case.
      - `src/lib/services/token-usage-service.ts` -- import-line conflict
        only; the real addition (`getOrgUsageForPeriod`, PR #1020's
        arbitrary-period usage aggregation for billing) auto-merged
        cleanly at the end of the file. Merged the import line to keep
        both HEAD's `estimateCacheSavingsUsd`/`buildSpendForecast` imports
        and PR #1020's `eq` import (needed by `getOrgUsageForPeriod`).
- [x] Migration collision resolved: PR #1020's `drizzle/0225_platform_
      billing_plans_invoices.sql` collided with main's own independently-
      numbered `0225_support_sessions.sql`. Renumbered to
      `drizzle/0400_platform_billing_plans_invoices.sql` -- confirmed via
      fresh `git ls-tree -r origin/main -- drizzle/` (highest existing:
      0360) immediately before renumbering, jumping well clear of that and
      of other concurrently-active agents' claimed numbers in the
      0361-0399 range per this task's own instructions. `drizzle/meta/
      _journal.json` updated with a new idx=316 entry
      (`0400_platform_billing_plans_invoices`). Re-verified no other
      `0400` migration or journal tag existed immediately before the final
      push (see Remaining/verification note below).
- [x] No functional changes to PR #1020's own billing logic
      (platform-billing-service.ts, payment-gateway-client.ts, the
      /api/billing/* routes, BillingSection.tsx) -- rebase only.
      `payment-gateway-client.ts` still explicitly returns `not_configured`
      -- no real payment-gateway credentials exist anywhere in this repo/
      environment, so nothing in this change can charge a real customer
      regardless of merge. Seeded example pricing figures (e.g. the
      $2499/mo enterprise tier) are still placeholders pending an Owner
      pricing decision, same as PR #1020's own documented scope.
- [x] This PR's own self-reported "bunx tsc --noEmit clean / bun run lint
      clean / bun test 1425/1425 pass" numbers were NOT trusted (triage
      confirmed zero real GitHub Actions runs ever executed on #1020's head
      commit) -- re-verified for real on the rebased head before push:
      `node scripts/check-governance-yaml-parse.mjs` passed clean;
      `bun test src/lib/services/platform-billing-service.test.ts` genuinely
      passed 4/4 (12 expect() calls); `bun test` on
      `tenant-isolation.test.ts` (one of this rebase's hand-resolved
      conflicts) also genuinely passed 68/68 regression-checking the manual
      merge resolution. `bunx tsc --noEmit` could NOT be completed locally
      -- this sandbox is under severe, session-wide memory pressure from
      many other concurrent worktree sessions on this same machine
      (confirmed live: `Get-CimInstance Win32_OperatingSystem` showed
      0.01-0.08GB free out of 7.82GB total while it ran, and many other
      `node`/`tsc`/`bunx` processes from sibling sessions already
      competing for that same headroom) -- the exact same pre-existing
      sandbox limitation already documented elsewhere in this repo's other
      rebase sessions. Deferred to CI's real Type Check job (`ci.yml`'s
      `typecheck` job runs `bunx tsc --noEmit` on `ubuntu-latest` with
      `NODE_OPTIONS: --max-old-space-size=8192`, real dedicated resources)
      -- this task does not claim tsc is clean until that job is
      confirmed green for real; see the replacement PR's actual CI run,
      not a self-report, for that result.

## Remaining

- [ ] Push `rebase-1020-v2`, open replacement PR ("... [was #1020]"),
      close #1020 citing supersession, wait for a real green CI run (not
      self-reported numbers), merge only if genuinely green.
- [ ] Update `ai-os/MASTER-TRACKER.yaml` / `ai-os/boss/COMPLETED.yaml` per
      Rule 7(d) once merged; move the ACTIVE-CLAIMS entry to
      `recently_completed`.
- [ ] Out of scope, same as #1020's own documented follow-ups (not
      silently dropped): (a) no real payment-gateway integration -- needs
      an Owner decision on processor + real credentials; (b) no admin UI
      to edit `platform_billing_plans` rows (seeded via migration only);
      (c) no automated monthly billing-run cron (generation is manual via
      the API); (d) seeded `included_ai_cost_usd`/`overage_multiplier`
      values (and the example plan price points, e.g. $2499/mo) are a
      documented starting assumption, not a confirmed pricing decision --
      needs Owner sign-off before this charges anyone for real.
