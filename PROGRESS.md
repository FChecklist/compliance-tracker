# PROGRESS -- task-20260806-142157-ocid-020-categories-15-16-17-21-execute

Parent: `UMR-20260802-165606-4413` (OCID-020, GTM certification, 25-category set).
Scope: real execution of the already-cited check scripts for
`gtm_certification_categories` 15 (multi tenant testing), 16 (role
permission testing), 17 (browser compatibility), 21 (deployment testing)
only. Categories 1-14, 18-20, 22-25 untouched; category 19 belongs to a
different real worker this cycle (untouched here).

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting real work (commit `ed40a032`, pushed).
- [x] Live-reverified the dispatch premise against the real DB before acting: category 17 already had a real, fully-evidenced `passed=0` (`validated_at=2026-08-06T13:08:53Z`), run by a prior session ~1h13m before this task's own dispatch -- SPEC's "all four still null" premise was stale for category 17. Categories 15, 16, 21 confirmed genuinely still `passed=NULL`.
- [x] Found categories 15, 16, 17, 21 still carried the old shared, itself-`failed` `child_umr_id` (`UMR-20260805-142958-ddd8`) that the 2026-08-06 11:58 backfill (`UMR-20260806-114728-d469`) already replaced with individual per-category child UMRs for the other 21 categories. Minted 4 individual child UMRs under parent `UMR-20260802-165606-4413`, via `superboss-register.py`'s own `upsert_umr_task()`/`update_umr_task()` library functions (canonical registrar, no raw SQL):
  - category 15 -> `UMR-20260806-142729-d449`
  - category 16 -> `UMR-20260806-142729-ca81`
  - category 17 -> `UMR-20260806-142729-ed21` (backfill-only, see below)
  - category 21 -> `UMR-20260806-142729-55fc`
  - Note: `gtm_write_category_result.py`'s canonical UPDATE does not expose a `child_umr_id` column write (confirmed: category 23's own prior real-fix row deliberately left `child_umr_id` untouched for the same reason) -- these 4 categories' `gtm_certification_categories.child_umr_id` DB column still reads the old shared UMR; the new linkage is recorded in each new UMR's own `inputs_json` instead, same as category 23's precedent.
- [x] Category 15 (multi tenant testing): executed `gtm_check_multi_tenant_testing.py` for real. Result: **blocked** (`passed=NULL` by design) -- no Owner-provisioned multi-tenant test credential found (env vars, `.env.local`, `ai-os/` go-ahead docs), same real outcome as the script's prior run, genuinely re-verified today. Real `evidence_json`/`evidence_summary`/`last_updated_at` refreshed via `gtm_write_category_result.py`.
- [x] Category 16 (role permission testing): executed `gtm_check_role_permission_testing.py` for real. Result: **blocked** (`passed=NULL` by design) -- same real credential-absence outcome, genuinely re-verified today.
- [x] Category 17 (browser compatibility): **not re-run** -- already real and fresh (see above); child UMR minted for linkage/attribution backfill only, real `passed=0` verdict preserved exactly as already recorded.
- [x] Category 21 (deployment testing): executed `gtm_check_deployment_testing.py` for real. Found a real `VERCEL_ACCESS_TOKEN` now present in this session's env (was absent on the script's prior run) -- manually confirmed it authenticates (`vercel --token "$VERCEL_ACCESS_TOKEN" whoami` -> `fchecklist`, exit 0). But the check script's own unmodified logic only pattern-matches env var *names* to decide `authenticated=true`, then calls `vercel ls --yes` **without** an explicit `--token` flag; the vercel CLI does not auto-recognize `VERCEL_ACCESS_TOKEN` (only `VERCEL_TOKEN`), so that unmodified call genuinely timed out (60s). Result: **blocked** (`passed=NULL`), with the real timeout recorded as evidence -- an honest result of running the already-cited script exactly as written, not a fabricated pass/fail. Fixing the script's `--token` wiring is out of this task's scope (execute, don't fix); flagged below as a follow-up finding.
- [x] All 4 child UMRs finalized (`status='completed'`, real `outputs_json`/`reason`/`ts_completed`) via `superboss-register.py`'s canonical `update_umr_task()`.

## Follow-up finding (not actioned, out of this task's scope)
`gtm_check_deployment_testing.py` treats presence of *any* `VERCEL_*TOKEN*`-named
env var as sufficient to set `authenticated=true`, then invokes `vercel ls`/`vercel
inspect` without passing `--token` explicitly. Since the real credential in this
sandbox is named `VERCEL_ACCESS_TOKEN` (not the CLI's own recognized
`VERCEL_TOKEN`), the unmodified script's own `vercel ls` call times out instead of
returning real deployment data, even though the token itself is genuinely valid
(confirmed manually via `--token` flag). A future task should decide whether to
pass `--token "$VERCEL_ACCESS_TOKEN"` explicitly in the script (or export it as
`VERCEL_TOKEN` for the check's own subprocess env) to get a real pass/fail instead
of `blocked`.

## Remaining
- [ ] None for this task's scope (categories 15, 16, 17, 21 all have a real, honest, freshly-verified state recorded). Real fixes for the credential-gated blocks on 15/16/21 require an Owner-provisioned test credential or a real Vercel-CLI-recognized token -- not actionable from this sandbox without that.
