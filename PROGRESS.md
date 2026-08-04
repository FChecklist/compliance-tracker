# PROGRESS -- task-20260804-153149-ocid-020-real-critical-regression-trigge

Real PM decision for OCID-020 (`UMR-20260802-165606-4413`): spec asked to (1) trigger a genuine
independent audit on PR #898 (the GAP-API-ME-500-SUBSCRIPTION-PLAN-STATUS discovery/documentation
artifact) and get it reviewed+merged, and (2) attempt real production log access / server-side
evidence to find the actual stack trace behind the live `GET /api/me` 500, turning the finding
from symptom into root cause. Discovery only, no code fix, per the standing OCID-021 lock.

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting real work (fixed an
      accidental duplicate top-level `active:` key introduced while editing -- corrected to a
      single `active:` list, confirmed with `yaml.safe_load`).
- [x] **Stale-premise check on PR #898**: spec assumed it was "currently OPEN". Re-verified fresh
      via `gh pr view 898` -- it had already **merged** at `2026-08-04T15:12:28Z`, ~19 minutes
      before this session's own start timestamp, via the normal autonomous supervisor-sweep path.
      Not re-litigated; documented as-is.
- [x] **Audit-quality assessment on PR #898**: it does carry an `AUDIT: PASS` comment (posted
      2026-08-04T15:11:51Z), satisfying Rule 10's mechanical CI gate. However `author`,
      all 4 `commits[].authors`, `mergedBy`, and the `AUDIT:` comment author are **all the same
      GitHub identity** (`FChecklist`) -- GitHub has no way to distinguish separate AI sessions
      under one bot account, so this cannot be verified as genuinely independent from the outside.
      The audit body itself reads as a templated/mechanical pass (diff line-count "Scope
      Confirmed", no substantive engagement with the actual severity-high finding's content,
      "Corrective Action Owner: Not required"). Documented honestly rather than re-run a
      duplicate audit against an already-merged PR (no live PR to comment on).

- [x] **Real production log access obtained.** `VERCEL_ACCESS_TOKEN` in this session's env has
      real access to `veridian-compliance-ai` (projexa-ai.com) via `vercel logs`. Confirmed the
      CLI truncates every message field at ~300 chars in both `--json` and `--expand` text modes
      (a real product limitation, verified by checking raw redirected-to-file byte counts -- not a
      tool-display artifact) -- worked around it via `--query`/`--status-code`/`--request-id`
      filters plus code cross-reference rather than needing the full untruncated Postgres error
      text.
- [x] **Real root cause found, superseding the prior circumstantial link to `2cb73100`.** Live
      500 on `GET /api/me` (14:54:04.30 projexa-ai.com) is `Failed query: select ... "host_domain"
      ... from "platform"."product_branches" ... where "productBranches"."branch_key" = ...` --
      traced to `getBranchId()` in `src/lib/services/product-branch-service.ts:26-30`, the shared
      chokepoint for all 5 of `/api/me/route.ts`'s unguarded `isXEnabledForOrg` calls.
      `host_domain` was added by `drizzle/0312_stage1_preauth_brand_host_lookup.sql` (commit
      `d45dbd3b`, OCID-038, 2026-08-04T09:24:34Z) which is absent from
      `drizzle/meta/_journal.json` and whose commit message never confirms a `db:push` run against
      production -- strong evidence the column never landed live. Confirmed broader blast radius:
      the same query pattern fails across `GET /`, `GET /api/conversations`, `GET /api/veri-reward`
      too (the latter two catch it as a non-fatal warning; only `/api/me` 500s, because it's the
      only call site with no try/catch). Could NOT get a direct live-DB schema confirmation this
      cycle (`SUPABASE_ACCESS_TOKEN` returned 401 on the Management API; no `DATABASE_URL` in this
      workspace) -- documented honestly as strong log+code evidence, not certainty.
- [x] Recorded as additive `root_cause_2026_08_04` / `recommendation_2026_08_04` /
      `status_update_2026_08_04` fields on the existing `GAP-API-ME-500-SUBSCRIPTION-PLAN-STATUS`
      entry in `ai-os/MASTER-TRACKER.yaml` (validated with `yaml.safe_load` after edit). No fix
      applied -- status remains `open`, per the standing OCID-021 lock.

- [x] Moved this session's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry from `active:` to
      `recently_completed:` (validated with `yaml.safe_load`).
- [x] Commit + push this cycle's work.

## Remaining
- [ ] Real owner: confirm `platform.product_branches.host_domain` exists live (Supabase SQL
      editor or real `DATABASE_URL` access) and run `bun run db:push` if missing; separately
      regenerate `drizzle/0312` through `drizzle-kit generate` so it's journal-registered; separately
      add try/catch guards around `/api/me/route.ts`'s 5 `isXEnabledForOrg` calls regardless of
      root cause. None of this was attempted here -- discovery only, per the standing OCID-021 lock.
