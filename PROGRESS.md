# PROGRESS -- task-20260804-235321-independently-re-verify-group-f-ocid-047

SPEC (UMR-20260802-165606-4413): commit 11a5de5e claimed OCID-047/048/049/050/051/052 all
"genuinely closed" but was demonstrably wrong about OCID-049 (legacy `subscription_plans` rows
winning tier resolution -- only found via independent live re-verification, fixed via merged
PR #924). Independently re-verify OCID-047, OCID-048, OCID-050, OCID-051, OCID-052 from scratch:
real live browser/API reproduction against live projexa-ai.com, not a re-read of the commit
message. Report each honestly. Do not certify OCID-020 complete based on 11a5de5e's own claim.

## Completed
- [x] Read governance docs, registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
- [x] Set up independent live-testing environment: dedicated worktree `/tmp/ocid047-052-verify`
      (detached at `origin/main` 649d2583), `.env.local` + `node_modules` from the live
      `compliance-tracker` checkout, Playwright chromium working (`LD_LIBRARY_PATH` fix per
      known chrome-system-libs workaround) -- confirmed reaches live projexa-ai.com

## Remaining
- [ ] OCID-047 (Rights/Responsibility/Scope role matrix) -- independent live re-verification
- [ ] OCID-048 (Multi-Org/Tenant/Brand isolation) -- independent live re-verification
- [ ] OCID-050 (Data State Certification) -- independent live re-verification
- [ ] OCID-051 (Cross-Surface: browser + Mobile PWA) -- independent live re-verification
- [ ] OCID-052 (VERI Chat AI Escalation) -- independent live re-verification
- [ ] Register any new real gap(s) found in `ai-os/MASTER-TRACKER.yaml`
- [ ] Final honest report per OCID, citing this UMR
