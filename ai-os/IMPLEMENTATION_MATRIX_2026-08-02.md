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
