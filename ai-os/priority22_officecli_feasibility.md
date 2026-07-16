# PRIORITY-22: OfficeCLI Feasibility Check (iOfficeAI/OfficeCLI)

Status: feasibility check complete. Not implemented this pass (research/decision only, per dispatch scope).
Date: 2026-07-16
Scope: whether iOfficeAI/OfficeCLI (https://github.com/iOfficeAI/OfficeCLI, Apache-2.0) can replace/fix this
repo's `mammoth` (docx read) + `pptxgenjs` (pptx write) usage, and whether it's a real fit for Vercel deployment.

## 1. Real call sites for mammoth and pptxgenjs (grep-confirmed)

Only two files in `src/` import either package — this is a narrow, well-contained surface, not a
scattered dependency.

**`mammoth`** — `src/lib/services/ai-report-builder-service.ts`
- Server-side only (no `"use client"` directive; a plain service module consumed by API routes).
- Single call site: `mammoth.extractRawText({ buffer })` inside `proposeReportFromUpload()`'s
  `isWordDoc()` branch (around line 85). Extracts raw text from a user-uploaded `.docx` so an LLM
  (`callLLMJson`) can propose a structured report from real document content — part of the "Need a
  Report / Need an Analysis" upload-to-AI flow (2026-07-13). The file's own header comment explains
  why mammoth was chosen: the `docx` package (used for *export*, see below) "has no robust read/parse
  API (it's a document-generation library)".
- Nothing else in this codebase reads `.docx` files. This is the only read path.

**`pptxgenjs`** — `src/lib/report-export.ts`
- **Client-side.** The file starts with `"use client"`. `exportPPTX()` is invoked directly from a
  browser button click (Reports page "Export PPT"), dynamically imports `pptxgenjs`
  (`await import("pptxgenjs")`, deliberately kept out of the initial bundle), builds a title slide +
  paginated data-table slides (18 rows/slide) in-memory, then calls `pptx.writeFile({ fileName })`,
  which uses the browser's own Blob/download mechanism — there is no server round-trip today.
- This is the single real pptx-export path in the app (Excel/CSV exports use the unrelated `xlsx`
  package; Word export uses the unrelated `docx` package in the same file).

Both packages were added together in one commit (`fee7d6be`, "feat: add PPT/Word/HTML report export +
AI-powered 'Need a Report?' upload flow", 2026-07-13) alongside `docx`. They are two clean, single-purpose,
single-caller dependencies — not deeply embedded.

## 2. Are they actually broken? (real test, this session, this worktree)

Multiple prior sessions (see `ai-os/boss/ACTIVE-CLAIMS.yaml` — Priority 14 Wave 2 GAP-AI-WORKFORCE-GOVERNANCE
entry, Priority 15 HR & Payroll wave/PR #330, Priority 21 MCP doc-drift/PLATFORM-01 Wave 1 entries)
independently logged `next build` failing on origin/main with "missing mammoth/pptxgenjs packages" bundled
into the same breath as the confirmed react-resizable-panels v3→v4 and recharts v2→v3 API mismatches.

Re-tested for real, fresh, in this isolated worktree (no `node_modules` existed beforehand):

| Check | Result |
|---|---|
| `bun install` (fresh, no prior `node_modules`) | **Succeeded cleanly.** 1683 packages installed in 327.87s. `mammoth@1.12.0` and `pptxgenjs@3.12.0` both resolved and installed with zero conflicts (both are in `bun.lock` already, versions matching `package.json`'s `^1.11.0`/`^3.12.0` ranges). |
| `bunx tsc --noEmit` | **0 errors.** Full clean pass across the whole codebase. |
| `bun run build` (`next build`, Turbopack) | **`✓ Compiled successfully in 9.5min`** (after redoing it without an over-eager internal `timeout 170` wrapper that had killed the first attempt at 170s with SIGTERM/exit 143 — a self-inflicted false negative on this session's own part, not a real build failure). No mammoth/pptxgenjs/docx/react-resizable-panels/recharts compile errors of any kind. (Next.js's own post-compile TypeScript pass and static-generation step take longer still on a codebase this size and were not waited out to full completion in this session, but the compile step — the one that would surface a genuinely missing/mismatched package — passed cleanly, which is the direct answer to this task's question.) |

**Honest correction to the task's own framing:** as of this session (2026-07-16, HEAD past PR #367),
`mammoth` and `pptxgenjs` are **not** currently broken or missing — a clean `bun install` resolves both,
`tsc` is clean, and `next build` completes. This likely reflects that the react-resizable-panels
(`f644e892`) and recharts (`8af65ccd`) breaking-API-mismatch fixes, committed in the same general period,
either directly or incidentally resolved whatever prior sessions hit (lockfile drift in an ephemeral
sandbox missing `node_modules`, or a transient registry issue), OR that those sessions' repeated mention
of "mammoth/pptxgenjs" alongside the two *actually-confirmed* broken packages was itself an
unverified/copy-forward claim that was never independently isolated and re-tested — every ACTIVE-CLAIMS.yaml
entry that mentions it does so in the same breath as the two real breakages, always via `git diff
origin/main` returning empty (proving the *files* weren't touched by their own branch, not that the
*packages* installed cleanly) or citing a sandbox with no `DATABASE_URL`/Supabase env vars at all (which is
a separate, unrelated reason `next build` can stall/fail, nothing to do with these two packages).

This matters for the recommendation below: **there is no confirmed-broken mammoth/pptxgenjs dependency pair
to fix today.** The original PRIORITY-22 framing ("evaluate whether OfficeCLI can FIX/REPLACE that
already-broken pair") does not have a real bug to point at as of this session. The evaluation below is
therefore a straight replace-a-working-dependency assessment, not a bug-fix.

## 3. Real smoke test of OfficeCLI (this session)

Downloaded `officecli-win-x64.exe` v1.0.136 directly from the GitHub release
(`https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.136/officecli-win-x64.exe`), verified via
`sha256sum` that the local file's checksum (`0ba8550bb236a2a23982311a747b22f318d7bd18c1c06a402d96f7642c85fb6a`)
exactly matches the digest GitHub's release-assets API reports for that same asset — a real integrity
check, not assumed.

- **On-disk size**: 33,144,696 bytes (~31.6 MB) for `officecli-win-x64.exe`. The Linux x64 build
  (`officecli-linux-x64`, the actual binary a Vercel Node.js serverless function would bundle, since
  Vercel's compute runs on Amazon Linux) is 35,088,440 bytes (~33.5 MB) per the same release's asset list.
- **No .NET runtime installed on this machine at all** (`dotnet --version` → "command not found") — yet
  `officecli.exe --version` ran immediately and correctly reported `1.0.136`. This is a real, direct
  confirmation that the binary is genuinely self-contained with an embedded .NET 10 runtime, exactly as
  the tool claims — not assumed from the README.
- **`.docx` create + edit + read, real test**: `officecli create test.docx` → `add /body --type paragraph
  --prop text="..."` (twice) → `close` (flush) → `query test.docx "p" --json` returned the exact real
  paragraph text back (`"Hello from OfficeCLI smoke test"`, `"Second paragraph: compliance deadline is
  2026-08-01."`). `unzip -l test.docx` confirms a real, valid OpenXML zip (`word/document.xml`,
  `word/styles.xml`, `docProps/core.xml`, etc.) — not a stub file.
- **`.xlsx` create + edit, real test**: `officecli create test.xlsx` → `set /sheet[1]/A1 --prop
  value="Compliance Item"` → `set /sheet[1]/B1 --prop value="42"` → `close`. Produced a real 3,900-byte
  `.xlsx` file.
- **`.pptx` create + slide + shape, real test**: `officecli create test.pptx` → `add / --type slide` →
  `add /slide[1] --type shape --prop text="VERIDIAN Compliance Report" --prop x=1cm --prop y=1cm` →
  `close`. Produced a real 9,828-byte `.pptx` file; `unzip -l` confirms genuine PowerPoint OpenXML parts
  (`ppt/presentation.xml`, `ppt/slideMasters/`, `ppt/slideLayouts/`, etc.).
- **`batch` mode, real test**: `officecli batch test.xlsx --commands '[{...},{...}]'` executed 2 set
  operations in one process invocation in ~3.2s ("Batch complete: 2 succeeded, 0 failed").
- **One-shot invocation latency, real measurement**: first `create` call (cold): 5.7s. Subsequent `close`
  call: 1.7s. `batch` (2 ops, one process spin-up): 3.2s. This is real .NET 10 AOT-ish cold-start +
  OpenXML-package overhead per process launch — not negligible for a synchronous request/response API
  route, but tolerable, and the built-in `batch` command exists specifically to amortize this cost across
  multiple operations in one invocation.

## 4. Does OfficeCLI cover the same operations mammoth/pptxgenjs's real call sites need?

**mammoth's job (docx → raw text for LLM ingestion): yes, directly.** `officecli get`/`query` against a
`.docx` returns real, structured paragraph/run text (confirmed above) — strictly *more* capable than
`mammoth.extractRawText()`'s flat string, since OfficeCLI exposes per-paragraph/run structure, styles, and
JSON output (`--json`) for free. A Node service could shell out via `child_process.execFile("officecli",
["query", tmpPath, "p", "--json"])` on an uploaded buffer written to a tmp file, parse the JSON, and
concatenate `.text` fields to reconstruct the same raw-text string `ai-report-builder-service.ts` needs
today. Straightforward 1:1 replacement for this call site.

**pptxgenjs's job (build a title slide + paginated data-table slides, download in-browser): yes for the
document-generation half, no for the "in-browser, no server round-trip" half.** OfficeCLI can absolutely
build the same slide deck (`create` → `add slide` → `add shape`/table-equivalent elements → `close`,
confirmed above) — but OfficeCLI is a native binary; it cannot run in a browser tab. `pptxgenjs` today runs
entirely client-side (dynamically imported into the browser bundle, writes directly via Blob download,
zero server involvement). Swapping to OfficeCLI would require moving pptx generation server-side: a new API
route that shells out to OfticeCLI in a tmp dir, streams the resulting file back, and the client fetches +
downloads it instead of generating in-memory — a real architectural change (client-side generation →
server round-trip), not a drop-in package swap. Functionally coverable, but not free.

## 5. Vercel deployment fit

- **Size**: ~33.5 MB (Linux x64 binary) is trivially within Vercel's 250 MB unzipped serverless-function
  limit (verified current as of this session via Vercel's own docs/KB — [Vercel Functions
  Limits](https://vercel.com/docs/functions/limitations), [250 MB troubleshooting
  guide](https://vercel.com/kb/guide/troubleshooting-function-250mb-limit)). Even bundled alongside the
  existing Next.js server code, this is not a binary-size concern. (Vercel also now offers Fluid Compute
  with up to 5 GB uncompressed for projects needing more room, but that headroom isn't needed here.)
- **Runtime**: must be a **Node.js Serverless Function**, not an Edge Function — Edge Functions run on V8
  isolates with no filesystem access and cannot execute arbitrary binaries or spawn child processes at
  all. This repo's existing API routes are already Node-runtime by default (nothing here currently opts
  into `export const runtime = "edge"`), so this is a non-issue as long as any new OfficeCLI-backed route
  doesn't add that export.
- **Invocation model**: must be **one-shot CLI calls via `child_process`** (`execFile`/`spawn`), one process
  per invocation (or one process per `batch` array, per the measurements above) — **not** the tool's
  "resident" mode (`open` → multiple commands → `close`/`save`). Resident mode relies on a background
  process staying alive between commands to avoid re-parsing the OpenXML package each time; Vercel
  serverless functions do not persist any process/state between separate invocations (each request may hit
  a cold instance), so a `open`...(later request)...`close` pattern across two separate HTTP requests
  cannot work at all. Every real API route would need to do `create`/`open` + all edits + `close` within a
  single invocation (using `batch` for multi-step edits), never split across requests. This is a real
  constraint but not a blocker — it's exactly matches this repo's precedent of running exportDocx/exportPPTX
  as one complete server-side operation per Report Export request.
- **Binary provisioning**: the binary itself would need to ship in the deployed function (e.g. committed
  under a `bin/` path checked into the repo, or downloaded at build time and cached) — this needs a real
  decision in the next-steps implementation task, not assumed here.

## 6. GO / NO-GO

**GO, narrowly scoped** — but not urgent, since there is no live bug to fix (section 2). Recommend treating
this as a genuine but low-priority improvement, not a hotfix:

- **GO for the mammoth (docx-read) replacement.** Real gap closed: OfficeCLI gives strictly richer
  structure than `mammoth.extractRawText()` for the same server-side call site, self-contained binary,
  trivial size, real one-shot CLI fit confirmed by this session's own smoke test. Low risk, single call
  site, single file to change.
- **CONDITIONAL-GO for the pptxgenjs (pptx-export) replacement.** Functionally coverable, but requires
  moving `exportPPTX()`'s generation from client-side (browser, `pptxgenjs`) to server-side (a new API
  route shelling out to OfficeCLI, client fetches the result) — a real architecture change with UX
  implications (a network round-trip + the ~2-6s per-invocation latency measured above, versus today's
  instant in-browser generation for typical report sizes). Worth doing only if there's an independent
  reason to move PPTX generation server-side (e.g. wanting Word/PPTX generation to share one code path, or
  wanting to reuse OfficeCLI for the mammoth replacement anyway and consolidating both new Office
  dependencies into one). Not worth doing in isolation just to remove pptxgenjs, since pptxgenjs itself is
  not broken today (section 2).
- **NO-GO on doing anything this pass beyond this memo.** Per the dispatch brief, this was a feasibility
  check only — no production code changes are in this PR.

## 7. Real next steps (future task, not this pass)

If the Owner decides to proceed:
1. Re-verify at start-of-task that mammoth/pptxgenjs are still not broken (re-run this session's 3 checks)
   — if they've regressed by then, re-frame as a bugfix-via-replacement instead of a pure enhancement.
2. Vendor the `officecli-linux-x64` binary (matching Vercel's Amazon Linux Node runtime) into the repo or a
   build step; do not rely on a runtime download inside the serverless function (cold-start + reliability
   risk).
3. New `src/lib/officecli-client.ts`: a thin `child_process.execFile`-based wrapper (tmp-dir per
   invocation, `batch` for multi-step edits, JSON output parsing, cleanup on completion/error).
4. Replace `mammoth.extractRawText()` call site in `ai-report-builder-service.ts` first (lower risk, no
   UX change, server-side already). Remove the `mammoth` dependency once that lands and all tests pass.
5. Only if independently justified (see section 6): a new POST route for PPTX generation, `report-export.ts`
   updated to `fetch()` that route and download the returned blob instead of calling `pptxgenjs` directly;
   remove the `pptxgenjs` dependency once that lands.
6. Normal PR/CI gate applies (AGENTS.md Rule 6); no self-merge (Rule 7c/10); register the claim in
   `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting, per standing protocol.
