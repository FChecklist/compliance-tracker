# PROGRESS -- task-20260718-171002-cognitive-architecture--cognitive-consis

VERIDIAN Review Framework gap-closure: Cognitive Architecture / Cognitive
Consistency & Maturity (4 findings). All 4 addressed in this branch/PR --
they share the same module/area (Orchestra/loops/AI-provider-call
plumbing), matching the task's own "one coherent PR" guidance.

Re-read each finding's actual current implementation before changing
anything, per the task's instruction -- none of the 4 were already
resolved, but the recommended approaches were adapted where the real code
differed from what the finding assumed (see notes per item below).

## Completed

- [x] **[Low] Cognitive AI Operating System Consistency** -- embeddings.ts
      and whisper-client.ts had zero retry/cost-tracking parity with
      callLLM's own call sites, confirmed by reading both files fresh.
      - `withRetry()` (llm-client.ts) is now exported and reused directly
        (not reimplemented) by both files' HTTP calls -- same 429/5xx/
        network retry+backoff policy as every callLLM call site.
      - `embeddings.ts`: successful OpenRouter/Groq embedding calls now log
        to `token_usage_ledger` via `logTokenUsage()` (scope
        `product_orchestra`, layerKey `embeddings_direct`). Added a real
        `openai/text-embedding-3-small` pricing row to llm-client.ts's
        MODEL_PRICING; left `nomic-embed-text` unpriced with an honest
        comment (Groq doesn't publish per-token pricing for it) rather than
        guessing.
      - `whisper-client.ts`: added `estimateWhisperCostUsd()` (pure,
        per-minute-of-audio, matches OpenAI's real Whisper pricing) --
        deliberately NOT a DB write inside whisper-client.ts itself, to
        preserve its own established "pure HTTP, fully fetch-mockable, no
        DB" test posture (whisper-client.test.ts). voice-ticket-service.ts
        (which already owns DB/orgId context) calls it and logs via
        `logTokenUsage()` with a new `estimatedCostUsdOverride` field
        (token-usage-service.ts) since Whisper isn't token-priced.
      - All 4 touched/created files pass `tsc --noEmit` and existing tests
        (whisper-client.test.ts, llm-client.test.ts,
        voice-ticket-service.test.ts all green).

- [x] **[Medium] Human-in-Control Architecture** -- confirmed the Phase 3
      Intent Engine really is still deferred (high-impact-action-detector.ts
      is still the deterministic keyword stand-in) and there was genuinely
      no false-negative tracking anywhere.
      - New `src/lib/loops/high-impact-miss-audit.ts`: re-runs the
        deterministic detector against a rolling 24h window of tasks,
        samples up to 25 of the ones it did NOT gate, and asks an LLM
        (task_oa layer, new `high_impact_miss_audit.judgment` prompt
        template, drizzle/0225) whether each one actually describes one of
        the 9 high-impact categories. Records one summary row per run via
        `proposeLoopImprovement()` (loopId `high_impact_miss_audit`,
        targetId `phase3_intent_engine_decision`) with
        `{judged, missed, rate, recommendPhase3, examples}` -- a real,
        queryable trend a human can use to decide if Phase 3 is warranted,
        reviewable through the new review queue below. Wired into the
        existing daily loops cron (`/api/internal/loops/run/route.ts`),
        piggybacked the same way `capabilityIndexFreshnessAudit` was --
        not one of the 15 canonical loops, so no new cron entry needed.
      - Honest limitation stated in the file's own header: this assumes
        the detector's TRIGGERS list hasn't changed within the 24h scan
        window, since detection is recomputed retrospectively rather than
        persisted at task-creation time (no such column existed to read).

- [x] **[High] Continuous Software Evolution** -- confirmed
      `loop_improvements` is still write-only: `isDeployed` has no path to
      ever become true (loop-improvement-proposer.ts's own comment already
      said so), and every existing reader (ai-performance-report-service.ts,
      d1-metrics-tracker-service.ts, report-cadence-service.ts) only
      aggregates counts/deltas -- no UI/API surfaced an individual row.
      - drizzle/0225 adds 4 additive/nullable columns to `loop_improvements`
        (`review_decision`, `reviewed_by`, `reviewed_at`, `review_notes`) --
        the decision trail, not an auto-apply mechanism (what a fix even
        means varies per loop/targetType; building a generic auto-apply
        engine across all of them is real, separate, deferred work).
      - New `src/lib/services/loop-improvement-review-service.ts` (list/
        approve/dismiss, veridian_admin-gated) + API routes
        `/api/orchestra/loop-improvements` (GET) and
        `/api/orchestra/loop-improvements/[id]` (POST action=approve|
        dismiss) + a new page `/orchestra/loop-improvements`, linked from
        the Orchestra root page. Deliberately mirrors the existing
        `/capability-improvements` page's exact review-queue pattern
        (filter -> card list -> action dialog with a required reason on the
        negative action) rather than inventing a new UI shape.

- [x] **[Medium] Cognitive Maturity Score** -- read AI_OS_CERTIFICATION.md
      fresh: the 51-category scoring mechanism + Part 5 gate are real and
      current; "Overall gate result: FAIL" is the honestly-low score the
      finding refers to. Confirmed it had been run exactly once (2026-07-04)
      with no scheduled re-run.
      - Added a "Recertification cadence" section to the top of
        AI_OS_CERTIFICATION.md: quarterly cadence, next pass due 2026-10-04,
        a changelog block, and instructions for what a pass does (re-check
        every category, not just trust prior ratings -- several have already
        flipped between ad-hoc fixes).
      - Added `GAP-COGNITIVE-MATURITY-RECERT` to
        `ai-os/MASTER-TRACKER.yaml`'s `real_gaps_not_yet_built` so the due
        date surfaces the same way every other open governance item does,
        not just inside the one doc. YAML re-verified parseable
        (`python3 -c "import yaml; yaml.safe_load(...)"`).

## Verification run this pass
- `bun install` (node_modules wasn't present at task start in this
  worktree) -- 1691 packages, clean.
- `tsc --noEmit` on the full project: 0 errors (first attempt OOM'd on the
  default heap size under this sandbox's constrained memory; re-ran with
  `NODE_OPTIONS=--max-old-space-size=4096`, clean pass, unrelated to any
  change here).
- `eslint` on every touched/created file: clean.
- `bun test` on whisper-client.test.ts, llm-client.test.ts,
  voice-ticket-service.test.ts, high-impact-action-detector.test.ts: 28/28
  pass.
- No `permission-service.ts` / `ERP_ACTION_ROLES` changes -- not touched,
  per the task's explicit instruction.

## Remaining
- [ ] None for this task's 4 findings -- ready for PR.
- [ ] Not this task's scope, noted for whoever picks up
      GAP-COGNITIVE-MATURITY-RECERT on 2026-10-04: actually run the next
      certification pass.
