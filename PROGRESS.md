# PROGRESS -- task-20260726-171954-storage-rls---backup-pitr---supabase-mon

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (pushed ahead of real work, no collision found)
- [x] `get_advisors` (security) audit on `storage.objects` via Supabase MCP against the live project
      `pcrjmlpuqsbocqfwoxod` -- zero findings reference storage RLS for either `compliance-documents`
      or `voice-memos`
- [x] Direct `pg_catalog`/`pg_policies`/`pg_roles` verification of the RLS state on `storage.objects`
      (RLS enabled, zero explicit policies, `anon`/`authenticated` confirmed not `BYPASSRLS` --> real
      default-deny; `service_role` confirmed `BYPASSRLS` --> policies are structurally irrelevant to it)
- [x] Code-level grep of every call site touching either bucket -- confirmed 100% service-role-only,
      org-scoped-path access, no anon/authenticated client ever used for storage
- [x] **Finding: no RLS policy fix needed** -- the assumed gap does not hold up under verification;
      documented why in the audit doc rather than making an unnecessary Tier2 schema change (per this
      task's own "if the finding doesn't match current code, say so" instruction)
- [x] PITR/backup verification via `get_organization` -- org `gycrthstsbvkojggzkjk` is on the **Free**
      plan, which does not support PITR and lacks Pro's baseline daily-backup guarantee. **Real, severe,
      code-unfixable gap.**
- [x] RTO/RPO statement written (both effectively undefined today; what a Pro upgrade + PITR add-on
      would change)
- [x] Sentry monitoring activation re-confirmed still unconfirmed (code done since V2-10/PR #497; DSN
      provisioning is an Owner sentry.io-account action, no Vercel MCP access this session to check the
      secret directly) -- matches `docs/SEV1_INCIDENT_RUNBOOK.md`'s existing honest gap, independently
      re-verified rather than assumed
- [x] Wrote `ai-os/V2_15_SUPABASE_STORAGE_RLS_PITR_RTO_AUDIT_2026-07-26.md` (full audit doc, RTO/RPO statement,
      Owner recommendations, CSV re-score guidance for rows #40/#41/#42)
- [x] Registered the new doc in `ai-os/OS.yaml`'s `health_and_compliance` index

- [x] Opened PR #575 (`V2-15: Storage RLS + backup PITR + Supabase monitoring audit`), docs-only,
      not merged -- left for the supervising session's review per this task's own instruction

## Remaining
- [ ] CSV rows #40/#41/#42 re-score itself lives in the separate `claude-control` repo -- out of this
      repo's PR scope; the audit doc's §5 supplies the exact re-score text for whoever does that there
- [ ] Owner decision needed on: (a) Supabase org plan upgrade (Free -> Pro) + PITR add-on for real
      backup/DR coverage, (b) completing Sentry DSN provisioning (sentry.io signup + Vercel/GitHub
      secrets) -- both are billing/dashboard actions, not code, consistent with this task's own
      constraint carving out the DSN-provisioning half as Owner-side

---

Note: this branch merged `origin/main` (2026-07-26) to resolve a PROGRESS.md conflict with an unrelated,
already-merged task's PR (`task-20260726-171200-tier2-fix--pr-566-pr-83-stale-pr-81-stil`, whose own
commits are already on `main` independent of this file's contents). No other files conflicted.
