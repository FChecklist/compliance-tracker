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
| 10 | Kernel | ~85% | Yes | None remaining beyond OCID (open, not invented) and the dangling `PROTOCOL_OWNER_AI.yaml` cross-repo reference (see item 14) | UMR-20260802-054239-4251, UMR-20260802-034545-3388 |
| 11 | End-to-End Testing | ~40% | No | 22 real Playwright specs exist, hit real infra, but **no CI job runs them** | UMR-20260802-034545-3388 |
| 12 | Go Live (PROJEXA-AI.COM) | ~30% | No | No Rule 7(e) Owner sign-off on record; still Hobby tier. Real Owner decision 2026-08-02 (UMR-20260802-134939-145d) reverted projexa-ai.com/www.projexa-ai.com back to the Wave 10 state (served by veridian-compliance-ai), undoing an undocumented 2026-07-27 reversal — real, live-verified (Vercel API + curl + page-body check), logged in ai-os/boss/COMPLETED.yaml (PR #720) | UMR-20260802-034545-3388, UMR-20260802-123246-f2e7, UMR-20260802-124023-371b |
| 13 | UMR-20260802-040056-5319 (module/wiring collation) — verification | content ~85% accurate; ~40% production-live | No | PR #692 unmerged, `mergeable: CONFLICTING` — deliverable file absent from `main` | UMR-20260802-034545-3388 |
| 14 | UMR-20260802-054239-4251 (Kernel reconciliation report) — verification | see detail below | Yes | PR #697 genuinely merged (`99c2255f`) after a real independent review — see item 10 | UMR-20260802-034545-3388 |

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

## 10. Kernel — ~85%
**CORRECTION (2026-08-02, real independent audit finding on this same PR, task-20260802-124913's review.json, verdict reject/tier1)**: this item originally claimed PR #697 was unmerged and the Kernel registry entry didn't exist on `main` — both were true when first written but stale by the time this file was committed. Real, fresh check: `gh pr view 697` → **`state: MERGED`, `mergedAt: 2026-08-02T12:27:05Z`, merge commit `99c2255f82e7a9e1961f4b5410a22e482913775e`**. That merge commit is the direct parent of this very matrix file's own first commit (`52dc624d`) — the PR's own base already contains it. The `veridian_kernel_1_0` registry entry is confirmed live in `ai-os/MASTER_INDEX.yaml` on `main` today.
**Evidence**: Substantive governance decisions made and correctly evidenced (Conflict 1: Kernel registered as peer to `CONSTITUTION.yaml`, not supreme over it; Conflict 2: 3 real state-machine vocabularies stay as-is, Kernel's 11-state list is a conceptual mapping only). Real, verifiable basis: an extended Owner-PM (Claude Desktop) conversation on 2026-08-02 — a prior claim that a live tmux `AskUserQuestion` exchange constituted the confirmation was retracted as false (see item 14). PR #697 genuinely merged after a real independent supervisor review (verdict `approve`, tier1) — not self-certified.
**Remaining gap**: OCID (Owner Chat ID) genuinely unsupplied — still open, not invented. `ai-os/OWNER_DIRECTIVES/PROTOCOL_OWNER_AI.yaml` — this was previously flagged as a dangling reference (cited by `MASTER_INDEX.yaml`, "does not exist on disk"), but that check was scoped to the compliance-tracker repo only; the file genuinely exists at the live-server path `/opt/veridian/ai-os/OWNER_DIRECTIVES/PROTOCOL_OWNER_AI.yaml` — a cross-repo location mismatch, not a missing file. `MASTER_INDEX.yaml`'s citation should be corrected to reflect the real location (separate, small follow-up, not yet done).
**Production ready**: Yes. Real, live, on `main`, independently audited and merged — not just decided.

## 11. End-to-End Testing — ~40%
**Evidence**: 22 real Playwright specs in `projexa/e2e/` (`01-materials.spec.ts` … `12-member-access.spec.ts` + several more), targeting `https://projexa-ai.com` for real; `auth.setup.ts` logs in via the real login form with real seeded users (not mocked), saves Supabase session cookies. Commit `1dceb4e`.
**Remaining gap**: `.github/workflows/ci.yml` has only `lint`/`typecheck`/`build` jobs — **no e2e job at all**. These 22 specs never run in CI on any PR, only on manual invocation. No recent full-suite run on record.
**Production ready**: No. "Rigorous live E2E testing gate" from prior tracking is confirmed still accurate.

## 12. Go Live (PROJEXA-AI.COM) — ~30%
**Evidence**: `curl -I https://projexa-ai.com` → live `HTTP/2 200`, real Vercel/Next.js traffic.
**Remaining gap**: still Vercel **Hobby tier** (`billing.plan=="hobby"`, per live census in `MASTER_INDEX.yaml`). No record anywhere in `ai-os/` that `compliance-tracker/AGENTS.md` Rule 7(e)'s required explicit Owner go-live confirmation was ever given — the site appears to have gone live incrementally through ordinary wave-by-wave PR merges, not a deliberate, confirmed go-live event.
**Production ready**: No (Hobby tier, no Rule 7(e) confirmation on record).

**CORRECTION (2026-08-02, per UMR-20260802-123246-f2e7, cited under UMR-20260802-124023-371b)**: this entry originally claimed "two separate Vercel projects (`veridian-compliance-ai` and `projexa`) are both bound to the same `projexa-ai.com` apex domain simultaneously" as an active production risk. That claim was sourced from `MASTER_INDEX.yaml`'s `vercel.projects` census, timestamped **2026-07-26T10:33:37Z**, which genuinely was real and confirmed *at that time* ("this is real current Vercel domain-assignment state, not a data-entry error in this census" — its own words). It was never re-verified against live state before being reported in this matrix — a real staleness gap in that finding, not a fabrication.

**Re-verified live, 2026-08-02T12:35 UTC** (`GET /v9/projects`, `GET /v9/projects/{id}/domains` against all 3 real projects, team-scoped confirmed — only one team exists; plus DNS + live `curl`): **no domain collision exists now.** `projexa-ai.com` / `www.projexa-ai.com` are bound *exclusively* to the `projexa` project. `veridian-compliance-ai`'s real domains are `veridian-aios.com`, `veridian-ai-os.vercel.app`, `veridian-compliance-ai.vercel.app` — no `projexa-ai.com` reference. DNS resolves cleanly to real Vercel anycast IPs, single answer, no split. The 07-26 collision was real and has since been resolved (`veridian-compliance-ai` moved to its own `veridian-aios.com` domain) — consistent with the known 2026-07-27/28 domain-misconfiguration incident history. **No fix was made or needed** — investigation-only, real current state already correct.

**REAL OWNER DECISION, 2026-08-02T13:50 UTC (`UMR-20260802-134939-145d`)**: the "no longer real" state above was itself an *undocumented* reversal of Wave 10's original, deliberate cutover (`ai-os/boss/completed-work/wave10-dns-cutover.md`) — the domain was meant to be served by `veridian-compliance-ai`, not standalone `projexa`. Real Owner decision: revert back to the Wave 10 state. Executed via the real Vercel API (`DELETE /v9/projects/projexa/domains/{domain}` then `POST /v10/projects/veridian-compliance-ai/domains`, both HTTP 200 for apex + `www`). **Verified live, not narrated**: `GET /v9/projects/veridian-compliance-ai/domains/projexa-ai.com` and the `www` variant both → HTTP 200, `projectId=prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII` (veridian-compliance-ai); `projexa`'s own real remaining domains are now only `['projexa-smoky.vercel.app']`; `curl -I` on both domains → real `HTTP/2 200`; real page body fetched and parsed — `<title>VERIDIAN COGNITIVE AI OS`, "THE FIRM"/"VERIDIAN" present, "PROJEXA" absent. Logged in `ai-os/boss/COMPLETED.yaml` (`WAVE-10-REDO` entry, PR #720), closing the exact documentation gap that let the original reversal go unrecorded. Nothing deleted — the `projexa` Vercel project and GitHub repo are untouched beyond the domain detach.

**Production ready (updated)**: domain-architecture question resolved by real Owner decision and executed; still No overall — Hobby tier and no Rule 7(e) sign-off remain real, open gaps.

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
- ✅ At the time this check ran (before merge), the Kernel registry entry existed in zero places on `main`. **Now stale — see the update below.**

**Since this verification, real remediation has occurred and completed.** PR #697's real merge conflict (`PROGRESS.md`, root cause: shared append-only log drift since branch fork) was resolved via rebase (per PM decision `UMR-20260802-111028-67b9`), all 5 original commits preserved intact (`c2f90ff2`'s content verified byte-identical post-rebase). A second real issue was then found and fixed the same way: a follow-up commit (the KERNEL_AMENDMENT documentation, `UMR-20260802-113654-271b`) landed on the same branch and forced a fresh, unrelated audit cycle — split out to its own PR #717 (per `UMR-20260802-121158-d557`) so #697 could merge on its own already-audited state. A real, independent supervisor review then ran (not self-certified) and posted `AUDIT: PASS` (2026-08-02T13:41:36Z-window); PR #697 **genuinely merged**: `mergedAt: 2026-08-02T12:27:05Z`, merge commit `99c2255f82e7a9e1961f4b5410a22e482913775e`, confirmed via `gh pr view 697` and `git show origin/main` (the Kernel registry entry now IS present on `main`).
**Production ready**: Yes, as of the real merge above. **Remaining**: OCID and the `PROTOCOL_OWNER_AI.yaml` cross-repo citation mismatch (see item 10) — both minor, both open, neither invented.

---

## Amendment (2026-08-02): PR-to-UMR mapping + real-vs-governance classification, 6 real merges tonight

Per Owner directive `UMR-20260802-163301-8416` (OCID-20260802-013), amending this same canonical
artifact, inheriting the parent's status — no new implementation, no new audit, no new file.
Parent: `UMR-20260802-104058-25ba`. `resource_governor.py --query-umr` does not index by PR URL
(it searches original dispatch intent text); each mapping below was traced through this session's
own real dispatch chain and independently cross-checked against `umr_tasks`'s real
`task_identity`/`status` fields directly (not trusted from narration).

**Hard rule applied**: `umr_tasks.status` reads `running` for nearly every real row below —
already-established this session as an unreliable label (see multiple corrections earlier
tonight) and **not used as evidence of anything** here. Only real commit hashes, real merge
timestamps, and real file paths count.

| PR | Real merge commit / mergedAt | Mapped UMR(s) | Real `task_identity` | Real vs Governance |
|---|---|---|---|---|
| #716 (compliance-tracker) | `9c56349c` / 2026-08-02T14:19:42Z | `UMR-20260802-104058-25ba` (+scope ext. `105532-775a`) | `owner-task-20260802-104056-3017000` | **Governance-only.** New markdown report (`IMPLEMENTATION_MATRIX_2026-08-02.md`) + 2 registry entries (`MASTER_INDEX.yaml`/`OS.yaml`). Zero application code. |
| #717 (compliance-tracker) | `2a390fa2` / 2026-08-02T14:00:13Z | `UMR-20260802-113654-271b` (dispatched via `121158-d557`) | `owner-task-20260802-113652-3211579` (121158-d557's own row: `owner-task-20260802-121157-3322231`, real `status: rejected_duplicate`) | **Governance-only.** A markdown amendment-log entry (KERNEL_AMENDMENT text + an unbuilt implementation plan). Explicitly "instruction and plan only" by its own text — zero code changed. |
| #14 (veridian-scripts) | `09c58799` / 2026-08-02T15:07:14Z | `UMR-20260802-074346-a9b9` (+ `090702-c813`) | `owner-task-20260802-074345-2429352` | **Real product implementation.** `dispatch-tick.py`: real Python functions (`find_stuck_tasks`, `write_stuck_tasks_heartbeat`, `pm_triage_tick`, a real cooldown gate fixing an independent-audit-found bug), 46 real passing test assertions (`test_pm_triage.py`), deployed to the live operational script `/opt/veridian/scripts/dispatch-tick.py` and already observed running in production (`"cooldown active (12.0min of 60.0min)"`, real tick output). |
| #122 (claude-control) | `90f09d74` / 2026-08-02T15:56:18Z | `UMR-20260802-080051-6e48` (+ `083104-5987`, `154546-ceb6`) | `owner-task-20260802-080050-2492112` (real `status: completed`) | **Governance-only.** 9 registry entries appended to `ai-os/MASTER_INDEX.yaml`. Zero application code. |
| #692 (compliance-tracker) | `9edb6ed4` / 2026-08-02T15:34:16Z | `UMR-20260802-040056-5319` | `owner-task-20260802-040054-1672871` (real `status: completed`) | **Governance-only.** New reference doc (`EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`) + a real `ACTIVE-CLAIMS.yaml` structural-corruption fix (governance-integrity repair, not product code) + `PROGRESS.md`. Zero application code. |
| #720 (compliance-tracker) | `993beb69` / 2026-08-02T15:40:22Z | `UMR-20260802-123246-f2e7` (+ `124023-371b`, `134939-145d`) | `owner-task-20260802-123245-3387895` | **Governance-only PR, documenting a real separate infrastructure action.** The PR itself is a `COMPLETED.yaml` log entry — no code. But it documents a genuinely real, independently-verified live change: `projexa-ai.com`/`www.projexa-ai.com` reassigned from the `projexa` Vercel project to `veridian-compliance-ai` via the real Vercel API (`DELETE`/`POST`, both real HTTP 200), re-verified live (`GET /v9/projects/.../domains` → 200, real `curl` + page-body check: title `VERIDIAN COGNITIVE AI OS`, "PROJEXA" absent). That real action is infrastructure, not a PR diff — the PR is its paper trail, not its implementation. |

**Summary, stated plainly per the Owner's explicit instruction not to blur this**: of the 6 real
merges tonight, **1 (PR #14) is real product/infrastructure-code implementation**; the other 5
(#716, #717, #122, #692, #720) are governance/documentation artifacts — reports, registry entries,
an amendment log, a governance-file integrity fix, and a completion-log entry. #720 additionally
documents a real, separately-verified live infrastructure change (the domain cutover), but that
change's own reality rests on the Vercel API verification evidence cited above, not on the PR's
own diff.

**Dependency / evidence / traceability status, all 6**: none had an unmet real dependency at merge
time — each was independently re-verified `mergeable: MERGEABLE` with a real posted `AUDIT: PASS`
comment (not a CI badge, not a narrated claim) matching its real final head commit before merging,
per the same-session closure-checklist protocol (`UMR-20260802-124713-c38d`). Each traces to a real
`owner-task-*` dispatch row in `umr_tasks`, confirmed by direct query above, not asserted.

**Canonical artifact**: `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` (this file) — amended in place,
not rewritten, not duplicated. Status inherited from parent `UMR-20260802-104058-25ba`.

---

## Two most urgent findings, independent of percentage complete

1. ~~**Item 12 (Go Live)**: two live Vercel projects bound to the same production domain simultaneously.~~ **RETRACTED 2026-08-02** (UMR-20260802-123246-f2e7): re-verified live against the real Vercel API + DNS + `curl` — no domain collision exists currently. The underlying 2026-07-26 census this was based on was real at the time but had already been resolved by 2026-08-02; the matrix cited it without a fresh live check. See item 12's own entry for full detail.
2. **Item 11 (E2E Testing)**: 22 real, non-mocked Playwright tests exist and hit real production infrastructure, but provide **zero actual regression protection today** because no CI job runs them on any PR. This is now the single most urgent finding in this matrix.

---

## Amendment (2026-08-02): Master Execution Framework — design only, not dispatched

Per Owner directive `UMR-20260802-164801-2ab9` (OCID-20260802-015), amending both parent UMRs
`UMR-20260802-054239-4251` and `UMR-20260802-104058-25ba`, inheriting their status. **Design
only** — nothing below has been dispatched, implemented, or acted on. No new database, table,
repository, module, or architecture created; this uses only real, already-existing artifacts
(this matrix, `ai-os/MASTER-TRACKER.yaml`, `ai-os/CONSTITUTION.yaml`, real repo state) as its
evidence base.

### Real correction found while building this design

Item 1 (ERP Modules)'s "Remaining gap" cites "PM-platform (PROJEXA) doesn't consume
compliance-tracker's ERP engines (`ai-os/MASTER-TRACKER.yaml` OPEN-08, 8-item list still open)"
— **this is stale.** Direct re-check of `OPEN-08` in `ai-os/MASTER-TRACKER.yaml` (name field
literally reads `"...CLOSED 2026-07-14 (items 1-6 of the corrected list)"`, full `status_update`
confirms **5 real PRs merged across 2 repos** — compliance-tracker#290/#292/#293, projexa#4/#5 —
each independently audited before merge, per the Owner's own explicit "Priority 13" directive.
The real remaining ERP gap is narrower than item 1 currently states: Gate Pass tracking, 3-tier
Divisions, UOM master table, cost-center fields on `erp_purchase_requisitions`, multi-state GST
array, Debit Notes as a distinct document type — 6 named items, not an open PM-platform
integration gap. Not corrected in item 1's own text in this pass (out of scope for a design
document) — flagged here for a future amendment.

### Real current-state summary (evidence: this file's own 14 items + the correction above)

12 product streams at real, verified completion: ERP ~55-60% (corrected scope above), UI/UX 70%,
Reports 46%, Prompt Library 1%, Web Browser 75%, VERI Chat 75%, VERI Assistant 65%, Multi Tenant
75%, Multi Brand 15%, Kernel 85% (merged), E2E Testing 40%, Go Live 30%. Plus 2 real infrastructure
findings from tonight's closure-checklist work (`UMR-20260802-124633-ad05`/`152716-6f73`): (a) at
least one task's own `task.yaml` carried stale `repo:`/`branch:` fields that broke the real
supervisor's PR-resolution and caused 2 spurious `AUDIT: FAIL` comments on an unrelated PR before
being found and fixed — real scope of how many *other* tasks carry the same latent bug is
currently unknown; (b) an oversized (6766+ line) diff proved unreliable for the real automated
review pipeline, worked around by splitting into a minimal diff — a real, load-bearing pattern for
any future large reconciliation.

### Execution stream list

Each stream: single purpose, single scope, single canonical artifact, single traceability path,
parent UMR cited. "Deterministic/close-ended" = yes only if the real remaining work is a named,
bounded list, not an open-ended exploration.

| Stream | Purpose | Real scope (bounded) | Canonical artifact | Deterministic/close-ended | Parent UMR |
|---|---|---|---|---|---|
| **A. Reports completion** | Close the 43 remaining SAP-equivalent reports | 29 EXTEND_EXISTING + 14 BUILD_NEW, named rows in `sap_mapping.sqlite` | `sap_mapping.sqlite` + item 3 of this matrix | Yes | `104058-25ba` |
| **B. Prompt Library completion** | Reach the 10,000-prompt target | 9,999 real prompts remain, ~42 manual Owner-driven ChatGPT-paste cycles | `chatgpt-prompt-library/CSV/` + item 4 | **No** — real external human bottleneck (Owner-dependent manual step), not AI-executable end to end | `104058-25ba` |
| **C. E2E CI-gate wiring** | Make the 22 real Playwright specs run on every PR | Add one CI job to `projexa/.github/workflows/ci.yml` | `projexa/.github/workflows/ci.yml` + item 11 | Yes | `104058-25ba` |
| **D. Multi-tenant RLS table-by-table verification** | Prove RLS coverage beyond the current app-layer test | Build a real DB-level cross-org leak test against existing tenant-scoped tables | `src/lib/services/tenant-isolation.test.ts` + item 8 | Yes, if scoped to *existing* tables only | `104058-25ba` |
| **E. Multi-brand real build-out** | Make stored brand fields actually render + real domain routing | Hostname-to-brand resolution for anon pages, DNS/TLS custom-domain routing — real scope not yet fully defined | `org-branding-service.ts` + item 9 | **No** — needs its own scoping pass before it can be called close-ended | `104058-25ba` |
| **F. Web Browser engine live-wiring** | Connect built+tested NPU/WebLLM/Transformers engines into the real chat send path | Wire `tier-orchestrator.ts` into `VeriComposer.tsx`'s send handler | `src/lib/browser-execution/*` + item 5 | Yes | `104058-25ba` |
| **G. VERI Chat task-level AI-reply** | Give `/api/tasks/[id]/chat` the same real LLM generation `/api/conversations/[id]/messages` already has | One route, one real gap, named | `src/app/api/tasks/[id]/chat/route.ts` + item 6 | Yes | `104058-25ba` |
| **H. VERI Assistant Mother Router migration** | Finish migrating the 35 self-documented unmigrated call sites | 35 named files (per Mother Router's own 2026-07-20 re-verification) | `src/lib/ai-router/mother-router.ts` + item 7 | Yes | `104058-25ba` |
| **I. UI/UX composer completion** | Build the 6 remaining spec'd composer UX items | sidebar-composer sync, overlay/backdrop, breadcrumb reposition, per-segment ×, external-AI handoff link, resizable composer | `VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md` + item 2 | Yes | `104058-25ba` |
| **J. Go-Live readiness** | Get PROJEXA-AI.COM to a real, governed go-live state | Vercel Hobby→Pro/Team tier upgrade (real spend decision) + `AGENTS.md` Rule 7(e) explicit Owner sign-off | item 12 | **No** — both real remaining actions are Owner-only, not AI-executable | `104058-25ba` |
| **K1. Kernel doc-citation fix** | Correct `MASTER_INDEX.yaml`'s `PROTOCOL_OWNER_AI.yaml` citation to its real cross-repo location | One field, already diagnosed (found live at `/opt/veridian/ai-os/OWNER_DIRECTIVES/`, not in compliance-tracker) | `ai-os/MASTER_INDEX.yaml` + item 10 | Yes | `054239-4251` |
| **K2. OCID supply** | Owner supplies the Kernel's own required `OWNER_CHAT=(OCID)` value | One value | Kernel reconciliation report + item 10 | **No** — Owner-only action | `054239-4251` |
| **L. Server-artifact traceability register** | Real UMR-to-artifact / artifact-to-UMR mapping, orphans, duplicates | In progress this same session (`UMR-20260802-164659-9a31`) | This matrix + `MASTER_INDEX.yaml` | Partially — explicitly incremental by its own directive | `054239-4251` + `104058-25ba` |
| **M. Task-dispatch pipeline reliability hardening** | Find and fix other tasks carrying the same stale `repo:`/`branch:` field bug found tonight | Real scope currently unknown — needs a discovery pass across real `task.yaml` files before it can be called close-ended | `ai-os/tasks/*/task.yaml` | **No** — needs its own scoping pass first | `054239-4251` |
| **N. ERP remaining gaps** | Close the 6 real, narrower ERP gaps (corrected scope above) | Gate Pass, 3-tier Divisions, UOM master, cost-center fields, multi-state GST, Debit Notes | `src/lib/db/schema.ts` + item 1 | Yes | `104058-25ba` |

### Real overlaps found, flagged not resolved (design only)

- **F and I both touch `src/components/veri-chat/VeriComposer.tsx`** — real file-level collision
  risk if dispatched in parallel. Recommend sequencing, not parallel dispatch.
- **H (Mother Router migration) may include `G`'s own target route** (`/api/tasks/[id]/chat`)
  among its 35 unmigrated sites — not yet verified which specific 35 files are named. Recommend
  checking for overlap before dispatching G and H in parallel.
- **N (ERP schema additions) should logically precede D (RLS verification)** if D is meant to
  cover the new fields N adds — otherwise D's real coverage is incomplete by construction.

No other real overlaps found between the 14 streams above; each targets a distinct, named file or
file-set.

### Proposed stream execution order (design only, not dispatched)

1. **Phase 1 — foundational, low-risk**: C (E2E CI gate), K1 (doc-citation fix), L (traceability
   register — already in progress).
2. **Phase 2 — bounded, independent product gaps**: A (Reports), G (VERI Chat task-reply), N (ERP
   remaining 6 items).
3. **Phase 3 — needs sequencing due to real file overlap**: F then I (both touch
   `VeriComposer.tsx`); verify G/H overlap before dispatching H.
4. **Phase 4 — needs a scoping pass before execution**: M (pipeline reliability discovery), E
   (Multi-brand scoping), D (RLS verification, ideally after Phase 2's schema work).
5. **Phase 5 — Owner-gated, not AI-executable**: J (Go-Live: Vercel tier + Rule 7(e) sign-off), K2
   (OCID), and B (Prompt Library, bounded by the real manual-paste bottleneck, not by AI capacity).

### Relation to existing UMRs, audits, and implementations

Every stream above maps to a real, already-existing item in this matrix (items 1-14) or the Kernel
reconciliation report — no new work area was invented for this design. Streams C, F, G, H, I, K1,
N are genuinely close-ended and could be dispatched as real, bounded UMRs today, each inheriting
`104058-25ba` or `054239-4251` as parent, per this file's own established amendment convention.
Streams B, E, J, K2, M are explicitly **not yet dispatchable as close-ended work** — each needs
either a real Owner decision/action, or a further scoping pass, before it would meet this design's
own "deterministic and close-ended" bar. This distinction is the deliverable's central honest
finding: not every real gap in this matrix is currently AI-executable end to end.

**Not acted on.** No stream above has been dispatched, implemented, or given a new UMR. Awaiting
Owner review per explicit instruction.

---

## Amendment (2026-08-02): Standing gatekeeper rule (`UMR-20260802-165034-5747`)

Amends `UMR-20260802-054239-4251` and `UMR-20260802-104058-25ba`, inheriting their status. This is
a **standing rule**, not a one-off task — no new implementation or audit was created for this
directive itself.

**Rule, effective immediately for all future work from this session:** before starting any new
work, run a real gatekeeper check against real server state — existing implementation, existing
GitHub PR, existing CI/audit run, existing running worker/supervisor (`systemctl --user list-units
'veridian-worker@*' 'veridian-supervisor@*'`), existing task (`ai-os/tasks/*/task.yaml`), existing
UMR (`resource_governor.py --query-umr`), existing canonical artifact, existing wiring/metadata. If
found: extend/update it, never rebuild or duplicate. If genuinely blocked: report the real root
cause, never guess. If evidence needed to decide is missing: stop and report, never assume.

**Demonstrated application (real, this session, this exact turn):** before writing this section,
ran the check against its own action —
```
gh pr list --repo raajatagarwal/compliance-tracker --state open \
  --search "master-execution-framework in:title,body"   →  []  (none open)
systemctl --user list-units 'veridian-worker@*' 'veridian-supervisor@*' --state=running
  → only task-20260802-163326 (the PR-to-UMR mapping worker, already known, not a duplicate)
grep -rl "165034-5747|master-execution-framework|gatekeeper" ai-os/tasks/*/task.yaml → none
```
**Gatekeeper decision: ALLOWED — no existing implementation, PR, worker, or task found for this
specific work; proceeding is not a duplication.** This same check-before-act sequence is the
pattern to repeat for every future task, and is now the documented standing procedure rather than
an ad hoc habit — it was already being followed inconsistently throughout tonight's session (see
the repeated `ACTIVE-CLAIMS.yaml`-read and `resource_governor.py --query-umr` checks in the PR-to-
UMR mapping amendment above); this section makes it an explicit, citable rule going forward.

---

## Amendment (2026-08-02): Unified project memory model (`UMR-20260802-165434-cd91`)

Amends `UMR-20260802-054239-4251` and `UMR-20260802-104058-25ba`, inheriting their status. No new
database, repository, or memory system was created for this — this section documents which real,
already-existing files already serve as canonical state and formalizes the read/write flow between
them; it consolidates the model, not the files themselves (no file merge was needed — each real
file already has a distinct, non-overlapping role, verified below).

**Real discovery (evidence: this session's own repeated use of each, plus direct inspection):**

| Real file/table | Real role | Read by | Written by |
|---|---|---|---|
| `umr_tasks` table (`ai-os/memory/superboss-register.sqlite`, queried via `resource_governor.py --query-umr`) | **The single decision log** — one row per UMR, `task_identity`, `status` (`queued/dispatched/running/completed/failed/rejected_duplicate/sigterm_sent/killed`), `metadata_json.reuse_check_result.intent_text` | any AI instance, via `resource_governor.py --query-umr --search/--task-identity` | `resource_governor.py --submit`/`--tick`, and PM-side UMR issuance |
| `ai-os/tasks/<task_id>/task.yaml` | **The single per-task state + checkpoint log** — `status`, `repo:`/`branch:`, `checkpoints:` list (`veridian-task.py checkpoint`) | `dispatch-tick.py`, `check_latest_task.py`, any session picking up a task | `veridian-task.py adopt/checkpoint`, dispatch/supervisor scripts |
| `STUCK_TASKS_HEARTBEAT.json` | **The single point-in-time liveness snapshot** across all tasks (by design, not cumulative — see `dispatch-tick.py:553`) | `pm_triage_tick()`, any session checking real current stuck-task count | `dispatch-tick.py`'s `write_stuck_tasks_heartbeat()`, every real tick (10-min systemd timer, confirmed: `veridian-cron-dispatch-tick.timer`, `OnUnitActiveSec=10min`) |
| `ai-os/MASTER_INDEX.yaml` (compliance-tracker AND claude-control AND live-server, 3 real distinct files) | **The single per-repo governance-file cross-reference index** — what other tracking docs exist and what they're for | any session starting work in that repo (`CLAUDE.md` Rule 3) | whichever PR touches that repo's governance surface |
| `ai-os/boss/ACTIVE-CLAIMS.yaml` | **The single real-time in-flight-work registry** — prevents duplicate concurrent work across parallel sessions | every session, **before** picking a task (`CLAUDE.md`/`AGENTS.md` Rule 11, mandatory) | every session, on claiming a task |
| `ai-os/boss/COMPLETED.yaml` | **The single closed-work log** | any session verifying whether something already shipped | doer + auditor, on real completion (Rule 7d) |
| `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` (this file) | **The single canonical product-completion state + amendment trail** | PM and this session, every status question | this session, via amendment (never rewrite) |

**Verified: these are already the single canonical place for each concern — not scattered
duplicates.** The one real overlap found is intentional, not redundant: 3 separate
`MASTER_INDEX.yaml` files exist because they index 3 separate real repos (compliance-tracker,
claude-control, live-server `/opt/veridian/ai-os/`) — each is the sole index for its own repo, not
a copy of another. No consolidation action is needed or was taken; this section is the
documentation of the model, per the directive's own instruction to use what already exists.

**The real read/write flow, going forward, for any AI instance (present or future) with no prior
session memory:**
1. Read `ai-os/boss/ACTIVE-CLAIMS.yaml` first (what's in flight).
2. Query `umr_tasks` via `resource_governor.py --query-umr` for the specific UMR/task_identity (the
   decision log — what was decided and why).
3. Read the relevant `ai-os/tasks/<task_id>/task.yaml` for that task's real current status and
   checkpoint history.
4. Read `STUCK_TASKS_HEARTBEAT.json` for real current liveness if triaging stuck work.
5. Read this matrix (`IMPLEMENTATION_MATRIX_2026-08-02.md`) for real current product-completion
   state and prior amendment history.
6. Read `ai-os/boss/COMPLETED.yaml` to confirm whether the specific deliverable already shipped.
7. Write back only to the one file matching the concern (never invent a parallel file) — task
   state to `task.yaml` via `veridian-task.py checkpoint`, decisions to `umr_tasks` via
   `resource_governor.py --submit`, product-completion state to this matrix via amendment,
   completed work to `COMPLETED.yaml`.

This closes the "any one chat/session remembering things on its own" dependency described in the
directive: every one of these 7 files is real, on-disk, server-side, and readable by a fresh
session with zero prior context — which is exactly how the discovery agents behind the traceability
register (`UMR-20260802-164659-9a31`, findings above) were run and how this very turn picked up
mid-task after a context compaction.

---

## Amendment (2026-08-02): Recovery matrix (`UMR-20260802-165541-c27d`)

Amends `UMR-20260802-054239-4251` and `UMR-20260802-104058-25ba`, inheriting their status. Real,
directly-verified current behavior only — no new architecture proposed except where a genuine gap
is named below.

| Real failure class | Real current detection | Real current recovery | Resumes from checkpoint or restarts? | Status |
|---|---|---|---|---|
| Worker process failing | `systemd` `Restart=on-failure`, `RestartSec=30` on `veridian-worker@.service` (verified: `systemctl --user cat`); `check_latest_task.py` also auto-`systemctl start`s a stalled task if `active_count==0` and `status!='completed'` | Restarts the same unit; work resumes from `task.yaml`'s own `checkpoints:` list (`veridian-task.py checkpoint`, verified real field + writer) | **Resumes from checkpoint** | Handled |
| Supervisor process failing | `Restart=no` on `veridian-supervisor@.service` (verified: `systemctl --user cat`) | **None automatic** — a failed supervisor run does not self-restart | N/A | **Real gap** — no automatic recovery; today's workaround (used repeatedly this session) is manual re-trigger via `systemctl --user start veridian-supervisor@<task_id>.service` after archiving a stale `review.json` |
| tmux session itself failing | No dedicated detector found | The real 10-min `veridian-cron-dispatch-tick.timer` (`OnUnitActiveSec=10min`, confirmed active) is independent of any tmux session — it is systemd-scheduled, not tmux-scheduled | Dispatch/triage continues regardless of tmux state | Handled (by architecture — tmux is not actually load-bearing for the real dispatch cadence) |
| Claude Desktop (laptop) session disconnecting | N/A — by explicit design (`AGENTS.md` "Contact" section, 2026-07-31 Owner directive, quoted verbatim: "laptop can be closed, still the server and claude code cli will keep working") | Server-side dispatch/supervisor/governor loops are fully independent of the laptop | Continues uninterrupted | Handled by design |
| CI failing | GitHub Actions status on the PR (`gh pr checks`) | Established this-session workaround: real empty `git commit --allow-empty -m "chore: re-trigger"` forces a fresh CI run against true head — used repeatedly tonight (PR #716/#692/#14) | Resumes at CI level; underlying commits are untouched | Handled (manual trigger, not automatic) |
| PR failing (real posted `AUDIT: FAIL`) | Real posted GitHub PR comment, `.body startswith("AUDIT:")`, matched against current head SHA | Fix exactly what the real comment named, push, re-trigger supervisor — established 6-point protocol (`UMR-20260802-124713-c38d`) | Resumes from the existing branch/commits, no restart from scratch | Handled |
| Task failing (`status=failed`/`sigterm_sent`/`killed` in `umr_tasks`) | `resource_governor.py`'s stuck-task protocol: "timeout → SIGTERM → grace period → SIGKILL" (verified, `resource_governor.py:78`); `find_stuck_tasks()` in `dispatch-tick.py` | `pm_triage_tick()` surfaces it to `PM_TRIAGE_ALERTS.md` (cooldown-gated, this session's own PR #14 fix); `--reconcile-stale`/`--scan-stuck` flags exist on `resource_governor.py` for reconciliation | Task's own `checkpoints:` list preserved; new attempt can reference it, not blind restart | Handled |
| Real network failure (GitHub/gh API) | Hard subprocess timeout (`GH_PR_CHECK_TIMEOUT_SECONDS`, default 8s) on every `gh` call in the duplicate-PR guard (verified, `resource_governor.py:809-830`, real quoted source) | **Explicit, documented fail-OPEN**: "returns 'no duplicate found' and logs to ATTENTION.md... must never degrade to 'queue permanently wedged'" — a deliberate, named tradeoff, not an oversight | Dispatch proceeds; no work lost, but the duplicate-guard is temporarily weaker | Handled, with an explicitly accepted tradeoff (documented, not a silent gap) |

**Honest gap summary:** 7 of 8 real failure classes have a real, verified, existing recovery
mechanism (worker restart+checkpoint resume, PR-fail fix-and-retry, task SIGTERM/reconcile,
network fail-open, tmux-independent cadence, laptop-independent architecture, CI manual re-
trigger). **1 real gap found**: supervisor-process failure has no automatic restart
(`Restart=no`) and no automatic detection distinct from a human/session noticing a stale/missing
`review.json` — today's only recovery path is the manual `systemctl --user start
veridian-supervisor@<task_id>.service` re-trigger this session has used repeatedly. Per the
directive's own instruction, this is named as a real gap, not silently patched with new
architecture in this pass — a minimal fix (mirroring `veridian-worker@.service`'s own
`Restart=on-failure`/`RestartSec=30`) would close it but was not applied here, since this
directive was explicitly scoped to detection/verification, not new implementation.

**Hard rule confirmed already in force, not newly added:** none of the mechanisms above spin up a
duplicate worker/task/PR/audit as a side effect — `check_latest_task.py` only restarts the *same*
unit for the *same* `latest` task id; `resource_governor.py`'s own duplicate-PR guard (item above)
exists specifically to prevent exactly this class of duplication.

---

## Amendment (2026-08-02): Server-wide artifact traceability register — first tranche (`UMR-20260802-164659-9a31`, OCID-20260802-016)

Amends `UMR-20260802-054239-4251` and `UMR-20260802-104058-25ba`, inheriting their status.
Explicitly incremental per the directive's own permission ("work it incrementally and report
real progress rather than rushing an incomplete claim"). This tranche consolidates 4 real,
independent discovery passes completed this session into the one canonical artifact, rather than
leaving the findings scattered across agent transcripts.

**Real coverage this tranche: 381 top-level files across 4 zones**, each covered completely (not
sampled): `/opt/veridian/scripts/*.py,*.sh` (104), compliance-tracker `ai-os/` top-level (50),
claude-control `ai-os/` top-level (76), live-server `/opt/veridian/ai-os/` top-level + veda-
advisors/projexa `ai-os/` (151).

### Aggregate findings

| Zone | Files | Have a real UMR ref | No mapping possible (pre-dates UMR system) | Genuine orphans flagged | Genuine duplicates flagged |
|---|---|---|---|---|---|
| `/opt/veridian/scripts/` | 104 | 7 (+1 traceable via commit history) | 96 | 0 (all 14 zero-cross-ref candidates had clear self-documented purpose) | 1 pair: `anthropic_openrouter_proxy.py` (v1, zero refs) vs `_v2.py` (live-wired, systemd) |
| compliance-tracker `ai-os/` | 50 | 6 | 44 | 0 (all referenced in `OS.yaml`/`MASTER_INDEX.yaml`) | 0 confirmed; 1 soft flag (`STATUS-REPORT.md` vs `MASTER-TRACKER.yaml`, not self-marked stale) |
| claude-control `ai-os/` | 76 | 1 (`MASTER_INDEX.yaml`) | 75 | 0 | 1 pair: `METADATA_ENGINE_RECONCILIATION_2026-07-24.yaml` vs `METADATA_KNOWLEDGE_ENGINE_RECONCILIATION_2026-07-24.yaml` (same phase/day/objective, different tasks, genuinely overlapping) |
| live-server `ai-os/` + veda-advisors/projexa | 151 | 8 | ~90 (bootstrap-only history) | 8: `CORE_KERNEL_31_CONTRACT_MERGED_ANALYSIS_2026-07-30.md`, `OWNER_ENGINE_31_CONTRACT_FRAMEWORK_ANALYSIS_2026-07-30.md`, `HANDOFF_2026-07-30_LAPTOP_SESSION.md`, `LIVE_SCRIPT_CLOBBERING_INVESTIGATION_2026-07-30.md`, `OWNER_STANDING_DIRECTIVE_FULL_AUTONOMY_2026-07-31.md`, `.credit_accountant_disabled`, `umr_tasks.db`, `superboss_register.sqlite3` | ~39 `.gitignore`-policy-excluded backup/superseded files (expected, by design — `*.bak*`/`*.pre-*`/`*.superseded*`/`*.lock`/`*.sqlite*` are deliberately untracked); 3 pairs flagged real content-differing duplicates: `STRATEGIC_PLAN_2026-07-21.yaml` vs `_v2.yaml`, `PENDING_OWNER_REVIEW.md` vs `_2026-07-28.md`, and the `superboss-register.sqlite` vs `superboss_register.sqlite3` naming-inconsistency stray (latter has zero references anywhere) |
| **Total** | **381** | **22** | **~305** | **8 hard orphans + 5 `.superseded-by-INS-*` orphans-in-place** | **3 genuine pairs** |

### Real structural finding, not a per-file anomaly

**94% of files with no UMR mapping (305/324) is not a coverage gap in this register — it is
because those files chronologically predate the UMR-YYYYMMDD-HHMMSS-hex tracking convention.**
Verified independently in 3 of 4 zones: earliest UMR string found anywhere in compliance-tracker's
own `ai-os/` content is `UMR-20260801-175205-de64` (2026-08-01); claude-control's `ai-os/` content
is dated 2026-07-23 through 2026-07-27 with zero UMR strings in any commit message across full
history; live-server files split similarly (2026-07-20 through 2026-07-31, bootstrap commit only).
Inventing a mapping for these would violate the directive's own explicit instruction ("never
invent a new one") — they are correctly left unmapped, not silently forced onto a nearby UMR.

### Genuine orphans (13 total, real, no owner/purpose/mapping found)

Live-server zone: `CORE_KERNEL_31_CONTRACT_MERGED_ANALYSIS_2026-07-30.md`,
`OWNER_ENGINE_31_CONTRACT_FRAMEWORK_ANALYSIS_2026-07-30.md` (possible near-duplicate pair of each
other), `HANDOFF_2026-07-30_LAPTOP_SESSION.md`, `LIVE_SCRIPT_CLOBBERING_INVESTIGATION_2026-07-30.md`,
`OWNER_STANDING_DIRECTIVE_FULL_AUTONOMY_2026-07-31.md`, `.credit_accountant_disabled`,
`umr_tasks.db` (0 refs anywhere despite the UMR-suggestive name), `superboss_register.sqlite3`
(0 refs, likely a naming-inconsistency stray of the real `superboss-register.sqlite`). Plus 5
`.superseded-by-INS-*` remnant files with no active counterpart present at their directory level
(`completion_of_pending_tasks.md`, `completion_of_projexa_ai_com.md`, `standing_execution_directive.md`,
`two_engine_task.md`, `uncomplicate_unduplicate_task.md`).

### Genuine duplicates (3 pairs, real content overlap, not self-marked stale)

1. `anthropic_openrouter_proxy.py` (v1, 0 refs) vs `anthropic_openrouter_proxy_v2.py` (live-wired
   to `veridian-glm-proxy.service`) — v1 is dead weight.
2. `METADATA_ENGINE_RECONCILIATION_2026-07-24.yaml` vs `METADATA_KNOWLEDGE_ENGINE_RECONCILIATION_2026-07-24.yaml`
   (claude-control) — same phase, same day, same core objective, produced by 2 different tasks 6
   minutes apart.
3. `STRATEGIC_PLAN_2026-07-21.yaml` vs `_v2.yaml`, and `PENDING_OWNER_REVIEW.md` vs
   `_2026-07-28.md` (live-server) — confirmed to genuinely differ in content, not `.bak`-pattern
   self-backups; naming-convention cleanup candidates, not accidental duplication.

No fixes applied in this pass — flagging only, per the directive's own scope (discovery/
classification, not remediation).

### Honest remaining scope (not yet covered — named, not silently skipped)

This tranche covered 4 top-level zones only. Real, named zones still outstanding for a future
tranche: subdirectories within each repo's `ai-os/` tree (compliance-tracker: `boss/`, `sentinel/`,
`registry/`, `audit-tree/`, `system-tree/`, `tree4-unified/`, `engines/`; claude-control:
`dependency-cruiser/`, `eslint/`, `guardrail-findings/`, `openapi/`, `pgaudit/`, `promptfoo/`,
`reports/`, `schemas/`, `testing_engine_evidence/`, `wiring_engine_evidence/`,
`workflow-transitions/`; live-server: `audit198/` (51 files), `logs/` (55), `memory/` (32),
`pending_remediation/` (166), `OWNER_DIRECTIVES/` (9), `reference/` (14), `scripts/` (22),
`catalogs/`, `generated/`, `patches/`, `planning/`, `queues/`, `session_metadata/`). **Explicitly
out of scope for this register**: `/opt/veridian/ai-os/tasks/` (899 real task directories) — each
task's own `task.yaml` is already the canonical per-task state per the unified memory model
amendment above; re-registering 899 individual task dirs here would duplicate that model, not
extend it.

Canonical artifact updated: this file (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`), same
amendment convention as PR #723/#725 — not rewritten, not duplicated.
## Amendment (2026-08-02): Unified project memory model — DB-layer refinement + real open gap (`OCID-20260802-018`)

Per Owner directive OCID-20260802-018, amending both parent UMRs `UMR-20260802-054239-4251` and
`UMR-20260802-104058-25ba`, inheriting their status. **No new implementation or audit created for
this directive itself** — this refines the prior `Unified project memory model` amendment above
(`UMR-20260802-165434-cd91`, merged PR #725) with a deeper real-DB discovery pass that pass did not
run, and names one real, still-open gap. No new database, table, repository, or file was created;
nothing was rebuilt or duplicated — per the standing gatekeeper rule (`UMR-20260802-165034-5747`,
this same file) this extends the existing model in place.

**Gatekeeper check run before this pass (per the standing rule above):** grepped this file and
`ai-os/boss/ACTIVE-CLAIMS.yaml` for this exact directive/OCID — no prior implementation found for
*this* directive. The closely-related `UMR-20260802-165434-cd91` amendment above already exists and
was extended, not rebuilt, consistent with the rule.

### Real gap in the prior pass, found by direct inspection

The prior amendment's 7-file table treated `ai-os/memory/superboss-register.sqlite` as effectively
one row (`umr_tasks`, the decision log). Direct inspection of the same live DB
(`/opt/veridian/ai-os/memory/superboss-register.sqlite`, the real path per `superboss-register.py:63`'s
`DB_PATH`/`SUPERBOSS_REGISTER_DB`) found it contains several other real, live, actively-written
tables directly relevant to the directive's own named concerns ("a single dependency graph," "a
single findings record," "a single evidence trail") that the prior pass never queried:

| Real table (same DB) | Row count (2026-08-02, this session) | Real role | Answers which directive concern |
|---|---|---|---|
| `audit_findings` | 16,672 | Real, structured audit-finding ledger (domain/standard/clause/artifact/severity/status/producer/repo/run_id) fed by `audit_runs` (164 rows) and rolled up in `audit_master_reports` (2 rows) | **The single findings record** — more concrete/queryable than any markdown doc |
| `wiring_registry` | 7,987 | Code-level entity-relationship graph (engine/gateway/table/function/route/file/script/cron_job/ai_role), mechanically generated from 8 live sources per `MASTER_INDEX.yaml`'s own `search_layers_relationship.wiring_registry` field (line 60-63 of that file) — "never hand-authored" | **The single dependency graph** |
| `knowledge_engine` | 376 | Searchable, hash-verified (`content_hash`, `verification_status`) machine index of real artifacts (e.g. `MASTER_INDEX.yaml` registry entries), actively written same-day (last row `2026-08-02T08:37:07Z`) | **The single evidence trail** (machine drift-detection layer under the human-narrative docs) |
| `system_index` | 135 | Fast existence-check layer ("does X already exist before I build it") | Supports "single project state" — the check-before-build gate `MASTER_INDEX.yaml`'s own top-level `protocol` field requires |
| `task_claims` | 43 | Atomic `UNIQUE(task_key)` lease table, real fix for a documented 2026-07-31 duplicate-dispatch incident (`superboss-register.py:1976-2040`, direct source read) | **Verified NOT a scattered duplicate** of `ai-os/boss/ACTIVE-CLAIMS.yaml` — different layer: mechanical race-condition lock at task-creation time (hard DB constraint) vs. cooperative, human-narrative, cross-session semantic registry. Confirmed complementary by reading both mechanisms' real source/protocol, not assumed. |
| `conversation_memory` / `plans` / `learning_reflections` | 1 / 1 / 5 | Schema exists and is real, but every row is stale 2026-07-24 demo/test fixture data (`session_id: 'conv-phase6-test-1'`, `org_id: 'org-demo'`, `actor_ref: 'user-42'`) | **Real, honest gap, not silently glossed over**: this part of the schema is architecture-exists-but-unused — not yet a live "project memory" for real work sessions, consistent with the pattern already named in `[[country-config-architecture-state]]`-class findings elsewhere in this codebase's own history. Not fixed here — out of this directive's scope (discovery/consolidation of what's real, not new build-out). |

**All 4 of the first-listed tables (`audit_findings`, `wiring_registry`, `knowledge_engine`,
`system_index`) are already explicitly documented as complementary, non-competing layers in
`ai-os/MASTER_INDEX.yaml`'s own `search_layers_relationship` block (lines 46-80 of that file, dated
2026-07-30)** — this amendment's real contribution is cross-referencing that existing, authoritative
self-documentation into the *project-memory* model (this file), which had not cited it, rather than
discovering something genuinely new. Confirms the directive's own framing: consolidate what already
exists into the canonical place, don't reinvent.

### Real, currently-open gap found: `MASTER_INDEX.yaml` live-vs-repo drift

`MASTER_INDEX.yaml`'s own header (`known_open_gap_this_note_does_not_fix`, dated 2026-07-30) already
disclosed this as an open, deliberately-deferred gap ("full reconciliation explicitly out of this
pass's scope... neither is a strict subset of the other"). Re-verified live, today, with the real
existing tool built for exactly this (`system-sync.py`, no new tooling written):

```
$ python3 /opt/veridian/scripts/system-sync.py --dry-run --check mirror
[mirror_drift_check] 3 finding(s), 0 auto-fixed (staged, not committed)
  - DRIFTED (live != mirror content): dispatch-tick.py
  - DRIFTED (live != mirror content): test_pm_triage.py
  - DRIFTED: MASTER_INDEX.yaml (live != repo mirror)
```

Real registry counts, this session (`/opt/veridian/ai-os/MASTER_INDEX.yaml` = live/canonical vs. this
repo's `ai-os/MASTER_INDEX.yaml` = repo mirror): **live 123 registries, repo 59, only 54 overlap** —
the gap has *grown*, not shrunk, since the 2026-07-30 note (97 vs 50 at that time). Real repo-only
entries missing from the live copy include this session's own recent work
(`implementation_matrix_2026_08_02`, `veridian_kernel_1_0`) — i.e. the live "canonical" index is
currently missing record of real, already-merged product/governance work. Most live-only entries are
legitimately live-server-scoped infrastructure registrations (scripts under `/opt/veridian/scripts/`
not mirrored into this repo by design), consistent with the existing note's own caveat.

**Deliberately not fixed in this pass** — this repeats, not overrides, the same judgment call the
2026-07-30 pass already made for the identical reason (neither file is a strict subset; a blind merge
risks real data loss on both sides). Naming it here, with fresh evidence, is this directive's own
explicit instruction ("if evidence needed to decide is missing: stop and report, never assume" —
`UMR-20260802-165034-5747`'s gatekeeper rule) — a full, careful field-by-field reconciliation of
`MASTER_INDEX.yaml` (live vs. repo) is real, scoped, close-ended follow-up work, not yet dispatched.

### Refined answer to the directive's own questions

- **Single project state**: `ai-os/MASTER_INDEX.yaml` (governance/artifact index) + `system_index`
  table (existence-check layer) — real, but **currently drifted** between live and repo copies (gap
  above), the one concrete way "project state" is *not* fully single today.
- **Single decision log**: `umr_tasks` table (985 real rows) — confirmed, unchanged from prior pass.
- **Single traceability path**: this matrix's own PR-to-UMR mapping section above + `task.yaml`
  checkpoints + `umr_tasks` — confirmed, unchanged.
- **Single dependency graph**: `wiring_registry` table (7,987 rows) — **newly named this pass**; the
  prior amendment did not identify this table at all.
- **Single findings record**: `audit_findings` table (16,672 rows) — **newly named this pass**; the
  prior amendment cited only markdown-level findings (this matrix's own items), not the real
  structured ledger underneath.
- **Single evidence trail**: `knowledge_engine` table (376 rows, content-hash + verification-status
  per artifact) — **newly named this pass**, sharpens the prior amendment's file-level-only view.

**Read/write flow, updated**: identical to the prior amendment's 7-step flow, with steps 2 and 5
widened — step 2 ("query `umr_tasks`") now explicitly includes querying `wiring_registry` for
call-graph questions and `audit_findings`/`knowledge_engine` for evidence/verification questions,
per `MASTER_INDEX.yaml`'s own documented `read_order_for_a_new_reader` (its lines 77-80) — this
amendment aligns the project-memory model with that file's pre-existing, authoritative read order
rather than defining a competing one.

**Canonical artifact**: this same file, `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` — amended in
place, not rewritten, not duplicated. Status inherited from both parent UMRs
(`UMR-20260802-054239-4251`, `UMR-20260802-104058-25ba`).

---

## Amendment (2026-08-02): PM decision — OCID-015/017/018/019 CLOSED, PR #711 no action, next-step scopes opened

PM answer to this session's queued question, independently checked rather than left for the
session to resolve alone. Real evidence: **PR #725 genuinely merged**, `mergedAt
2026-08-02T17:02:41Z`, merge commit `d3d88751c1eacae062dfd45dfa2d8010b1381582`, verified via a
fresh git clone showing the real 387-line canonical matrix file (this file, pre-this-amendment)
including all four amendment sections above in full, real, substantive detail (Master Execution
Framework design, standing gatekeeper rule, unified project memory model, recovery matrix).

**Closed on that evidence:**

| OCID | UMR | Section (this file) | Status |
|---|---|---|---|
| OCID-20260802-015 | `UMR-20260802-164801-2ab9` | Master Execution Framework — design only | **CLOSED** |
| OCID-20260802-017 | `UMR-20260802-165034-5747` | Standing gatekeeper rule | **CLOSED** |
| OCID-20260802-018 | `UMR-20260802-165434-cd91` | Unified project memory model | **CLOSED** |
| OCID-20260802-019 | `UMR-20260802-165541-c27d` | Recovery matrix | **CLOSED** |

**PR #711 (UI/UX click-through scope): no action.** Real current state — open, mergeable, no fresh
`AUDIT:` comment posted, only Vercel rate-limit notices on the check run. Left as-is; that scope
already stands on real evidence gathered earlier and does not need re-verification right now.

**Next-step scopes opened, this same session, per the PM's explicit instruction** (real capacity
permitting, given the swap-pressure constraint already flagged elsewhere in this session's own
work): (a) **OCID-20260802-020** (`UMR-20260802-165606-4413`) — begin the bounded, properly-scoped
extension already proposed: test projexa-ai.com's own authenticated screens on its separate
Supabase project, real browser testing, real screenshots, real reproduction paths for any gap
found. (b) **OCID-20260802-016 continuation** (`UMR-20260802-164659-9a31`) — the still-open
server-wide artifact traceability scan, beyond the first tranche PR #723/#726 already covered.
Both scopes registered in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting, per the standing
gatekeeper rule above. Findings for both appended as their own amendments below once real work
completes this session.

Canonical artifact updated: this file — not rewritten, not duplicated.

---

## Amendment (2026-08-02): Server-wide artifact traceability register — tranche 2 (`UMR-20260802-164659-9a31`, OCID-20260802-016)

Continuation of the first tranche above. Scoped this pass to this repo (compliance-tracker)
only, given real session capacity — the "honest remaining scope" list from tranche 1 named
`ai-os/boss/`, `sentinel/`, `registry/`, `audit-tree/`, `system-tree/`, `tree4-unified/`,
`engines/` as still-outstanding compliance-tracker subdirectories; claude-control and
live-server's outstanding subdirectories remain unstarted (named, not silently skipped).

**Real coverage this tranche: 51 files across the 7 named subdirectories** (`find <dir> -type f`,
each dir enumerated individually after a Bash-tool output-truncation artifact was caught mid-scan
on the combined multi-dir listing — worked around by scanning one directory at a time).

### Findings

**Zero new orphans, zero new genuine duplicates.** Every top-level file in `boss/`, `sentinel/`,
`registry/`, `engines/` is directly referenced by path in `OS.yaml`/`MASTER_INDEX.yaml` (7/7/5/1
refs respectively, spot-checked via grep). `audit-tree/`, `system-tree/`, `tree4-unified/`'s
numbered per-file trees (e.g. `audit-tree/01-consutitution.yaml` through `10-merged-tree.yaml`)
show 0 individual-filename hits in `OS.yaml` at first grep — but `OS.yaml`'s own
`what_should_exist_vs_what_does` section indexes these **at directory level by explicit,
documented convention** ("Tree 1 -- what the 9 source requirement documents say...", "Tree 3 --
what's actually built...", "Tree 1 + Tree 3 merge...") — confirmed not orphaned, just indexed one
level up rather than per-file. `audit-tree/source-documents/` (docx source material) and
`boss/completed-work/` (snip-integration + wave9/10 reports) are both real, referenced
(`MASTER_INDEX.yaml` cites `boss/completed-work/snip-integration/04-verification-report.md`
directly as a `verification_mechanism`).

**Already-correctly-archived, not re-flagged:** `audit-tree/archive/GAPS.yaml` already carries the
exact quarantine banner and is listed in `registry/stale-doc-manifest.yaml`'s `already_archived`
section — confirmed still true, not re-flagged as a fresh finding.

**One topical-overlap check performed, not a duplicate:** `tree4-unified/archive-30-gap-backlog.yaml`
(192 lines, Tree4's own gap backlog derived from the Tree1-vs-Tree3 comparison) and
`audit-tree/archive/GAPS.yaml` (364 lines, Tree1's own master gap list) both track "open gaps" —
read both headers: these are two different, sequential stages of the same documented multi-tree
methodology (Tree 1 requirements → Tree 3 system-as-built → Tree 4 comparison/backlog), not
independent duplicate effort. Not flagged as a genuine duplicate pair.

**UMR-mapping coverage not separately re-tallied this tranche** — tranche 1's own structural
finding (94% of pre-`UMR-YYYYMMDD-HHMMSS-hex`-convention files have no mapping by design, not by
gap) applies identically here; every file in this tranche's scope predates 2026-08-01.

### Honest remaining scope (still not covered)

claude-control's `dependency-cruiser/`, `eslint/`, `guardrail-findings/`, `openapi/`, `pgaudit/`,
`promptfoo/`, `reports/`, `schemas/`, `testing_engine_evidence/`, `wiring_engine_evidence/`,
`workflow-transitions/`; live-server's `audit198/` (51 files), `logs/` (55), `memory/` (32),
`pending_remediation/` (166), `OWNER_DIRECTIVES/` (9), `reference/` (14), `scripts/` (22),
`catalogs/`, `generated/`, `patches/`, `planning/`, `queues/`, `session_metadata/` — all named in
tranche 1, none started yet. This tranche deliberately scoped to compliance-tracker only, given
real session capacity — the host-level `/opt/veridian/ai-os/` and `/opt/veridian/repos/claude-control`
trees are both reachable from this workspace and were not a hard blocker, just out of scope for
this pass.

Canonical artifact updated: this file — not rewritten, not duplicated.

---

## Amendment (2026-08-02): `UMR-20260802-165606-4413` — Compliance Register crash fix (Finding A closed), CRM/ERP 403 UX gap tracked separately (Finding B)

Amends parent `UMR-20260802-104058-25ba`. Source: `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md`'s
Findings A/B/C (real end-user certification pass on `projexa-ai.com`, real fresh self-signup org
"OCID-020 Redo Certification Test Org", user `82af2932-57f4-42b0-b51c-fa6d54f13c4f`).

### Finding A — fixed, this PR

Real, reproducible client-side crash on the Compliance Register (`/compliance`) and Pendency View
(`/compliance?status=overdue`), root-caused to a real `HTTP 500` on `GET /api/departments`.

**Real root cause** (confirmed by direct reproduction against the real Supabase Postgres DB, RLS
enforced, for both the real fresh self-signup org above and an older seeded org — identical
failure both times, proving this was never RLS- or tenant-context-specific): `src/lib/db/schema.ts`
defines two distinct FK relation pairs between `departments` and `users`
(`head`/`headOfDept` via `departments.headId`, and the department-membership pair via
`users.departmentId`), but only the `head`/`headOfDept` pair had an explicit `relationName`.
Drizzle's relational query builder requires every relation pair between two tables to be named
once more than one pair exists; the unnamed membership pair made `with: { users: ... }` throw
`"There are multiple relations between 'users' and 'departments'. Please specify relation name"`
at query-build time (before any network I/O), which `src/app/api/departments/route.ts`'s catch
block turned into a bare `500`. The frontend (`src/app/(app)/compliance/page.tsx`) then treated
that error-shaped response as an array, and `.map()` on the resulting non-array `departments`
state crashed the page.

**Real fix, both layers**:
- `src/lib/db/schema.ts`: named the department-membership relation pair `'departmentMembers'`
  (matching the existing `'deptHead'` pattern), resolving the ambiguity.
- `src/app/(app)/compliance/page.tsx`: the departments-fetch effect now only ever sets state to
  `d.departments` when it's actually an array; any other shape (error object, non-2xx body, fetch
  rejection) sets an empty array and surfaces a real, visible `toast.error(...)` instead of letting
  a malformed value reach `.map()` — so a backend 500 degrades the department filter, it no longer
  crashes the page, regardless of root cause.

**Real regression coverage added**: `src/lib/db/schema.relations.test.ts` (schema-config check,
no live DB — confirmed the ambiguity check runs before any network I/O by timing it against a
deliberately unroutable host, ~2ms) and `src/app/api/departments/route.test.ts` (route wiring:
auth-guard enforcement, no-org 200-empty-array, real-query-failure 500 shape, success-path
shaping). Both fail against the pre-fix schema and pass against the fix (verified directly, not
assumed).

**Real retest**: direct reproduction against the real production database (`APP_RUNTIME_DATABASE_URL`'s
target, RLS enforced via `SET ROLE app_runtime`) for the exact real org this certification pass
created — before the fix: `GET`-equivalent query throws the relation-ambiguity error for this org;
after the fix (same schema file, same org, same RLS context): real success, returns the org's one
seeded "General" department with `head: null`, `complianceItems: []`, `users: [{ id: ... }]` —
the exact shape `route.ts` needs to build its response. A live redeploy + browser retest against
`https://projexa-ai.com` itself was not performed as part of this PR (requires merge + deploy,
which per `AGENTS.md` Rule 6 this agent cannot self-authorize) — the DB-level retest above is the
real, executed verification this PR relies on; a post-merge browser retest against the live site
is recommended before closing this UMR.

### Finding B — tracked separately, not fixed by this PR (by design — do not conflate with Finding A)

Real `403 Forbidden` across CRM and ERP backing APIs for a fresh self-signup org, severity medium,
real behavior observed same certification pass:
- `/crm` shell renders; `/api/crm/leads`, `/api/crm/accounts`, `/api/crm/campaigns`,
  `/api/crm/contacts`, `/api/crm/opportunities` all `403`.
- `/erp/procurement` shell renders; `/api/erp/procurement/quotations`, `/requisitions`, `/rfqs`
  all `403`.
- `/erp/journal-entries` shell renders; `/api/erp/buying/suppliers`, `/api/erp/accounts`,
  `/api/erp/cost-centers`, `/api/erp/journal-entries`, `/api/erp/companies` all `403`.
- Consistent with `erp-enablement-service.ts`'s `requireErpEnabled()` gate — plausibly correct,
  safe-by-default behavior for a brand-new org with no ERP/CRM module explicitly enabled. Not
  asserted as a bug in the gate itself; the real gap is UX: a fresh self-signup user sees
  empty-looking CRM/ERP pages with backing calls silently `403`ing and no "module not enabled,
  contact your admin" messaging to explain why.
- **Not addressed in this PR** — this UMR's priority, per the owner, was the high-severity
  Compliance Register crash (Finding A) only. Logged here as its own named, tracked gap so it
  isn't lost: needs a real "module not enabled" empty-state / explanatory UI wired to the same
  `requireErpEnabled()`-style gates across `/crm`, `/erp/procurement`, `/erp/journal-entries` (and
  plausibly other ERP/CRM surfaces sharing the same gate — not independently re-audited here).

Canonical artifact updated: this file — not rewritten, not duplicated.

---

## Amendment (2026-08-02): Server-wide artifact traceability register — tranche 3 (`UMR-20260802-164659-9a31`, OCID-20260802-016)

Continuation of tranches 1-2 above. Scoped this pass to the "honest remaining scope" tranche 2
named: `/opt/veridian/scripts/*/` subdirectories, claude-control's `ai-os/*/` subdirectories, and
live-server `/opt/veridian/ai-os/*/` subdirectories (split across 3 parallel discovery passes,
`pending_remediation/` covered separately given its real size).

**Real coverage this tranche: 493 files** (142 + 176 + 175), all covered fully, not sampled —
exceeding the ~414 originally scoped after two independent shallow-count gaps were found and
closed rather than left unscanned (`scripts/prompt_gateway/engine/` and 4 of claude-control's
subdirectories both had real, git-tracked content one level deeper than a `-maxdepth 1` count
found).

**Real environment finding, worth recording for future tranches**: this sandbox's wrapped
`find`/`bfs`/`grep` shell functions can silently truncate large directory listings and inject a
literal `... more files` string into output even when redirected to disk. Two independent
discovery agents hit this independently and both cross-verified with `python3 os.listdir()` /
`command find` / `git ls-files` to get real counts. `pending_remediation/`'s real count is 176,
not the 51 an initial truncated listing suggested.

### Zone breakdown

| Zone | Files | UMR ref in content | Traceable via commit history | No mapping (pre-dates system) | Orphans | Duplicates |
|---|---|---|---|---|---|---|
| `/opt/veridian/scripts/*/` subdirs | 37 | 1 (`systemd/veridian-worker@.service` → `UMR-20260801-190119-ff34`) | 0 | 36 | 0 | 0 (1 backup-pattern connection to an already-known tranche-1 duplicate pair, not new) |
| claude-control `ai-os/*/` subdirs | 105 | 0 | 0 | 105 | 0 | 0 |
| live-server `ai-os/pending_remediation/` | 176 | 1 (`audit-fail-compliance-tracker-709.md` → `UMR-20260802-051325-9e5a`) | 0 | 175 | 0 | 4 pairs / 8 files (self-consistent same-PR duplicates from 2 dispatcher trigger paths, same 2026-07-26 run) |
| live-server `ai-os/*/` remaining subdirs | 175 | 13 (see detail below) | 0 | 162 | 0 | 0 |
| **Total** | **493** | **15** | **0** | **478** | **0** | **4 pairs / 8 files** |

Real UMR-content-citation detail beyond the summary counts: `memory/superboss-register.sqlite` and
5 of its own backup snapshots carry 73-993 UMR strings each — this is the live `umr_tasks` decision
log itself (already documented as the canonical decision log in the unified-memory-model
amendment above), not per-file citations, counted once as "has UMR content" not per-string.
`OWNER_DIRECTIVES/PROTOCOL_OWNER_AI.yaml` (+ 1 backup), `logs/ATTENTION.md`, `logs/dispatch-tick-cron.log`,
`generated/generate_quick_reference-latest.yaml`, `session_metadata/FROM_LAPTOP_WORK_IN_PROGRESS_METADATA.json`
round out the 13.

**Zero genuine orphans found across all 493 files.** Every directory that looked orphan-shaped by
name resolved to a real, self-evident, live-wired, or explicitly-indexed artifact on inspection
(live runtime state read/written by `resource_governor.py`, real generator-script outputs, real
named patches, real documented OOM-incident backups, a real self-documented staged-migration
folder, directory-level `MASTER_INDEX.yaml`/`OS.yaml` indexing consistent with tranches 1-2's own
established convention).

**4 genuine duplicate pairs found, all in `pending_remediation/`**, all self-consistent (same
dispatcher run, same real target PR, two different trigger paths producing near-identical
content) — 3 of the 4 pairs' target PRs are already merged (stale), 1 pair's target PR
(`compliance-tracker#574`) is still open.

### Real operational finding, not a UMR-mapping issue but worth surfacing

Live-re-verified all 144 unique repo+PR targets referenced by `pending_remediation/`'s 176 files
against real current GitHub state (`gh pr view --json state`): **98 OPEN, 34 MERGED, 12 CLOSED**.
**62 of 176 files (35%) reference a PR that has already merged or closed** — the remediation these
auto-drafted prompts call for is moot, but the queue was never cleaned up after the fact. The
producing pipeline (`status-remediation-tick.py`, real live systemd timer, confirmed active) has
no apparent cleanup/expiry step for its own output once the underlying condition resolves. Not
fixed here (out of this directive's discovery-only scope) — a real, concrete, bounded follow-up
candidate.

**Minor documentation-lag note**: `MASTER_INDEX.yaml`'s `status_monitor_and_remediation` registry
entry still cites only the old, no-longer-wired `veridian_remediation_dispatcher.py`, not its live
successor `status-remediation-tick.py`. `session_metadata/WORK_ANALYSIS.md` self-documents its own
path as nested under `memory/`, but its real location is top-level `session_metadata/` — same
class of path-citation drift already on record for `PROTOCOL_OWNER_AI.yaml` (item 10).

### Real running total, this register, all 3 tranches

**381 (tranche 1) + 51 (tranche 2) + 493 (tranche 3) = 925 real files classified.**

### Honest remaining scope (still not covered by any tranche)

`/opt/veridian/ai-os/tasks/` (899 real task directories) remains explicitly out of scope by
design — each task's own `task.yaml` is already the canonical per-task state per the unified
memory model amendment, not a candidate for this register. No other named zone from tranches 1-2's
"honest remaining scope" lists remains outstanding as of this tranche — claude-control and
live-server's subdirectories are now both fully covered. Not yet attempted by any tranche: product
source-code trees (`src/`, `drizzle/`, etc.) in any repo — this register has scoped itself to
governance/metadata artifacts throughout, consistent with the directive's own framing ("scripts,
ai-os, and any repo not yet covered"), not literal every file on the server.

Canonical artifact updated: this file — not rewritten, not duplicated.

---

## Amendment (2026-08-02): Recovery matrix — real, additional gap found (`UMR-20260802-165541-c27d`, OCID-20260802-019)

Continuation of the recovery matrix amendment above. No new implementation or audit for this
directive itself — recording one real, additional, honest gap found while working the OCID-020
certification, distinct from the recovery matrix's already-disclosed supervisor-restart gap.

### Real gap found: `task.yaml`'s `status` field can go stale after a clean SIGTERM

Real, directly observed: `task-20260802-210700-pm-decision--fix-the-real-high-severity` was
cleanly `SIGTERM`'d by the resource governor (freeing a concurrency slot for other queued
dispatches — a correct, working safeguard, not itself a bug). Its real, valuable in-flight finding
(the multi-tenant isolation confirmation) was independently rescued, rebased, and merged as PR
#747. **However, the task's own `task.yaml` `status` field still reads `in_progress`** —
independently re-verified: `systemctl --user is-active` for its worker unit returns `inactive`
(confirmed no live process), yet the on-disk status field was never updated to reflect the clean
stop. A subsequent real `dispatch-tick` resume attempt for this same task was correctly rejected
by the credit accountant as a real duplicate (`UMR-20260802-234312-976e`, `rejected_duplicate`) —
the safeguard caught it, but only because a human/session happened to check; nothing in the
pipeline itself updates `status` on a clean stop.

**Distinct from the already-disclosed gap** (supervisor-process `Restart=no`, no auto-restart on
supervisor failure): this is a *status-field staleness* gap on the *worker* side — the process
stops cleanly, but the durable state record doesn't reflect that stop. A future session or
automated sweep reading `task.yaml` directly (not `systemctl`) would see `in_progress` and could
reasonably conclude the task is still live when it is not.

**Not fixed here** — out of this directive's discovery/disclosure scope. A real, bounded fix
candidate for future work: `resource_governor.py`'s stop/SIGTERM path (or `dispatch-tick.py`'s own
sweep) should write a terminal or `stopped`-class status to `task.yaml` whenever it cleanly stops a
worker, mirroring what `veridian-task.py checkpoint --status` already does for every other real
status transition.

Canonical artifact updated: this file — not rewritten, not duplicated.

---

## Amendment (2026-08-03): PM decision — task-231514 credit-accountant rejection ACCEPTED as correct (`UMR-20260802-233539-d8cd`)

PM decision on `task-20260802-231514-pm-confirmation-of-task-210700-real-stat`, which terminated
`rejected_duplicate`. Relates to `UMR-20260802-165606-4413` (the OCID-020 finding chain — real
`departments` 500 crash + CRM/ERP 403 UX gap — whose PM-decision work by task-210700 is what
task-231514 was independently re-confirming).

**Real chain of events, independently re-verified directly against `task.yaml`/git, not narrated:**
task-231514's own dispatch-tick resume attempt for task-210700 was correctly rejected by the credit
accountant as a real duplicate (`UMR-20260802-234312-976e`, `rejected_duplicate`) — task-210700's
real value (the departments-500 fix and the multi-tenant isolation finding) had already merged to
`main` via PR #747 (`f18275cc`, confirmed an ancestor of this branch's `HEAD`). task-231514's own
closing note (`UMR-20260802-235225-fbb1`) reached the same conclusion independently.

**Decision: the rejection is ACCEPTED as correct.** This is a working safeguard doing its job, not
a bug and not a product-level question for the Owner — spending further AI credits to resume a task
whose real findings were already merged would be pure wasteful duplicate work. No fix, override, or
resume is opened against this rejection.

**One genuinely new, useful thing task-231514 found is folded forward, not re-litigated:**
task-210700's own `task.yaml` `status` field staying stale at `in_progress` after a clean SIGTERM
(no live process, confirmed via `systemctl --user is-active` returning `inactive`) was already
independently written up as its own honest gap under the OCID-019 recovery matrix in the amendment
directly above this one (`UMR-20260802-165541-c27d`, commit `162a9a71`, merged via PR #750 —
confirmed present on `main` at this branch's `HEAD`, `db6524e7`). Re-verified that write-up directly
and found it complete and accurate; not duplicated here.

Canonical artifact updated: this file — not rewritten, not duplicated.

---

## Amendment (2026-08-03): Category A / Category B production-DB governance split (`UMR-20260803-025317-0c64`, amended `UMR-20260803-025414-8274`, OCID-20260803-021)

Real, Owner-directed, tier 0 governance amendment — not a PM decision, not AI judgment. Amends
`UMR-20260802-165541-c27d` (recovery matrix, above), and references `UMR-20260802-165034-5747`
(standing gatekeeper rule), `UMR-20260802-165434-cd91` (unified project memory model), and
`UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program — see its own note below).
Builds directly on the concrete implementation directive dispatched under this same UMR chain
(`UMR-20260803-025317-0c64`), which named the exact files to extend.

**Real problem this closes**: `task-20260802-210700` ran a live, unreviewed-at-dispatch-time
production migration apply (see `MIGRATION-DRIFT-0264-EMAIL-INTEL-500-FIX` in
`ai-os/boss/COMPLETED.yaml`) with no PR and no prior tier2 sign-off. It was already-reviewed,
already-merged, idempotent SQL fixing a real Sev1 outage — but there was no deterministic way to
say so at dispatch time. The eventual authorization (`UMR-20260803-012711-18b4`) was a real,
one-off Owner/PM judgment call, not a repeatable, non-human-gated policy. The Owner's explicit
decision, verified directly (not assumed): **neither the non-technical Owner, nor the PM, nor AI
judgment should be the standing approval mechanism for this class of action — the Kernel itself,
evaluating deterministic evidence, should be.**

**Real verification done before building anything new** (per the standing gatekeeper rule,
`UMR-20260802-165034-5747`): confirmed the real current tier2 policy is `scripts/ddl_authorization_check.py`
+ `scripts/task-gateway.py`'s dispatch-time wiring in the `claude-control` repo (not a
`CONSTITUTION.yaml` rule at the time — no prior `id:`-governed entry existed for it; `SEC-06` is the
first, added in this same amendment). Confirmed the real WAVE-10-REDO precedent
(`ai-os/boss/COMPLETED.yaml`, `id: WAVE-10-REDO`) is a directly-quoted, one-off Owner authorization
for a specific live action, not a standing policy — the same class of ad hoc judgment call this
amendment replaces for DB recovery specifically. Confirmed the real `GAP-MIGRATION-APPLY-NOT-AUTOMATED`
open item in `ai-os/MASTER-TRACKER.yaml` is a *distinct* problem (automated drift *detection*) from
what this amendment builds (deterministic recovery *authorization*) — see that gap's own updated
note for the honest, non-overlapping distinction. Found and reconciled a real, separate, pre-existing
drift while investigating: `claude-control`'s live-deployed `scripts/task-gateway.py` had a real
duplicate-task-key hotfix (2026-07-31) never committed back to its own repo.

**The real split** (also now `CONSTITUTION.yaml`'s `SEC-06`, the canonical machine-readable rule —
this file documents the amendment narrative, `CONSTITUTION.yaml` is authoritative on the rule text
itself per its own `amendment_rule`):

| Category | Covers | Approval mechanism | Status |
|---|---|---|---|
| A — new schema change | New migration, new table, new column, new constraint, any schema redesign | Explicit human sign-off, unchanged (real `PRE-APPROVED-LIVE-DDL` citation) | Unchanged, held exactly as before |
| B — deterministic recovery | Reapplying previously-approved/merged SQL, idempotent reapplication, correcting production drift, reconciling metadata | Kernel policy check, all 10 real conditions must verify true against real evidence — no human/PM/AI judgment call | **NEW**, implemented this amendment |

The 10 Category B conditions (verbatim from the Owner's directive, each checked against real,
verifiable evidence — never a narrated claim): the SQL already exists in the repository; the SQL
was previously reviewed and merged, not new or unreviewed; the SQL is genuinely idempotent, safe to
run again without harm; the production issue is a verified real outage or Sev1 incident, not
routine maintenance; root cause has been independently verified, not assumed; an independent audit
confirms the proposed live action matches the already-reviewed migration exactly; the execution is
fully logged under the real governing UMR; real before-and-after evidence is captured, not
narrated; a real rollback path is documented; a real canonical artifact is updated after execution
completes.

**Real implementation**: `check_category_b_recovery()` in `claude-control`'s
`scripts/ddl_authorization_check.py`, wired into `scripts/task-gateway.py`'s existing dispatch-time
gate as an alternative to the Category A citation path (not a replacement — either passing is
sufficient). A `CATEGORY-B-DETERMINISTIC-RECOVERY:` evidence block in a dispatch prompt-file names
real, checkable evidence for all 10 conditions; each is verified against real repo/task-record
state (file existence, real git merge history, a real idempotency-guard scan of the actual SQL
text, and scoped citation-existence checks — structurally the same rigor as the existing Category A
KE-id/decision-file checks, same honest "real, findable record, not a semantic content audit"
limitation). Any single failed condition blocks execution and reports plainly which one, and why.

**Real status, not glossed over: `claude-control` PR #123 is open, under active independent review,
NOT yet merged to `claude-control`'s `main` — the production dispatch pipeline does not run this
gate today.** Two real, substantive `AUDIT: FAIL` rounds so far, each with genuine findings that were
independently verified and fixed, not routed around: round 1 found a materially weaker bare-path
evidence-citation bypass (citing e.g. `README.md` with no anchor would have satisfied 6 of the 10
conditions with zero content check), a path-traversal gap (a `..`-containing evidence field could
resolve outside the named sibling repo), and a false-negative in the idempotency heuristic on
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (inherently idempotent in Postgres, incorrectly flagged
as needing a guard) — all fixed, with regression tests. Round 2 found a critical, severe gap:
`check_category_b_recovery()` alone never verified the SQL cited in `evidence['sql_file']` was what
the prompt's own SCOPE would actually execute — a prompt could cite a safe, unrelated,
already-reviewed file to satisfy all 10 conditions while its real SCOPE instructed different,
unreviewed DDL. Fixed via a new binding check (`_prompt_scope_matches_cited_sql()`, condition 11).
Round 3 found: (a) a second, separate live-vs-repo drift — the task_key duplicate-dispatch feature
(itself a reconciliation of a real, already-working live-only hotfix) called
`superboss-register.py` subcommands (`claim-task-key`/`check-task-key`) that existed live but had
not been reconciled into the repo's copy of that file too, confirmed both ways via direct live
invocation; fixed by reconciling `superboss-register.py` as well, and adding 5 new tests (zero
coverage previously was why this went uncaught); (b) `RISKY_DDL_OPENER_RE` silently treated several
destructive DDL forms (`TRUNCATE`, `DROP SCHEMA`/`SEQUENCE`/`DATABASE`/`CONSTRAINT`, role/user DDL)
as safe-by-omission — expanded to match `DDL_KEYWORD_PATTERNS`' full breadth, with `GRANT`/`REVOKE`
explicitly (not silently) carved out as inherently idempotent, real Postgres semantics.
67 tests pass as of the latest push (`claude-control` PR #123, commit `95e9294`), including a
fixture-repo-based Category B suite and a dedicated `superboss-register.py` task-key suite. **Do not
cite this as settled, working evidence until a real `AUDIT: PASS` is posted and the PR is merged** —
this file will be updated with the real merge commit once that happens; until then
`ai-os/CONSTITUTION.yaml`'s `SEC-06` correctly reads `PARTIALLY_ENFORCED`, not `ENFORCED`.

**Retroactive test against a real, non-hypothetical past incident** (not simulated): reclassified
`MIGRATION-DRIFT-0264-EMAIL-INTEL-500-FIX` under this rule and ran it through
`check_category_b_recovery()` using the real evidence the independent auditor already gathered
(`ai-os/boss/COMPLETED.yaml`). Real result: **9 of 10 conditions pass. Condition 9 (rollback path
documented) genuinely fails** — no rollback plan was ever documented for `drizzle/0264_helpdesk_tiered_sla_team_routing.sql`.
This is an honest, valuable finding, not glossed over: the new deterministic Kernel policy is
measurably *stricter* than the ad hoc Owner/PM authorization that actually approved this action at
the time. Full condition-by-condition breakdown recorded in `ai-os/boss/COMPLETED.yaml`'s
`MIGRATION-DRIFT-0264-EMAIL-INTEL-500-FIX` entry (`category_b_retroactive_test` field).

**Consistency across the registries the Owner named**: the standing gatekeeper rule
(`UMR-20260802-165034-5747`, this file's own earlier amendment) already required checking real
existing mechanisms before building new ones — this amendment's "real verification done before
building anything new" section above is that check, applied. The unified project memory model
(`UMR-20260802-165434-cd91`) is unchanged in structure — no new file/table was created; this
amendment's real evidence lives in the same canonical artifacts that model already documents
(`ai-os/CONSTITUTION.yaml`, `ai-os/MASTER-TRACKER.yaml`, `ai-os/boss/COMPLETED.yaml`, this file).
The recovery matrix (`UMR-20260802-165541-c27d`) covers worker/supervisor/task-lifecycle failure
classes, a genuinely different layer from production-DB-write governance — this amendment does not
add a 9th row there, since Category A/B is not a "recovery from infrastructure failure" mechanism in
that table's sense; it is cited here as the nearest sibling registry per the Owner's explicit
instruction to update it, with this honest note on why its own table is unchanged. The ERP
Functional Completeness Master Program (`UMR-20260802-173631-ca85`) has no canonical artifact of its
own yet (confirmed directly — it remains gated behind the OCID-20260802-020 PROJEXA certification
sweep, per `ai-os/boss/ACTIVE-CLAIMS.yaml`) and is unaffected by this amendment; noted here, not
fabricated a new section for, since this amendment is not part of that program's real scope.

**Status, real and current:**

| OCID | UMR | Section (this file) | Status |
|---|---|---|---|
| OCID-20260803-021 | `UMR-20260803-025317-0c64` / `UMR-20260803-025414-8274` | Category A / Category B production-DB governance split | **CLOSED — `claude-control` PR #123 received a real `AUDIT: PASS` and merged to `master`, real merge commit `ae78aff66cfe254774d95b92a8f3a3668b1e9884`, independently reconfirmed via `git merge-base --is-ancestor` and a direct `grep` on the live master checkout** |

Real review history, in full, not glossed over: PR #123 took 5 real audit rounds (4 `AUDIT: FAIL`, 1
`AUDIT: PASS`) before merging. Round 1 found a materially weaker bare-path evidence-citation bypass,
a path-traversal gap, and an `ENABLE ROW LEVEL SECURITY` idempotency false-negative. Round 2 found a
critical, severe gap: the 10 conditions alone never verified the prompt's own SCOPE actually executes
the cited SQL, not different, unreviewed DDL. Round 3 found a second, separate live-vs-repo drift
(`superboss-register.py`, the task_key feature's own dependency) plus incomplete DDL-form coverage in
the idempotency scanner (several destructive forms silently treated as safe-by-omission). Round 4
found a SQL-comment guard-keyword bypass (a comment merely containing "IF EXISTS" could fake a real
guard). All four were real, independently verified, and fixed with regression tests (71 tests pass as
of the merged commit).

**A distinct, real infrastructure gap was also found and is separately registered, not silently
absorbed here**: rounds 2 through 4 were discovered, mid-review, to have all been reviewing the SAME
STALE workspace snapshot — frozen at the task's original `veridian-task.py adopt` commit — because the
retrigger flow (archive `review.json`, restart the supervisor service) does not resync an adopted
task's git worktree to its branch's current remote tip before reviewing. Every "fix" pushed in
response to rounds 1-3's feedback was real and correct, but was never actually re-reviewed until the
workspace was manually synced before the final (5th) retrigger. See
`GAP-SUPERVISOR-RETRIGGER-STALE-WORKSPACE` in `ai-os/MASTER-TRACKER.yaml` for the full write-up —
this is a real, likely-recurring gap in the adopt-then-iterate-then-retrigger workflow, not unique to
this one task.

Canonical artifact updated: this file, `ai-os/CONSTITUTION.yaml` (`SEC-06`, status `ENFORCED`, real
merge commit cited), `ai-os/MASTER-TRACKER.yaml` (`GAP-MIGRATION-APPLY-NOT-AUTOMATED` cross-referenced,
not falsely closed; new `GAP-SUPERVISOR-RETRIGGER-STALE-WORKSPACE`), `ai-os/boss/COMPLETED.yaml`
(`MIGRATION-DRIFT-0264-EMAIL-INTEL-500-FIX` retroactive test result) — not rewritten, not duplicated.

---

## Amendment (2026-08-03): OCID-040 real status snapshot of the OCID-022 through 039 documentation series (`UMR-20260803-042918-60b8`)

Real, current-as-of-commit status rollup, not a certification, not an implementation, not a platform
freeze — per this OCID's own explicit directive, deferring all of those pending the real OCID-020
(`UMR-20260802-165606-4413`) unlock condition. Full detail, per-OCID status table, real UMR-chain
resolution, real canonical-artifact existence check, and a real dependency map:
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`.

**Headline, real findings**: of 18 nominal documents (OCID-022 through 039), 3 have real draft content
in open, unmerged PRs (#765, #766, #767); zero are merged; 14 have not started (queued behind the real
5-worker concurrency cap); one (OCID-023) is genuinely blocked on a real, correctly-respected
dependency. A real, unresolved content-overlap risk is flagged between OCID-023/031 and across the
OCID-029/030/032/034/035/036 cluster. "OCID-021" / "the OCID-021 implementation lock", cited verbatim
in every directive in this chain as an already-registered artifact, does not exist anywhere in this
repo under that label — independently confirmed twice (a background research agent, and separately by
OCID-023's own dispatched worker). The real gate every directive in this chain actually means is
OCID-020 (`UMR-20260802-165606-4413`), which is real, genuinely still open, and correctly respected.

Canonical artifact updated: this file, `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` (new) — not rewritten, not duplicated.

---

## Amendment (2026-08-03): VERIDIAN Universal Context and Predictive Runtime v1.0 (`UMR-20260803-055709-368e`, dispatch `UMR-20260803-042003-5e92`, OCID-034)

Real Owner directive, tier 1, documentation only. Parented to `UMR-20260803-041851-085a` (real OCID-033,
"VERIDIAN Universal End User Work Orchestration Runtime" — a distinct, real, sibling dispatch, independently
confirmed via a direct query against `umr_tasks` in `/opt/veridian/ai-os/memory/superboss-register.sqlite`,
not narrated). Also cites `UMR-20260803-040844-4a33` through `UMR-20260803-041743-d271` (OCID-022 through
OCID-032, in order), `UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program, this file's
own parent), `UMR-20260802-165606-4413` (OCID-020), `UMR-20260802-164659-9a31` (server artifact
traceability audit), `UMR-20260802-165034-5747` (standing gatekeeper rule), `UMR-20260802-165434-cd91`
(unified project memory model). Extends the existing master program; no new program, no new file beyond
the one canonical artifact named below.

**Real numbering correction, found and stated rather than silently worked around**: this task's own real
dispatch row (`unit_name: veridian-worker@task-20260803-055118-ocid-034-...`, queried directly) is titled
"OCID-034 VERIDIAN Universal Context and Predictive Runtime," and its cited parent (`UMR-20260803-041851-085a`)
is real, distinct, and separately titled "OCID-033 VERIDIAN Universal End User Work Orchestration Runtime."
This differs from the earlier `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s own table, which
had labeled the Context and Predictive Runtime mission "OCID-033" and the Work Orchestration mission
"OCID-032" — the same class of off-by-one numbering drift that document's own table already needed a
correction for at rows 036/037 (`UMR-20260803-045159-ec55`), one slot further down the chain. This
amendment uses the real, current, directly-queried dispatch numbering (OCID-034) and does not attempt to
retroactively fix the snapshot table, which is out of this task's scope.

**Real, honest zero-duplication check performed** (per the binding PM decision in the OCID-040 snapshot,
`UMR-20260803-045159-ec55`, applicable to every worker picking up OCID-026 through 037): `gh pr list`
against `FChecklist/compliance-tracker`, re-checked at writing time, confirmed OCID-022/023/024/025/026-030
(PRs #765-768, #771-775) are all still open, unmerged. OCID-023's real, complete 739-line document (read
directly from its branch) is a task-lifecycle model — real, adjacent, but a distinct subject from context
reuse and prediction; no genuinely new "Context and Predictive Runtime" content exists in any other open or
merged PR as of writing.

**Real discovery performed, not re-derived from memory**: direct file:line citation of the real, existing
context mechanisms already in the product (`withTenantContext()`, `src/lib/db/tenant-scoped.ts:65`;
`VeriChatContext`, `veri-chat-service.ts:19`; `AssembledContext`/`RelevanceScorer`/`ContextWindow`,
`prompt-compiler/context-assembly.ts:1-9`; `MotherRouterContext`, `mother-router.ts:594`; mode-pill
capability-key derivation, `capability-learning-service.ts:27-31`; Dynamic Chains,
`api/dynamic-chains/route.ts`, `dynamic-chain-directory-service.ts`; report registries,
`report-engine-service.ts:208,1379,1735`), plus `ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md`'s real L0/L5
cache layers and `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`'s governance-layer registries
(`wiring_registry`, `knowledge_engine`, `system_index`).

**Real, honest gaps newly named from the context/prediction angle, none fixed by this document**: no
single shared, request-scoped context carrier exists across auth/chat/session/browser/task/AI-prep layers
(each subsystem independently re-derives its own context slice); no runtime function or analysis registry
exists (only reports, `report-engine-service.ts`, are a real live catalog); no PWA exists at all
(confirmed: zero `manifest.json`/service-worker matches); VERI Chat does not feed into Mother Router
(confirmed: zero cross-references in `veri-chat-service.ts`); no next-best-action, predictive-navigation,
or predictive-form-population mechanism exists, though the verified context (org/role/task) each would
need already does.

**Status, real and current:**

| OCID | UMR | Section (this file) | Status |
|---|---|---|---|
| OCID-034 | `UMR-20260803-055709-368e` (artifact) / `UMR-20260803-042003-5e92` (dispatch) | VERIDIAN Universal Context and Predictive Runtime v1.0 | **Documentation-only artifact complete on this task's own branch; not yet merged to `main` at the time this amendment was written — this file will be updated with the real merge commit once that happens, same discipline as OCID-20260803-022/023's own entries above** |

Canonical artifact: `ai-os/VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md` (new), this
file (this amendment), `ai-os/OS.yaml` (new index entry), `ai-os/boss/ACTIVE-CLAIMS.yaml` (claim entry,
to be moved to `recently_completed` on merge) — not rewritten, not duplicated.
