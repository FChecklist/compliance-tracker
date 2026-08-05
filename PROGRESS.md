# PROGRESS -- task-20260804-235321-independently-re-verify-group-f-ocid-047

SPEC (UMR-20260802-165606-4413): commit 11a5de5e claimed OCID-047/048/049/050/051/052 all
"genuinely closed" but was demonstrably wrong about OCID-049 (legacy `subscription_plans` rows
winning tier resolution -- only found via independent live re-verification, fixed via merged
PR #924). Independently re-verify OCID-047, OCID-048, OCID-050, OCID-051, OCID-052 from scratch:
real live browser/API reproduction against live projexa-ai.com, not a re-read of the commit
message. Report each honestly. Do not certify OCID-020 complete based on 11a5de5e's own claim.

## Completed
- [x] OCID-047 re-verified: **NEW GAP FOUND** (2 real gaps, `GAP-CLIENT-LIST-NO-SCOPE-ENFORCEMENT`
      + `GAP-RISK-CREATE-403-SILENT-DENIAL-UX`) -- previously live-found by unmerged/conflicting
      PR #827, never registered in MASTER-TRACKER.yaml, independently reproduced live today on a
      fresh org. 11a5de5e's "genuinely closed" claim was wrong about OCID-047 too. Registered.
- [x] Read governance docs, registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
- [x] Set up independent live-testing environment: dedicated worktree `/tmp/ocid047-052-verify`
      (detached at `origin/main` 649d2583), `.env.local` + `node_modules` from the live
      `compliance-tracker` checkout, Playwright chromium working (`LD_LIBRARY_PATH` fix per
      known chrome-system-libs workaround) -- confirmed reaches live projexa-ai.com

## Completed (cont.)
- [x] OCID-048: CONFIRMED CLOSED (5 new probes: ai_assistants RLS isolation + subscription-plan
      cross-tenant + brand/host-routing, zero leaks). Side finding (not isolation bug, not
      registered as a gap): legacy Trial/Starter/Growth/Scale rows still appear in the admin
      plan-picker (`listActiveSubscriptionPlans()`), OCID-049-adjacent, separate from this OCID.
- [x] OCID-050: **NEW GAP FOUND** -- `/settings` page's Subscription Plan tab never renders after
      real login (stuck on Profile placeholder state), HTTP 200/no-crash so invisible to the
      original check-methodology (status-code-only, no interaction). Both prior "2 real gaps"
      (abac183b) confirmed already fixed. Registered `GAP-SETTINGS-SUBSCRIPTION-TAB-NOT-RENDERING`.
- [x] OCID-051: CONFIRMED CLOSED (real mobile PWA re-test: device emulation, share-target,
      offline, manifest, 14-page mobile sweep, and confirmed OCID-049 fix reflected on the
      mobile-authenticated `/api/me` path too). PR #844's audit trail verified to genuinely exist.

- [x] OCID-052: CONFIRMED CLOSED (GET /api/me fix confirmed live twice; /home composer no longer
      off-screen; Items 2-4 reconfirmed fresh with a second new org). Honest caveat carried
      forward, not a new gap: Item 5 (dialogue-script path) has never been executed by anyone and
      is structurally untestable today (zero `instruction_packages` rows in production).

## Remaining
- [ ] None -- all 5 OCIDs (047, 048, 050, 051, 052) independently re-verified. See summary below.

## Final summary (all 5, per UMR-20260802-165606-4413)
11a5de5e's "genuinely closed" claim, already proven wrong about OCID-049, is confirmed wrong
about **2 of the other 5** too:
- **OCID-047: NEW GAPS FOUND** -- `GAP-CLIENT-LIST-NO-SCOPE-ENFORCEMENT` (real cross-role data
  exposure, viewer sees all org clients) + `GAP-RISK-CREATE-403-SILENT-DENIAL-UX`. Both were
  already live-found once by commit 925f3204 but its PR #827 never merged, so they never reached
  MASTER-TRACKER.yaml and 11a5de5e closed Group F without them. Independently reproduced live
  today on a fresh org. Registered.
- **OCID-050: NEW GAP FOUND** -- `GAP-SETTINGS-SUBSCRIPTION-TAB-NOT-RENDERING` (/settings
  Subscription Plan tab never renders after real login; invisible to the original status-code-only
  sweep). Registered.
- **OCID-048: CONFIRMED CLOSED** -- 5 new independent probes (ai_assistants RLS isolation,
  subscription-plan cross-tenant, brand/host-routing), zero leaks.
- **OCID-051: CONFIRMED CLOSED** -- real mobile PWA re-test (device emulation, share-target,
  offline, manifest, 14-page sweep), OCID-049 fix confirmed reflected on mobile path too.
- **OCID-052: CONFIRMED CLOSED** -- /api/me fix and /home panel reconfirmed live; Items 2-4
  reconfirmed with a fresh org. Honest caveat: Item 5 has never been executed by anyone and is
  currently untestable (zero real dialogue-script data in production) -- not a new gap, disclosed
  scope-narrowing carried forward.

**OCID-020 / Group F is NOT fully closed.** 3 real open gaps now stand between here and that
claim (2 from OCID-047, 1 from OCID-050), on top of OCID-049's already-fixed one. Do not certify
OCID-020 complete on 11a5de5e's claim.
