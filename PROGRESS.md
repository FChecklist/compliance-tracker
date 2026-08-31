# PROGRESS -- task-20260718-171007-commercial--subscription---pricing-model

Findings: (1) Per-User AI Subscription Model, (2) Base Subscription + Token
Consumption Pricing. See prompt for full text.

**Rebase note (2026-08-31)**: original PR #1020 sat open since 2026-07-18
and never got a real CI run (0 GitHub Actions runs on its head commit).
Rebased onto current `main` (many commits ahead, several genuine content
conflicts -- schema.ts/token-usage-service.ts/settings page.tsx/PROGRESS.md/
asset-registry-coverage.yaml, all resolved keeping both sides' real
functionality where main had grown independently, e.g. the separate
`SubscriptionPlanSection` entitlement UI kept as a sibling nav tab next to
this PR's `BillingSection`). Migration renumbered
`0225_platform_billing_plans_invoices.sql` -> a free high number (main's
0225 slot was independently claimed by `0225_support_sessions.sql`; see
that migration file's own header for the exact number used) since main had
moved to migration 0350+ by rebase time. Re-opened as a replacement PR
(this PR, "... [was #1020]"); #1020 itself closed as superseded. The
`$2499/mo` Professional-tier figure seeded in the migration (and the
`included_ai_cost_usd`/`overage_multiplier` assumptions) are illustrative
placeholders carried over from the original PR, not a real pricing
decision -- still needs Owner confirmation before this could ever charge
anyone for real, and connecting an actual payment processor remains an
explicit separate future decision (see `payment-gateway-client.ts`, which
returns `not_configured` -- this repo has zero real payment-processor
credentials, so nothing in this PR can charge a real customer). The
"Verified" bullet below is the *original* PR author's self-report and was
NOT trusted as-is -- this rebase got its own fresh, real CI run before
merging; see this file's own git history / the replacement PR description
for the actual rebase-time verification results.

## Completed
- [x] Read AGENTS.md / CLAUDE.md / ai-os/CONSTITUTION.yaml pointers and
      ai-os/boss/ACTIVE-CLAIMS.yaml -- no conflicting active claim; registered
      this task's own claim.
- [x] Verified both gaps against current code (not the stale finding text):
      - org-license-service.ts / users.isActive / organisations.licensedSeats
        is real per-seat *license count* enforcement, but has no $ amount, no
        invoice, no payment gateway.
      - erp_subscriptions / erp_subscription_plans (schema.ts) are the ERP
        module's tracking of *customers'* own subscriptions (a CRM/ERP
        feature for orgs' customers) -- not VERIDIAN billing its own orgs.
      - token-usage-service.ts / tokenUsageLedger table is explicitly
        internal Finance-facing cost reporting (see its own header comment),
        not a customer-facing usage-to-invoice pipeline.
      Conclusion: both findings are still real gaps. Proceeded with
      additive implementation, not a no-op.
- [x] Additive schema (drizzle/0225_platform_billing_plans_invoices.sql):
      platform_billing_plans (planKey/name/baseFeeMonthlyUsd/
      perSeatMonthlyUsd/includedAiCostUsd/overageMultiplier/isActive,
      platform-wide, seeded with the 3 real tiers from
      src/app/pricing/page.tsx's PLANS array) + platform_billing_invoices
      (org-scoped, generated per-period bill: seatCount/baseFeeUsd/
      seatFeeUsd/aiCostUsd/includedAiCostUsd/overageAiCostUsd/
      overageChargeUsd/totalUsd/status/paymentGatewayRef, unique per
      (org,period) and per (org,invoiceNumber)). Standard org-scoped
      FORCE RLS (invoices) / platform-wide read-only RLS (plans), matching
      crm_accounts/gst_gstin_master precedent. Both registered in the UMR
      (ai-os/registry/asset-registry-coverage.yaml +
      asset_registration_config INSERT + auto_register_asset_trg in the
      same migration) -- verified via `node
      scripts/check-asset-registry-coverage.mjs` (433 tables accounted
      for, up from 431).
- [x] token-usage-service.ts gained getOrgUsageForPeriod(orgId, start, end)
      -- the arbitrary-period generalization of cost-guard.ts's existing
      "always current calendar month" getMonthlySpend(), reused by the
      billing service rather than re-deriving usage a second way.
- [x] src/lib/services/platform-billing-service.ts: computeInvoiceLineItems
      (pure pricing math, unit tested -- 4 tests in
      platform-billing-service.test.ts), previewCurrentPeriodInvoice
      (live unpersisted dashboard preview), generateInvoiceForPeriod /
      generatePreviousMonthInvoice (idempotent per (org,period) --
      re-running an already-generated period recomputes in place rather
      than duplicating, same posture as the exchange-rate daily refresh),
      listInvoicesForOrg. Reuses org-license-service.getLicenseStatus for
      seat count -- no seat-counting logic duplicated.
- [x] src/lib/services/payment-gateway-client.ts: the explicit, honestly-
      documented seam for "integrate a payment gateway" -- env-gated
      (PAYMENT_GATEWAY_PROVIDER), returns 'not_configured' today since no
      real processor credentials exist anywhere in this repo/environment
      and choosing one is a business decision for the Owner (AGENTS.md
      Rule 7(e): deploy-adjacent decisions need explicit Owner
      confirmation). Never fabricates a fake charge success.
- [x] API routes (all requireAuth()-gated, Drizzle-only): GET
      /api/billing/plans (any authenticated user), GET
      /api/billing/current-usage (live preview), GET /api/billing/invoices
      (list), POST /api/billing/invoices/generate (admin/manager-gated,
      same role check as PATCH /api/settings/org-limits).
- [x] Admin UI: new src/components/BillingSection.tsx (current-period
      preview + invoice history table + admin-only "generate" button),
      wired into settings/page.tsx as a new "Billing" nav section
      alongside the existing "Seats & AI Spend" one.
- [x] Verified: `bunx tsc --noEmit` clean, `bun run lint`
      (eslint on changed files) clean, `bun test` 1425/1425 pass (incl.
      new platform-billing-service.test.ts), `node
      scripts/check-asset-registry-coverage.mjs` /
      `check-guardrail-presence.mjs` / `check-metadata-index-coverage.mjs`
      all pass. `bun run db:generate` regenerated its own out-of-sync
      baseline snapshot (drizzle-kit's tracking is already stale
      repo-wide -- CI runs this step with `|| true` for exactly that
      reason) -- discarded that generated artifact, kept only the
      hand-written 0225 migration, matching this repo's established
      hand-write-migrations convention.
- [x] Did NOT touch permission-service.ts's ERP_ACTION_ROLES or any
      in-flight worker's declared scope, per the task's own instruction.

## Remaining
- [ ] Open PR, get CI green, merge (Rule 6 -- no direct push to main).
- [ ] Update ai-os/MASTER-TRACKER.yaml / ai-os/boss/COMPLETED.yaml per
      Rule 7(d) once merged; move ACTIVE-CLAIMS entry to
      recently_completed.
- [ ] Out of scope, documented as honest follow-ups (not silently
      dropped): (a) no real payment-gateway integration -- needs an Owner
      decision on processor + real credentials, see
      payment-gateway-client.ts; (b) no admin UI to edit
      platform_billing_plans rows (seeded via migration only for now);
      (c) no automated monthly billing-run cron -- generation is
      currently manual (POST /api/billing/invoices/generate); (d)
      included_ai_cost_usd/overage_multiplier seed values are a
      documented starting assumption, not a real pricing decision on file
      anywhere -- confirm real numbers with the Owner before this
      actually charges anyone.
