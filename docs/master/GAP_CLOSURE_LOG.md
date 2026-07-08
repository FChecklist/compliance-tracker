# VERIDIAN AI OS — Gap Closure Log

**Purpose:** the running, append-only record of every finding in [`AUDIT_2026-07-09.md`](AUDIT_2026-07-09.md) / [`CRITICAL_GAPS.md`](CRITICAL_GAPS.md) that has been closed, following this repo's own `orchestra_changes.md` wave-log convention (one entry per fix, what changed, how it was verified). Started 2026-07-09, executed autonomously per Boss instruction ("close all the gaps which you can one by one... whatever will be left, make note of it").

Each entry: **[CRITICAL_GAPS.md # or finding]** — what changed — files — verification — commit.

---

*(entries appended below as gaps close)*

## Batch 1 — 2026-07-09

**[CRITICAL_GAPS #4] Fixed false Razorpay claim on pricing page.** `src/app/pricing/page.tsx`'s FAQ no longer names a payment processor that doesn't exist in the codebase; now says sales sets up billing directly. Verified: `grep -i razorpay` across `src/` now returns zero matches.

**[CRITICAL_GAPS #3] Fixed MCP `create_compliance_item` cross-tenant IDOR.** `src/app/api/mcp/route.ts`'s `create_compliance_item` handler now validates `department_id`/`assigned_to_id` against the caller's own `orgId` before insert (`assertBelongsToOrg`-style inline checks), returning a clear error instead of silently attaching the new item to another org's department/user. Also removed a dead, broken `organisations` lookup (`.select('id').single()` with no `orgId` filter — would fail outright with >1 org in the table, which is now true; it never actually validated anything real).

**[CRITICAL_GAPS #9] Added the 3 missing GLM model pricing rows to `MODEL_PRICING`** (`src/lib/llm-client.ts`) — `z-ai/glm-5.2`, `z-ai/glm-5v-turbo`, `z-ai/glm-5-turbo` (the spot-check found a 3rd variant beyond the 2 the audit agent named). Rates verified live via openrouter.ai's model pages, 2026-07-09. Closes the "AI Dev Team spend silently reports as null/$0" landmine before `AI_TEAM_LOG_SECRET` goes live.

**[CRITICAL_GAPS #8] Closed the Capability Registry staleness gap, both the current backlog and future drift.** New `src/lib/loops/capability-index-freshness-audit.ts` — finds `workerAgents`/`moduleRegistry` rows with no matching `embeddings` row (this is exactly how migration/seed-created rows, e.g. every `tier='global'` agent and every module, silently escaped the existing per-creation indexing hook, which only fires for app-created rows) and indexes them. Wired into the existing daily `/api/internal/loops/run` cron rather than adding a 6th `vercel.json` cron entry — not one of the 15 canonical loops (same reasoning as `instruction-mismatch-audit.ts`). The existing admin-triggered `capability-backfill-service.ts` remains the right tool for a first-time catch-up; this is the recurring half. *Still to do: trigger a first run against production now that this is deployed (see "left for verification" below).*

**[CRITICAL_GAPS, Medium] Closed the middleware allowlist drift permanently, not just the 4 currently-known-missing routes.** New `scripts/generate-protected-routes.mjs` generates `src/lib/protected-routes.generated.ts` directly from the real `src/app/(app)/` directory listing (80 routes as of this run, including the 4 the audit found missing: `/connectors`, `/gst-reconciliation`, `/tds-returns`, `/the-firm-practice`); wired into `predev`/`prebuild` npm scripts so it can never drift out of sync again. `src/middleware.ts` now imports the generated array instead of a hand-maintained one. This was a real, repeated bug (4 separate incidents) — the fix targets the recurrence, not just the current instance.

**[CRITICAL_GAPS, Medium] Fixed all 16 of 16 routes silently downgrading `ServiceError` to a generic 500** (the audit found 16; verified the exact count via a repo-wide sweep comparing catch-block count to `instanceof ServiceError` count per file, confirming no 17th was missed): `compliance`, `tasks`, `notices`, `projects`, `products`, `products/[id]/projects`, `conversations`, `code-change-requests`, `documents/[id]`, `erp/buying/suppliers`, `erp/selling/customers`, `settings/module-rules`, `v1/compliance`, `v1/notices`, `v1/tasks`, `worker-agents` — all GET handlers now correctly return the real status code (403/404/etc.) instead of a blanket 500 when the underlying service throws a `ServiceError`.

**Verification for this batch:** `bun x tsc --noEmit` clean, zero new errors. Repo-wide sweep re-run post-fix confirms zero remaining `ServiceError`-downgrade routes.

## Batch 2 — 2026-07-09 (database/migrations, applied live via Supabase MCP)

**[CRITICAL_GAPS, Medium] Dropped 4 confirmed duplicate indexes** (`idx_client_entities_client_id`, `idx_clients_org_id`, `idx_user_client_access_client_id`, `idx_user_client_access_user_id` — kept the `<table>_<col>_idx`-named twin in each pair) and **added the single highest-leverage performance fix in the audit**: `idx_erp_journal_entries_org_status_posting_date` on `(org_id, status, posting_date)` — every financial report (Trial Balance/P&L/Balance Sheet/Cash Flow) filters on exactly that combination and previously had no supporting index. `drizzle/0115_wave133_...sql`.

**[CRITICAL_GAPS, Medium] `FORCE ROW LEVEL SECURITY` enabled on all 357 of 357 compliance-schema tables** (was 0 of 357) — verified via live query before/after. Zero behavior change today (confirmed `app_runtime` isn't the table owner), closes the fragility gap against a future accidental `ALTER TABLE ... OWNER TO app_runtime`. `drizzle/0116_wave134_...sql`.

**[CRITICAL_GAPS, Medium] Investigated and dropped the orphaned `firm_client_portal_links` table** — confirmed 0 rows, 0 code references anywhere in the repo (grep), 0 migration file. Safe to drop outright, no data loss. `drizzle/0117_wave135_...sql`.

**[CRITICAL_GAPS, Medium] Fixed the migration-numbering collision** — `0101_gst_worker_agents.sql` renamed to `0114_gst_worker_agents.sql` (the file that didn't fit the other `0101` file's wave115-117 construction sequence). Confirmed safe: `drizzle/meta/_journal.json` has no entry referencing either file — this repo's real migration-tracking is Supabase MCP `apply_migration`/`execute_sql`, not drizzle-kit's journal, so renaming carries no re-application risk.

**[Overall Architecture Review] Corrected the stale `product_branches` catalog for `construction`** — `status` was `'planned'` despite PROJEXA's real 15-table/10-service/~55-route backend; corrected to `'building'` (matching `facilities_management`'s already-accurate status — investigated and confirmed FM is in the same state: real backend, no internal management UI yet, so `'building'` is honest for both, not `'live'`). `drizzle/0118_wave136_...sql`.

**Verification for this batch:** `get_advisors(security)` and `get_advisors(performance)` re-run after every change — zero new findings introduced, confirmed the 4 duplicate-index WARNs are gone, confirmed 357/357 tables FORCE-enabled via direct query.

**Explicitly NOT touched this batch (left for the final report, not silently skipped):** the remaining Low-severity Supabase advisory items (8 functions with mutable `search_path`, 3 `SECURITY DEFINER` views feeding an `ai_export_*` pipeline of unknown purpose, `conversation_org_id` executable by `anon`, `hstore` extension in `public`, leaked-password protection toggle, 3 anon-INSERT-`WITH CHECK(true)` policies on public lead-capture tables). Checked one `vector_search_*` function's body before deciding: it uses pgvector's `<=>` operator, and blindly setting `search_path=''` risks silently breaking live vector search if the `vector` extension isn't in the resulting empty search path — this needs a careful per-function check of extension-schema dependencies, not a blind batch ALTER, given it would touch a real customer-facing search feature. Genuinely low-risk today (none of the 8 are `SECURITY DEFINER`, so search-path hijacking's practical impact is limited) but correctly scoped as "needs care," not "AI-automatable in one shot" — noted in the final status report.
