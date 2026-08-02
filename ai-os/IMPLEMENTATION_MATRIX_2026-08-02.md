# VERIDIAN / PROJEXA-AI.COM — 14-Item Real Implementation Matrix (2026-08-02)

**UMR:** `UMR-20260802-104058-25ba` (12-deliverable evidence-based implementation matrix, PM decision, plus a scope extension `UMR-20260802-105532-775a` adding 2 UMR-level verification targets). Master directive: `UMR-20260802-034545-3388`.

**Method note (hard rules applied throughout):** no UMR/task status label (`running`/`completed`/`done`) was used as evidence of anything. Completion was never inferred from governance/Kernel-registration paperwork being complete — product implementation and governance completion are tracked separately per item. Only real, currently-live implementation on this server counts as "production ready"; a written plan, design doc, or a merged-but-broken PR does not count. Findings below were gathered by 5 independent research passes (4 background research agents + one first-hand deep-verification pass on the Kernel item) plus direct commands run against the live server, real repos, and real GitHub API state — not re-derived or summarized from memory for this write-up.

**Recovery note:** this matrix was fully compiled and reported in the originating conversation on 2026-08-02 but was never written to a durable file — it existed only as conversational text. This file recovers it verbatim (same figures, same evidence, same gaps) per `UMR-20260802-111942-8d94`; no research was redone.

---

## Summary table

| # | Deliverable | % Complete | Prod Ready | Blocker | Depends on |
|---|---|---|---|---|---|
| 1 | ERP Modules | ~55-60% | No | PM-platform (PROJEXA) integration gap; SAP-reports evidence lives in a separate DB (see #3) | UMR-20260802-034545-3388 |
| 2 | UI/UX | ~70% | Partial | 6 unbuilt spec'd composer UX items | UMR-20260802-034545-3388 |
| 3 | Reports (incl. SAP-equivalent) | ~46% | No | 43/80 SAP-equivalent reports need extend/build | UMR-20260802-034545-3388 |
| 4 | Prompt Library | ~1% | No | Manual Owner→ChatGPT paste step, unscaled | UMR-20260802-034545-3388 |
| 5 | Web Browser (browser-execution-tiers) | ~75% | Partial | Engines built/tested but not wired into live chat send path; no real-GPU validation | UMR-20260802-034545-3388 |
| 6 | VERI Chat | ~75% | Partial | Task-level chat has no AI-reply generation (only conversation-level does) | UMR-20260802-034545-3388 |
| 7 | VERI (the assistant) | ~65% | Partial | Mother Router migration self-documented incomplete (35 unmigrated call sites) | UMR-20260802-034545-3388 |
| 8 | Multi Tenant | ~75% | Partial | No table-by-table RLS verification; only app-layer test exists | UMR-20260802-034545-3388 |
| 9 | Multi Brand | ~15% | No | Fields exist, zero rendering/DNS/TLS, zero real org adoption | UMR-20260802-034545-3388 |
| 10 | Kernel | ~40% | **No** | PR #697 unmerged; real content conflict since resolved (see item 14) — now awaiting fresh Rule 10 audit | UMR-20260802-054239-4251, UMR-20260802-034545-3388 |
| 11 | End-to-End Testing | ~40% | No | 22 real Playwright specs exist, hit real infra, but **no CI job runs them** | UMR-20260802-034545-3388 |
| 12 | Go Live (PROJEXA-AI.COM) | ~30% | **No** | No Rule 7(e) Owner sign-off on record; 2 Vercel projects both bound to the same domain; still Hobby tier | UMR-20260802-034545-3388 |
| 13 | UMR-20260802-040056-5319 (module/wiring collation) — verification | content ~85% accurate; ~40% production-live | No | PR #692 unmerged, `mergeable: CONFLICTING` — deliverable file absent from `main` | UMR-20260802-034545-3388 |
| 14 | UMR-20260802-054239-4251 (Kernel reconciliation report) — verification | see detail below | No | Same as #10 | UMR-20260802-034545-3388 |

---

## 1. ERP Modules — ~55-60%
**Evidence**: `schema.ts` (11,466 lines): 51 `erp_*` tables, 9 `crm_*`, 19 `construction_*`. 25 `erp-*-service.ts` files, 5 `crm-*`, 16 `construction-*`. `erp-enablement-service.ts`'s `requireErpEnabled()` gates 30 service files (real PR #282). Fixed-assets has full UI+API+migration (`drizzle/0218_wave_b_fixed_assets_disposal_status.sql`).
**Remaining gap**: PM-platform (PROJEXA) doesn't consume compliance-tracker's ERP engines (`ai-os/MASTER-TRACKER.yaml` OPEN-08, 8-item list still open). Gate Pass tracking, 3-tier Divisions, UOM master table, cost-center fields on `erp_purchase_requisitions`, multi-state GST array, Debit Notes as a distinct document type: all confirmed missing via direct grep. SAP-reports: not locatable as source files in compliance-tracker — resolved as a false alarm by item 3 below (tracked in a separate DB, not in-repo).
**Production ready**: No. **Blocker**: PM-platform integration gap (real, open, unscoped).

## 2. UI/UX — ~70%
**Evidence**: `AppSidebar.tsx` (699 lines), `AppTopbar.tsx` (212 lines) — live-verified via authenticated click-through (30 screenshots) against `veridian-compliance-ai.vercel.app`. `VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md` §3.1-3.6 scored item-by-item: 2/11 fully built, 2/11 already-correct, 6/11 not built, 1/11 built differently than spec'd.
**Remaining gap**: sidebar→composer sync, overlay/backdrop, breadcrumb reposition, per-segment ×, external-AI handoff link, resizable composer — 6 concrete unbuilt items. `IntentCommandPalette.tsx` exists but trigger (`/` or `Tab`) unverified live.
**Production ready**: Partial — core app is production-live; VERI Chat composer redesign is not spec-complete.

## 3. Reports (incl. SAP-equivalent) — ~46%
**Evidence**: `/opt/veridian/ai-os/memory/sap_mapping.sqlite`'s `sap_reports` table, real per-row status: **37 REUSE_EXISTING, 29 EXTEND_EXISTING, 14 BUILD_NEW** (80 total, real DB query, not a doc claim). `report-catalog-service.ts` (395 lines, 32 real `id:` entries) cross-references `erp-financial-report-service.ts`, `construction-reports-service.ts`, `custom-report-service.ts`, `ai-performance-report-service.ts`. `report-engine-service.ts` is 1790 lines, real.
**Remaining gap**: 43/80 reports need real extend/build work. This DB is the authoritative SAP-reports evidence — resolves item 1's "could not verify" flag; SAP-reports mapping is tracked here, not as in-repo source files.
**Production ready**: No (partial — the REUSE_EXISTING subset is production-real; the rest is not).

## 4. Prompt Library — ~1%
**Evidence**: Infrastructure 100% real and functional (schema, guard scripts, coverage/duplicate-detection tooling, 15-folder sandbox — claude-control PR #45/#73). Content: `/opt/veridian/chatgpt-prompt-library/CSV/` has **1 file, 1 data row**. Latest real coverage report: `total_real_prompts: 1`, `target_total_prompts: 10000`, `prompt_coverage_pct: 0.01`.
**Remaining gap**: 9,999 of 10,000 target prompts; requires ~42 manual Owner ChatGPT-paste cycles per the doc's own math. `MASTER_INDEX.yaml` self-labels status `infrastructure_100pct_ready_generation_blocked_on_owner_supplied_openai_api_key`.
**Production ready**: No. **Blocker**: Owner-dependent manual step, not a code gap.

## 5. Web Browser (browser-execution-tiers) — ~75%
**Evidence**: 12 real files under `src/lib/browser-execution/` (npu-engine.ts, builtin-ai-engine.ts, cross-tier-storage.ts, sync-engine.ts, tier-orchestrator.ts, webllm-engine.ts, transformers-engine.ts, worker-pool.ts, model-cache.ts, tool-calling.ts, client-compile.ts, tier-detection.ts) + 12 matching test files. **108/108 tests passing** (ran directly, `bun test src/lib/browser-execution/`). Merged via commit `695d77ce` (PR #616), preceded by PR #586/#590. `client-compile.ts` genuinely imported into `VeriComposer.tsx` (line 29).
**Remaining gap**: NPU/WebLLM/Transformers engines built+tested but NOT wired into the live chat send path (only the "compile" first-pass tier is live); no real-GPU/NPU smoke test possible in this sandbox.
**Production ready**: Partial.

## 6. VERI Chat — ~75%
**Evidence**: Real end-to-end path confirmed: `src/app/api/conversations/[id]/messages/route.ts` → `chat-service.ts` (1269 lines) → `orchestra-model-resolver.ts` (607 lines) → `llm-client.ts` (real `fetch` calls to `openrouter.ai`/`api.anthropic.com`, grep-confirmed). Composer: `VeriComposer.tsx` (764 lines), `ChainSelector.tsx`, `veri-chat-context.tsx`, `HomeThreadSlot.tsx`.
**Remaining gap**: `src/app/api/tasks/[id]/chat/route.ts` (47 lines) only inserts a user row into `taskChatMessages` — no LLM call in that handler. Task-level chat has no assistant-reply generation, unlike conversation-level chat. Same 6 unbuilt composer UX items as item 2.
**Production ready**: Yes for conversation-based VERI Chat (real LLM round-trip verified); No for the task-chat sub-path.

## 7. VERI (the assistant) — ~65%
**Evidence**: `src/lib/ai-team/roster.ts` (659 lines, ~30-role org chart, OpenRouter-routed), `orchestra-model-resolver.ts` used by `chat-service`'s `resolveModelConfig(orgId, "user_assistant_oa")`, `src/lib/ai-router/mother-router.ts` (666 lines, AIROUTER-01 registry/policy/audit layer). Deterministic pre-LLM gates exist (`llm-routing-gate.ts`, `ai-reply-gate.ts`).
**Remaining gap**: Mother Router's own 2026-07-20 re-verification found **35 files still calling the old resolution path directly**, self-documented as "NOT migrated this pass." Software Team L0-L5 dispatch's real task-execution success rate was not verified in this pass (out of scope/time).
**Production ready**: Partially — the core conversational path is real and live; the broader orchestration layer is self-documented as incompletely unified.

## 8. Multi Tenant — ~75%
**Evidence**: `tenant-scoped.ts`'s `withTenantContext()` (commit `c2eca637`) sets real Postgres GUCs via `set_config()` under a dedicated `app_runtime` role (not the RLS-bypassing `postgres` role); called in 49/51 service files. RLS enabled on 64+ tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, plus 22 migration files with dynamic per-migration loops). `tenant-isolation.test.ts` (253 lines) exercises real service functions. Real bug caught and documented in that test file's own history: `SET LOCAL x = $1` (invalid Postgres syntax) had silently no-op'd tenant scoping until fixed with `set_config()`.
**Remaining gap**: No table-by-table RLS correctness verification exists — only an app-layer test. PROJEXA itself has essentially no tenant isolation of its own; depends entirely on the compliance-tracker API bridge.
**Production ready**: Partial — real mechanism, live, actively used; not fully audited end-to-end.

## 9. Multi Brand — ~15%
**Evidence**: `drizzle/0221_wave_b_white_label_branding.sql` adds 5 real columns to `organisations` (`brand_primary_color`, `brand_accent_color`, `favicon_url`, `custom_domain`, `email_sender_name`), backed by `org-branding-service.ts` and `BrandingSection.tsx` admin UI.
**Remaining gap**: all columns NULL on every existing org (zero adoption, verified live). DNS verification, TLS provisioning, host-header routing explicitly not implemented per the migration's own header. Zero usages of these fields outside the service/settings form — nothing renders per-org theming today. No `brandId`/white-label logic anywhere in `projexa`. ("VAIOS Layer 1-4" from prior tracking is unrelated — a backend architecture decision, not a brand feature; correcting that prior mislabel.)
**Production ready**: No.

## 10. Kernel — ~40%
**Evidence**: Substantive governance decisions made and correctly evidenced (Conflict 1: Kernel registered as peer to `CONSTITUTION.yaml`, not supreme over it; Conflict 2: 3 real state-machine vocabularies stay as-is, Kernel's 11-state list is a conceptual mapping only). Real, verifiable basis: an extended Owner-PM (Claude Desktop) conversation on 2026-08-02 — a prior claim that a live tmux `AskUserQuestion` exchange constituted the confirmation was retracted as false (see item 14).
**Remaining gap**: confirmed via `git show origin/main:ai-os/MASTER_INDEX.yaml` — **the Kernel registry entry does not exist on `main` at all**; it lives only in PR #697's branch. OCID (Owner Chat ID) genuinely unsupplied. `ai-os/OWNER_DIRECTIVES/PROTOCOL_OWNER_AI.yaml` dangling reference (cited by `MASTER_INDEX.yaml`, does not exist on disk) unresolved.
**Production ready**: **No.** Zero live production presence despite real decision work being done — the clearest governance-paperwork-vs-real-implementation divergence in this matrix.

## 11. End-to-End Testing — ~40%
**Evidence**: 22 real Playwright specs in `projexa/e2e/` (`01-materials.spec.ts` … `12-member-access.spec.ts` + several more), targeting `https://projexa-ai.com` for real; `auth.setup.ts` logs in via the real login form with real seeded users (not mocked), saves Supabase session cookies. Commit `1dceb4e`.
**Remaining gap**: `.github/workflows/ci.yml` has only `lint`/`typecheck`/`build` jobs — **no e2e job at all**. These 22 specs never run in CI on any PR, only on manual invocation. No recent full-suite run on record.
**Production ready**: No. "Rigorous live E2E testing gate" from prior tracking is confirmed still accurate.

## 12. Go Live (PROJEXA-AI.COM) — ~30%
**Evidence**: `curl -I https://projexa-ai.com` → live `HTTP/2 200`, real Vercel/Next.js traffic.
**Remaining gap**: still Vercel **Hobby tier** (`billing.plan=="hobby"`, per live census in `MASTER_INDEX.yaml`). **Two separate Vercel projects** (`veridian-compliance-ai` and `projexa`) are both bound to the same `projexa-ai.com` apex domain simultaneously — a real, unresolved production collision. No record anywhere in `ai-os/` that `compliance-tracker/AGENTS.md` Rule 7(e)'s required explicit Owner go-live confirmation was ever given — the site appears to have gone live incrementally through ordinary wave-by-wave PR merges, not a deliberate, confirmed go-live event.
**Production ready**: **No.** Most urgent finding in this matrix, independent of percentage — the domain collision is a live production risk, not just an incompleteness gap.

## 13. UMR-20260802-040056-5319 (module/wiring collation) — verification
**Content accuracy**: ~85% (7 of 8 independently re-checked claims held up under normal organic drift; the 8th — "104 registries" — was already stale same-day, real count is 123).
**Evidence checked directly, not re-derived**: `wiring_registry` count 7,918 claimed → 7,961 live (organic growth, consistent). The false "Policy Engine shares_implementation_with gateway-G01" claim re-confirmed still false today (`grep -n OWNER_DECISIONS_NEEDED src/lib/policy-enforcement-engine.ts` = 0 hits). UTM-scope claim (SQLite-only, not Postgres) confirmed via case-sensitive grep (0 hits in `src/`/`drizzle/`). `module_registry` table + `module-registry-service.ts` byte-size match confirmed. `DATABASE_CATALOG` table count exact match (442).
**Real production-live status: ~40%, not higher** — the original closure of this UMR (as `completed`) cited "real commits landed" (`e2c589df`, `bde27e44`) but never checked whether the carrying PR actually merged. It has not: **PR #692 is still OPEN, `mergeable: CONFLICTING`**, never merged to `origin/main`. `git show origin/main:ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` → file does not exist on `main`. The real `umr_tasks` row's `reason` field has since been corrected in place to disclose this (2026-08-02, this session) — status stays `completed` (the task's own work is genuinely done) but is now flagged as not-yet-live.
**Production ready**: No. **Blocker**: PR #692 unmerged, conflicting.

## 14. UMR-20260802-054239-4251 (Kernel reconciliation report) — verification
Went through the reconciliation report's own citations claim-by-claim against live server state today:
- ✅ `umr_tasks` CHECK constraint values — exact match (direct DB query).
- ✅ `veridian-task.py`'s `cmd_checkpoint()` `pending_review` gate — personally triggered this exact guardrail live earlier this session (stronger evidence than a grep).
- ✅ `AGENTS.md` "Super Boss" entry, `CONSTITUTION.yaml` `SOLE_AUTHORITY` status / `related_ops_infrastructure.note` line 143 — confirmed real.
- ⚠️ `dispatch_core.py` line-number citations (73-87, 90-108) are stale — functions exist but moved to lines 187/203/215, likely due to this session's own PR #13 restoration work.
- ❌ **Real inaccuracy found**: Section 2c claims "both original scripts are still present, unmodified" (`queue-dispatcher.py`, `module-queue-dispatcher.py`) as of 2026-08-02. Both were actually renamed `.superseded-by-consolidation-2026-07-27`, real file mtime `Jul 27 02:34` — **six days before** the report's claim that they were still open. Confirmed no git history tracks these files at all (untracked live-server rename, not a committed code change).
- ✅ Re-confirmed (direct `git show origin/main`): the Kernel registry entry exists in **zero** places on `main` — neither `MASTER_INDEX.yaml` nor `OS.yaml`.

**Since this verification, real remediation has occurred** (per PM decision `UMR-20260802-111028-67b9`): PR #697's real merge conflict (`PROGRESS.md`, root cause: shared append-only log drift since branch fork) was resolved via rebase, all 5 original commits preserved intact (`c2f90ff2`'s content verified byte-identical post-rebase), all 16 real code-quality CI checks now pass. `mergeStateStatus` moved from `DIRTY` to `BLOCKED` (not yet `CLEAN` — pending a fresh Rule 10 audit-check verdict on the new commit, which is the expected next gate, not a regression).
**Production ready**: No. **Blocker**: same as item 10 — awaiting fresh Rule 10 audit + merge.

---

## Two most urgent findings, independent of percentage complete

1. **Item 12 (Go Live)**: two live Vercel projects bound to the same production domain simultaneously. This is a real, present production risk, not an incompleteness gap — worth Owner/PM attention regardless of where it ranks by percentage.
2. **Item 11 (E2E Testing)**: 22 real, non-mocked Playwright tests exist and hit real production infrastructure, but provide **zero actual regression protection today** because no CI job runs them on any PR.
