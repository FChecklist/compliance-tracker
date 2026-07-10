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

**Vercel serverless functions cannot run any of these 6** — PaddlePaddle/Docling/Whisper.cpp/LibreOffice need heavy native runtimes or long-lived processes; Meilisearch and Temporal are servers, not functions. All 6 run **outside Vercel**, in Docker containers, built via GitHub Actions and pushed to **GitHub Container Registry (ghcr.io, free for this)**, deployed to **Fly.io** (free allowance, Docker-native, supports persistent volumes for Meilisearch's index and Temporal's state) unless a specific tool's own free-tier SaaS is clearly simpler (e.g., Meilisearch Cloud) — that call gets made per-tool during its own implementation task, documented in that tool's `docs/infra/<tool>.md`.

**Combined vs. separate services**: PaddleOCR + Docling + Whisper.cpp + LibreOffice are bundled into **one** `services/doc-processing/` container (all four are "read this file, give me structured output" tools with overlapping Python/native dependencies — one container is less operational overhead than four). Meilisearch and Temporal are genuine standalone servers with official Docker images — each gets its own deployment.

**Division of labor**: `tool_integration_engineer` (GPT-OSS-120B) writes code — Dockerfiles, service wrapper source, CI YAML, Next.js client code, docs. **Creating the actual Fly.io/GitHub Container Registry accounts, running real deploy commands, and storing real secrets is Super Boss's job** — an LLM agent with repo-write tools cannot create external accounts. Every task below is labeled `[AGENT]` (GPT-OSS-120B writes this) or `[SUPERVISOR]` (Super Boss does this directly).

## 3. Task breakdown (small, one dispatch each)

### Phase 0 — shared foundation
- **T0.1** `[SUPERVISOR]` Create Fly.io account, generate deploy API token, store as `FLY_API_TOKEN` GitHub secret. Create `ghcr.io` push access (uses existing `GITHUB_TOKEN`, no new secret needed).
- **T0.2** `[AGENT]` Write `services/doc-processing/Dockerfile` — Python base image, installs PaddleOCR + Docling + a Whisper.cpp binary + LibreOffice (apt package `libreoffice`), exposes a FastAPI app on port 8080 with a `GET /health` endpoint returning `{"status":"ok"}`. No business logic yet — just the container skeleton + health check.
- **T0.3** `[AGENT]` Write `.github/workflows/build-doc-processing-image.yml` — builds `services/doc-processing/Dockerfile` on changes to that path, pushes to `ghcr.io/fchecklist/veridian-doc-processing:latest` and `:${{ github.sha }}`.
- **T0.4** `[SUPERVISOR]` First build + deploy of the skeleton service to Fly.io, confirm `/health` responds. Document the app name/URL in `docs/infra/doc-processing-service.md` (new file, agent creates the skeleton in T0.2's docs requirement, supervisor fills in the real deployed URL).

### Phase 1 — PaddleOCR (highest priority, confirmed gap)
- **T1.1** `[AGENT]` Add `POST /ocr` to the FastAPI app: accepts a base64 image, runs PaddleOCR, returns `{text: string, regions: [{text, confidence, bbox}], overallConfidence: number}` (overall = mean of region confidences). Add a unit test with a known sample image checked into `services/doc-processing/tests/fixtures/`.
- **T1.2** `[AGENT]` New `src/lib/services/ocr-client.ts` in the main Next.js app — calls the deployed service's `/ocr` endpoint (`DOC_PROCESSING_SERVICE_URL` env var), typed request/response, retry-once-on-network-error (same pattern as `withRetry` used throughout this session's load-test harnesses).
- **T1.3** `[AGENT]` Wire into `src/lib/services/document-extraction-service.ts`'s `extractDocumentContent()`: when the resolved model has no vision override (today's bug, fixed in PR #118 by falling back to `modelConfig.fallback` — this task adds a THIRD option ahead of that fallback chain), call OCR first to get raw text, then feed that text to the existing text-only GPT-OSS-120B/floor-tier model to structure it into `ExtractedDocumentData` — no vision-capable model needed at all for this path anymore. Confidence gate: if `overallConfidence < 0.95`, still write the extraction but flag `status: "needs_review"` (new value, or reuse the FM digitization pattern's pending/review flow) rather than silently accepting low-confidence output.
- **T1.4** `[AGENT]` Same OCR-first pattern for `src/lib/services/fm-register-digitization-service.ts`'s `parseAndExtractFromPhoto()`.
- **T1.5** `[SUPERVISOR]` Add `DOC_PROCESSING_SERVICE_URL` to Vercel env vars + GitHub Secrets. Live-verify: upload a real scanned document through the app, confirm OCR→structure→confidence-gate→table all work end to end.

### Phase 2 — Docling
- **T2.1** `[AGENT]` Add `POST /parse-document` to the FastAPI app: accepts a PDF/DOCX/PPTX, runs Docling, returns structured JSON (sections, tables as arrays, detected headings).
- **T2.2** `[AGENT]` Extend `ocr-client.ts` (or a new `docling-client.ts`, agent's call which is cleaner) with a `parseDocument()` function.
- **T2.3** `[AGENT]` Wire into `src/lib/ingest/parser.ts`'s PDF path — replace naive text extraction with Docling's structured output for tables specifically (fall back to existing naive extraction if Docling's call fails, don't regress the working path).

### Phase 3 — Meilisearch
- **T3.1** `[SUPERVISOR]` Decide self-hosted (Fly.io + official Meilisearch Docker image + persistent volume) vs. Meilisearch Cloud free tier — research both during this task, document the decision and why in `docs/infra/meilisearch.md`. Provision whichever is chosen, store `MEILISEARCH_URL` + `MEILISEARCH_API_KEY` as secrets.
- **T3.2** `[AGENT]` New `src/lib/services/meilisearch-client.ts` — index/search wrapper functions.
- **T3.3** `[AGENT]` Extend `/api/search/semantic/route.ts`'s entity coverage (or add a sibling `/api/search/keyword` route) to also cover `users`, `tasks`, `clients`, and whatever else is cheap to add first — expand incrementally, not all 70+ modules in one task.
- **T3.4** `[AGENT]` Indexing pipeline: a small script/cron job that keeps Meilisearch's index in sync with new rows (start with a simple on-write hook, not a full CDC pipeline).

### Phase 4 — Whisper.cpp
- **T4.1** `[AGENT]` Add `POST /transcribe` to the FastAPI app: accepts a base64 audio file, runs Whisper.cpp, returns `{text, segments: [{start, end, text}]}`.
- **T4.2** `[AGENT]` Wire into `src/lib/services/veri-meeting-service.ts` — a new function taking a meeting recording, transcribing it, feeding the transcript into the existing `generateMeetingIntelligence()` LLM call instead of (or alongside) manually-entered minutes.

### Phase 5 — LibreOffice Headless
- **T5.1** `[AGENT]` Add `POST /convert` to the FastAPI app: accepts a file + target format, runs `libreoffice --headless --convert-to`, returns the converted file.
- **T5.2** `[AGENT]` Wire into the `/reports` page's export path (the browser test found no download affordance today — this task is what actually adds one) — generate a PDF/XLSX export via this service.

### Phase 6 — Temporal (last, biggest commitment)
- **T6.1** `[SUPERVISOR]` Decide self-hosted (`temporalio/auto-setup` Docker image, single-binary dev-mode server, Fly.io-hosted) vs. Temporal Cloud trial — document the decision in `docs/infra/temporal.md`.
- **T6.2** `[AGENT]` Define ONE real workflow first (not a framework migration): the exact 5-step OCR pipeline the Boss specified (read → extract → confidence-gate → populate table → trigger next task), as a Temporal workflow + activities, using the Phase 1 OCR client as one activity.
- **T6.3** `[SUPERVISOR]` Deploy, wire the workflow trigger into the document-upload path, live-verify.

## 4. Guardrails for every `tool_integration_engineer` dispatch

- One task from the list above per dispatch — never bundle phases.
- Every dispatch's task text quotes the exact task ID + description from this doc, so the agent's spec is unambiguous.
- Every PR audited by Super Boss before merge (same Rule 7c cross-audit already standard this session) — GPT-OSS-120B is smaller/cheaper than GLM-5.2, expect a higher rate of needed corrections, not a lower one.
- No task proceeds to the next phase until the previous phase's `[SUPERVISOR]` step is confirmed live-working — Phase 1 (PaddleOCR) is the proof of the whole pattern before Phases 2-6 repeat it.
- Real secrets never appear in task text, code, or commit messages — only referenced by env var / GitHub Secret name.

## 5. Status

Phase 0 in progress as of 2026-07-10. This doc is the live source of truth — update task status here as each completes.
