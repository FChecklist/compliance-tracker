# VERIDIAN Tool Integration Plan — PaddleOCR, Docling, Meilisearch, Whisper.cpp, LibreOffice Headless, Temporal

**Directive:** Boss, 2026-07-10. "Integrate all 6. Divide into small tasks. Dispatch to GPT-OSS-120B. Tight instructions. Docker + GitHub. Document everything. Secrets in GitHub Secrets. Full autonomy granted — 'whatever you recommend I accept.'"

**Supervisor:** Super Boss (Claude, this machine). **Implementer:** `tool_integration_engineer` role (GPT-OSS-120B, added to `src/lib/ai-team/roster.ts` this same day) via the existing `ai-team-workforce.yml` dispatch pipeline.

## 1. Why these 6, grounded in confirmed gaps (not speculation)

Each tool maps to a real, code-confirmed gap found during this session's testing, not a hypothetical nice-to-have:

| Tool | Confirmed gap | Evidence |
|---|---|---|
| PaddleOCR | Document AI vision extraction silently dead for every org on the platform-default (Groq) config | `VERIDIAN_FULL_LOAD_TEST_RESULTS.md` §3 |
| Docling | Only naive text extraction for PDFs (no table/layout structure) | `src/lib/ingest/parser.ts` inspection |
| Meilisearch | Global search only covers 3 tables despite UI copy promising "records, documents, people, and more" | `src/app/api/search/semantic/route.ts` inspection |
| Whisper.cpp | Zero audio transcription code anywhere in `veri-meeting-service.ts` | grep confirmed zero matches |
| LibreOffice Headless | Zero document-conversion code; reports page has no confirmed download path | `BROWSER_UX_TEST_RESULTS.md` §8 |
| Temporal | This session hit 2 real reliability bugs in ad-hoc async patterns (`after()`'s request-scope requirement, the AI dispatch pipeline's silent 40-iteration-cap failures) that durable workflow orchestration is built to prevent | PR #118's audit finding, `ai-workforce-agent.mjs` dispatch failures today |

## 2. Architecture decision (Super Boss's call, per explicit authorization to decide without asking)

**Revised 2026-07-10** — the original plan below assumed Fly.io hosting; live-tested and blocked: Fly.io now requires a credit card on file even for its free allowance (`We need your payment information to continue`, confirmed live via `flyctl apps create`). Boss's explicit direction: genuinely free, card-free hosting only.

**Vercel serverless functions cannot run any of these 6** — PaddlePaddle/Docling/Whisper.cpp/LibreOffice need heavy native runtimes or long-lived processes; Meilisearch and Temporal are servers, not functions.

**PaddleOCR + Docling + Whisper.cpp + LibreOffice (the 4 "process one document/image/audio file and return a result" tools)**: bundled into **one** `services/doc-processing/` container (built + pushed to ghcr.io via T0.3, already done), but run **on-demand inside a GitHub Actions job** instead of a persistent host — this repo is public, so Actions minutes are free and unlimited (already proven all session — dozens of dispatches today at zero cost/limit). A `repository_dispatch` (event type `doc-processing-job`) pulls the pre-built ghcr.io image, `docker run`s it against the job's input (a Supabase Storage signed URL or inline base64 for small files), and writes the result directly to Supabase (service role key, already a GitHub secret) rather than needing a public webhook endpoint. Cold-start cost (~30-60s per job: runner boot + image pull) is acceptable because this work is already async/background in every existing consumer (`after()`, `recordOrchestraExecution` patterns) — nothing in this codebase expects sub-second OCR/parsing today.

**Meilisearch + Temporal (genuine long-running, stateful servers — index storage / workflow history)**: this on-demand pattern does NOT work for them (a fresh container per request has no persistent state). They still need either a persistent host with a card, or a card-free managed SaaS with its own free tier (Meilisearch Cloud is the leading candidate, needs live verification of its card requirement before committing — same for Temporal Cloud). **Deferred, not blocked**: Phases 0-2, 4-5 (everything except Meilisearch/Temporal) proceed fully under the on-demand pattern; Phase 3 and Phase 6 wait for a specific card-free hosting answer, tracked as open items in §5.

**Division of labor**: `tool_integration_engineer` (GPT-OSS-120B) writes code — Dockerfiles, service wrapper source, Next.js client/dispatch code, docs. **Workflow files and any external account/secret provisioning are Super Boss's job** — see §4's hard rule on workflow files, and an LLM agent with repo-write tools cannot create external accounts regardless. Every task below is labeled `[AGENT]` or `[SUPERVISOR]`.

## 3. Task breakdown (small, one dispatch each)

### Phase 0 — shared foundation
- **T0.1** ~~Create Fly.io account~~ **Superseded** — Fly.io needs a card (§2). No external account needed under the on-demand GitHub Actions pattern; `ghcr.io` push already works via the existing `GITHUB_TOKEN`.
- **T0.2** `[AGENT]` Write `services/doc-processing/Dockerfile` — Python base image, installs PaddleOCR + Docling + a Whisper.cpp binary + LibreOffice (apt package `libreoffice`), exposes a FastAPI app on port 8080 with a `GET /health` endpoint returning `{"status":"ok"}`. No business logic yet — just the container skeleton + health check. **Done** (PR #125), plus 2 audit fixes found via real build testing: missing build toolchain (PR #125's own fix) and missing `swig` for whisper-cpp-python/PyMuPDF (PR #129).
- **T0.3** `[SUPERVISOR]` `.github/workflows/build-doc-processing-image.yml` — builds `services/doc-processing/Dockerfile` on changes to that path, pushes to `ghcr.io/fchecklist/veridian-doc-processing:latest` and `:${{ github.sha }}`. **Done** (PR #127), validated with 2 real build iterations (PRs #125, #129 above) before a clean build.
- **T0.4** `[SUPERVISOR]` (revised — on-demand pattern, not a persistent deploy) Write `.github/workflows/doc-processing-job.yml`: triggered by `repository_dispatch` (event type `doc-processing-job`), pulls `ghcr.io/fchecklist/veridian-doc-processing:latest`, runs it against the dispatch payload (operation type + input reference), writes the result to Supabase directly (service role key). This is the actual "deployment" for these 4 tools — no persistent host.

### Phase 1 — PaddleOCR (highest priority, confirmed gap)
- **T1.1** `[AGENT]` Add `POST /ocr` to the FastAPI app: accepts a base64 image, runs PaddleOCR, returns `{text: string, regions: [{text, confidence, bbox}], overallConfidence: number}` (overall = mean of region confidences). Add a unit test with a known sample image checked into `services/doc-processing/tests/fixtures/`.
- **T1.2** `[AGENT]` New `src/lib/services/ocr-client.ts` in the main Next.js app — triggers the on-demand pattern (§2, T0.4): `repository_dispatch` with `event_type: "doc-processing-job"` and a payload naming the operation (`ocr`) + input reference, then polls (or the job writes its own result + this function reads it back from Supabase, whichever T0.4 lands on) for completion. Typed request/response, retry-once-on-dispatch-failure (same pattern as `withRetry` used throughout this session's load-test harnesses). The container's `/ocr` HTTP endpoint (T1.1) is unchanged — it's invoked via `docker run` + `curl` *inside* the on-demand job, not called directly over the network from Vercel.
- **T1.3** `[AGENT]` Wire into `src/lib/services/document-extraction-service.ts`'s `extractDocumentContent()`: when the resolved model has no vision override (today's bug, fixed in PR #118 by falling back to `modelConfig.fallback` — this task adds a THIRD option ahead of that fallback chain), call OCR first to get raw text, then feed that text to the existing text-only GPT-OSS-120B/floor-tier model to structure it into `ExtractedDocumentData` — no vision-capable model needed at all for this path anymore. Confidence gate: if `overallConfidence < 0.95`, still write the extraction but flag `status: "needs_review"` (new value, or reuse the FM digitization pattern's pending/review flow) rather than silently accepting low-confidence output.
- **T1.4** `[AGENT]` Same OCR-first pattern for `src/lib/services/fm-register-digitization-service.ts`'s `parseAndExtractFromPhoto()`.
- **T1.5** `[SUPERVISOR]` Wire the `repository_dispatch` trigger. `src/lib/ai-team/dispatch-repo.ts` already expects a `GITHUB_DISPATCH_PAT` env var for exactly this kind of app-initiated dispatch (built earlier this session for AI Workforce triggering, **never actually provisioned** — confirmed live, `gh secret list` shows only `PAT_FCHECKLIST` exists) — this task is what finally adds it: generate a PAT with `repo` scope, store as `GITHUB_DISPATCH_PAT` in both Vercel env vars and GitHub Secrets. Live-verify: upload a real scanned document through the app, confirm OCR→structure→confidence-gate→table all work end to end, including realistic latency for the ~30-60s on-demand cold start.

### Phase 2 — Docling
- **T2.1** `[AGENT]` Add `POST /parse-document` to the FastAPI app: accepts a PDF/DOCX/PPTX, runs Docling, returns structured JSON (sections, tables as arrays, detected headings).
- **T2.2** `[AGENT]` Extend `ocr-client.ts` (or a new `docling-client.ts`, agent's call which is cleaner) with a `parseDocument()` function.
- **T2.3** `[AGENT]` Wire into `src/lib/ingest/parser.ts`'s PDF path — replace naive text extraction with Docling's structured output for tables specifically (fall back to existing naive extraction if Docling's call fails, don't regress the working path).

### Phase 3 — Meilisearch — **DEFERRED, see §5**
- **T3.1** `[SUPERVISOR]` Decide card-free persistent hosting (Meilisearch Cloud free tier is the leading candidate — needs live verification it doesn't require a card, same check that just failed for Fly.io) — document the decision and why in `docs/infra/meilisearch.md`. Provision whichever is chosen, store `MEILISEARCH_URL` + `MEILISEARCH_API_KEY` as secrets. **Not started — Meilisearch is a genuine persistent server (index storage), the on-demand GitHub Actions pattern (§2) doesn't apply to it.**
- **T3.2** `[AGENT]` New `src/lib/services/meilisearch-client.ts` — index/search wrapper functions.
- **T3.3** `[AGENT]` Extend `/api/search/semantic/route.ts`'s entity coverage (or add a sibling `/api/search/keyword` route) to also cover `users`, `tasks`, `clients`, and whatever else is cheap to add first — expand incrementally, not all 70+ modules in one task.
- **T3.4** `[AGENT]` Indexing pipeline: a small script/cron job that keeps Meilisearch's index in sync with new rows (start with a simple on-write hook, not a full CDC pipeline).

### Phase 4 — Whisper.cpp
- **T4.1** `[AGENT]` Add `POST /transcribe` to the FastAPI app: accepts a base64 audio file, runs Whisper.cpp, returns `{text, segments: [{start, end, text}]}`.
- **T4.2** `[AGENT]` Wire into `src/lib/services/veri-meeting-service.ts` — a new function taking a meeting recording, transcribing it, feeding the transcript into the existing `generateMeetingIntelligence()` LLM call instead of (or alongside) manually-entered minutes.

### Phase 5 — LibreOffice Headless
- **T5.1** `[AGENT]` Add `POST /convert` to the FastAPI app: accepts a file + target format, runs `libreoffice --headless --convert-to`, returns the converted file.
- **T5.2** `[AGENT]` Wire into the `/reports` page's export path (the browser test found no download affordance today — this task is what actually adds one) — generate a PDF/XLSX export via this service.

### Phase 6 — Temporal (last, biggest commitment) — **DEFERRED, see §5**
- **T6.1** `[SUPERVISOR]` Decide card-free persistent hosting for `temporalio/auto-setup` (self-hosted server + its own state store) vs. Temporal Cloud's trial terms — document the decision in `docs/infra/temporal.md`. **Not started — same persistent-server constraint as Meilisearch.**
- **T6.2** `[AGENT]` Define ONE real workflow first (not a framework migration): the exact 5-step OCR pipeline the Boss specified (read → extract → confidence-gate → populate table → trigger next task), as a Temporal workflow + activities, using the Phase 1 OCR client as one activity.
- **T6.3** `[SUPERVISOR]` Deploy, wire the workflow trigger into the document-upload path, live-verify.

## 4. Guardrails for every `tool_integration_engineer` dispatch

- One task from the list above per dispatch — never bundle phases.
- Every dispatch's task text quotes the exact task ID + description from this doc, so the agent's spec is unambiguous.
- Every PR audited by Super Boss before merge (same Rule 7c cross-audit already standard this session) — GPT-OSS-120B is smaller/cheaper than GLM-5.2, expect a higher rate of needed corrections, not a lower one.
- No task proceeds to the next phase until the previous phase's `[SUPERVISOR]` step is confirmed live-working — Phase 1 (PaddleOCR) is the proof of the whole pattern before Phases 2-6 repeat it.
- Real secrets never appear in task text, code, or commit messages — only referenced by env var / GitHub Secret name.
- **Never dispatch a task that creates or modifies a `.github/workflows/*.yml` file.** Confirmed live (T0.3's first attempt, 2026-07-10): GitHub hard-blocks the AI Workforce pipeline's own `GITHUB_TOKEN` from pushing any change to a workflow file (`refusing to allow a GitHub App to create or update workflow ... without workflows permission`) — a repo-level security boundary, not something a task-instruction rewrite or retry fixes. Every workflow-file task in §3 is `[SUPERVISOR]`.

## 5. Status

As of 2026-07-10:
- **Phase 0**: T0.2 (container skeleton) and T0.3 (build workflow) done and merged, validated via 2 real build-failure-fix iterations (hallucinated `paddlepaddle` version, missing `swig`). T0.1 superseded (Fly.io needs a card). T0.4 (on-demand dispatch workflow, revised architecture) — next up.
- **Phases 1, 2, 4, 5** (PaddleOCR, Docling, Whisper.cpp, LibreOffice): ready to proceed once T0.4 lands, using the on-demand GitHub Actions pattern.
- **Phase 3 (Meilisearch) and Phase 6 (Temporal): deferred.** Both need a genuine persistent, stateful host; Fly.io (the original plan) needs a card. Open question for Boss: add a card to Fly.io for just these two (their state genuinely needs it, unlike the other 4 tools), or find/confirm a card-free managed alternative (Meilisearch Cloud, Temporal Cloud) first.

This doc is the live source of truth — update task status here as each completes.
