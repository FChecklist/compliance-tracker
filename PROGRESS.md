# PROGRESS -- task-20260718-171007-commercial--subscription---pricing-model

Findings: (1) Per-User AI Subscription Model, (2) Base Subscription + Token
Consumption Pricing. See prompt for full text.

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
      Conclusion: both findings are still real gaps. Proceeding with
      additive implementation, not a no-op.

## Remaining
- [ ] Additive schema: platform_billing_plans (base fee, per-seat price,
      included token allowance, overage rate) + platform_billing_invoices
      (per org/period: seat count, base fee, seat cost, token usage, overage
      cost, total, status) + migration.
- [ ] platform-billing-service.ts: compute a billing period's invoice from
      existing org-license-service seat count + tokenUsageLedger usage
      (scope='product_orchestra', orgId-scoped).
- [ ] Admin-gated API routes under src/app/api/billing/*.
- [ ] Admin UI page showing current-period usage + generated invoices.
- [ ] Explicitly stubbed payment-gateway interface point (not a live
      integration -- no real payment processor credentials exist in this
      environment; documented as an owner-confirmation-gated follow-up).
- [ ] Update ai-os/MASTER-TRACKER.yaml / ai-os/boss/COMPLETED.yaml per
      Rule 7(d) once merged; move ACTIVE-CLAIMS entry to recently_completed.
- [ ] Open PR, get CI green, merge (Rule 6 -- no direct push to main).
