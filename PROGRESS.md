# VERIDIAN Review Framework: AI Architecture / Domain Accuracy & Quality

Closing 4 findings in one PR. Investigation done by reading current code first
(per task instructions) -- see notes under each finding for what was actually
found vs. what the gap description assumed. (Note: this file previously held
stale content from a prior, unrelated, already-merged task
(task-20260717-194819-fx-live-rate-feed, PR #411) that shared this workspace
directory -- overwritten here for this task.)

## Findings & investigation notes

1. **[Medium] Domain Accuracy** -- "no systematic grounding/validation of
   free-text AI answers." **Narrower than described**: `enforcePolicy()`
   (policy-enforcement-engine.ts) is already wired into ~12 free-text LLM call
   sites (chat, CRM, construction AI, communication drafting, tickets, voice
   tickets, email intelligence, FDE, asset routing, task-execution-engine).
   The two real gaps: `report-engine-service.ts::runAiRecipe()` and
   `ai-report-builder-service.ts::proposeReportFromUpload()` never call it --
   confirmed a real, live surface: any authenticated org user can POST an
   arbitrary `ai_recipe` `promptKey`/`groundingNote` via
   `POST /api/reports/definitions` straight into an LLM call with zero
   policy gate. Also confirmed `runAiRecipe()` can run with **empty**
   grounding data (`{}`) and nothing stops it from generating a "grounded"
   narrative from nothing.
2. **[Medium] AI Tests** -- confirmed accurate: `promptfooconfig.yaml` only
   covers `chat.ai_thread_system` + `document.extract_content`, and its own
   header says "not run automatically in CI/on every commit, only on
   demand." No reports or capability-audit prompt coverage at all.
3. **[Low] AI Innovation** -- confirmed: `src/app/page.tsx` (the real
   marketing landing page) has 4 "research directions" cards but none
   names the software-first/AI-second dispatch order (`task-execution-
   engine.ts`, Constitution SF-01) as a differentiator.
4. **[Medium] Cognitive AI OS consistency** -- confirmed: `embeddings.ts`
   and `whisper-client.ts` are real, intentional bypass points (neither
   returns free-text AI opinion to a user, both call external providers
   directly, neither is documented anywhere as an approved exception).
   `ai-os/CONSTITUTION.yaml`'s existing DMP-02 entry already documents the
   capability-tree inconsistency gap (sendMessage/generateAiReply/reports/
   workflows have zero capability-tree lookup) -- adding the missing
   bypass-point documentation, not re-litigating DMP-02 itself.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml, AGENTS.md, CLAUDE.md) and registered claim in ACTIVE-CLAIMS.yaml (commit `75f15f5a`, pushed)
- [x] Investigated all 4 findings against current code (see notes above)

- [x] Add `hasGroundingData()` to `policy-enforcement-engine.ts` (deterministic, zero-false-positive grounding presence check) + 3 unit tests
- [x] Wire `enforcePolicy()` + `hasGroundingData()` into `report-engine-service.ts::runAiRecipe()`
- [x] Wire `enforcePolicy()` into `ai-report-builder-service.ts::proposeReportFromUpload()` (text-extraction path only -- vision/image path intentionally not gated, documented inline why)
- [x] report-engine-service.ts/ai-report-builder-service.ts: no new test file added for the wiring itself -- both files' own established convention (see report-engine-service.test.ts's header) is DB/network-touching functions are deliberately left untested; the new deterministic logic (`hasGroundingData`) is fully covered where it's actually pure, in policy-enforcement-engine.test.ts
- [x] Extend `promptfooconfig.yaml`: reports (`reports.ai_recipe_system`, `reports.ai_builder_system`) + capability-audit contract eval (`capability-audit-contract`, built from the real git-tracked `buildAuditPrompt()` output -- the `ai_team.chief_audit_officer` persona text itself is DB-managed and not in git, documented honestly in the config's own header); switched provider to the real platform default (`openai/gpt-oss-120b` via Groq) since `OPENAI_API_KEY` isn't provisioned anywhere in this repo's secrets (confirmed via whisper-client.ts's/embeddings.ts's own header comments) -- the original `openai:gpt-4o-mini` provider could never have run in CI
- [x] Add `.github/workflows/ai-prompt-evals.yml` (path-filtered on prompt-bearing files, runs on PRs, uses `GROQ_API_KEY`, mirrors browser-ux-test.yml's real-secrets precedent)
- [x] Add CONSTITUTION.yaml entries: new `DMP-02A` (embeddings.ts/whisper-client.ts as approved capability-tree/policy-gate exceptions, additive-only) + updated `GP-08` mechanism/gap to reflect the new `hasGroundingData()` gate + amendment_log entry
- [x] Add "Software-first, AI second" research-direction card to `src/app/page.tsx` (now first of 5 cards; heading/comment counts updated to match)
- [x] Verification: `bunx tsc --noEmit` clean; `bun run lint` 0 errors (same 3 pre-existing warnings in unrelated files as before this change); `bun test` full suite -- **1391 pass, 0 fail** (was 1388 before this change -- the +3 are the new `hasGroundingData` tests); governance checks all pass (`check-metadata-index-coverage.mjs`, `check-doc-cross-references.mjs`, `check-guardrail-presence.mjs` 88/88 markers, `check-asset-registry-coverage.mjs`, `check-doc-quarantine-banner.mjs`)
- [x] promptfooconfig.yaml validated as syntactically-correct YAML directly (js-yaml). Known environment limitation, not a regression: a live `promptfoo validate`/`eval` run in this sandbox fails on a pre-existing `ajv`/`ajv-formats` module-resolution mismatch under `bun install`'s node_modules layout, unrelated to this change's YAML content (reproduces identically via both `bunx` and `npx` against the file as it stood before this PR's edits too) -- not something in scope for this finding to fix, and CI's own `bun install --frozen-lockfile` step may resolve differently than this ad hoc reinstall did.

## Remaining
- [ ] None outstanding on the code side. Update ACTIVE-CLAIMS.yaml claim -> recently_completed once the PR merges (this session does not merge its own PR -- Rule 6/7(c))
- [ ] Open PR (not self-merged, per Rule 6/Rule 7(c) -- left for the supervising session's audit)
