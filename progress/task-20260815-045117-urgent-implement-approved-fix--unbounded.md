# task-20260815-045117-urgent-implement-approved-fix--unbounded

Governing parent: UMR-20260806-071025-1d28
Proposal: 86 (child UMR-20260806-135902-cf13, investigation)
Own execution UMR (per DETERMINISTIC BRIEFING): UMR-20260806-141250-1ceb

## Finding: this is a duplicate dispatch of already-completed, already-deployed work

Step zero of the SPEC (mandatory dedup check) found that **this exact UMR
(UMR-20260806-141250-1ceb) already completed this work on 2026-08-06**, via
a PR that is merged into `main` and live-deployed in the running
`/opt/veridian/scripts` checkout right now. Real evidence gathered before
writing any code:

1. `resource_governor.py --query-umr --search "proposal 86"` / `--search
   "cf13"` turned up `UMR-20260806-161535-f530` (a *different*, later
   proposal-107 backfill child UMR) whose own `reason` field explicitly
   names `proposal 86/PR #176` as the "future-writes-only" fix this SPEC
   describes.
2. `gh pr view 176 --repo FChecklist/veridian-scripts` — title/branch
   `fix/reuse-check-unbounded-metadata-umr20260806141250-1ceb`, **MERGED**
   2026-08-06T16:36:44Z. PR body matches this SPEC's incident numbers
   verbatim (2034MB→4067MB in ~11min, umr_tasks 1855.7MB, 8441-item wiring
   match list, ~5.97MB field).
3. `git log --all` in `/opt/veridian/scripts` shows commit `4d0a0b0
   "fix(reuse-check): bound unbounded FTS lookups + metadata_json embedding
   (UMR-20260806-141250-1ceb)"`, merged via `3995c07` (PR #176 merge
   commit).
4. `git merge-base --is-ancestor 3995c07 HEAD` in the live
   `/opt/veridian/scripts` checkout (currently on `main` @ `f57c160`) →
   **YES, ancestor** — the fix is not just merged, it's the actual code
   running live today.
5. Live file content confirms both halves are present and active:
   - `superboss-register.py:2640-2641`: `WIRING_LOOKUP_MATCH_LIMIT = 50`,
     `KNOWLEDGE_QUERY_MATCH_LIMIT = 50`, applied via `LIMIT ?` on both the
     `wiring_registry_fts` query (`lookup_entity()`, ~line 3997) and the
     `knowledge_engine_fts` query (`query_knowledge()`, ~line 2665).
   - `plan_generator.py:190`: `EMBEDDED_MATCH_SUMMARY_LIMIT = 10`,
     independently truncates every match list
     `check_reuse_before_dispatch()` embeds into `metadata_json`, plus a
     `total_matches` count and a `matches_truncated` boolean per section —
     so a future caller reaching the registries a different way, or a
     regression reverting the query-side LIMIT, still can't blow up
     `metadata_json`.
   - `tests/test_reuse_check_unbounded_metadata_fix.py` exists, 322 lines,
     seeds a real 3000-row synthetic `wiring_registry` via the real
     `register_entity_row()` insert path and proves both bounds hold
     end-to-end. Ran it live: `python3 -m pytest
     tests/test_reuse_check_unbounded_metadata_fix.py -q` → **4 passed**.

This satisfies the SPEC's own step-zero instruction: *"stop and report if a
genuinely live fix effort already exists"* — except stronger, it's not
merely "in progress," it's complete, merged, tested, and running in
production right now. Re-implementing it would produce an empty/no-op diff
against `/opt/veridian/scripts` (nothing left to change) and would not be
honest work.

## Step four (before/after proof), done live against the real production DB

Real source-of-truth DB path (via `superboss-register.py`'s own
`resolve_superboss_db_path()`): `/opt/veridian/ai-os/memory/superboss-register.sqlite`.

**Database file size:**
- At incident time (2026-08-06, per SPEC): 2034MB → 4067MB in ~11 min.
- Right now (2026-08-15, this task's real live measurement): **2,354,958,336
  bytes (≈2246MB / 2.2G)** — well below the incident peak; growth from the
  unbounded query has stopped (other unrelated maintenance/reconciliation
  work over the intervening 9 days also touched this DB, so this number
  isn't a pure "fix-only" delta, but it directly falsifies the "keeps
  accelerating" trajectory the SPEC warned about).

**Per-dispatch `metadata_json` size** (queried live,
`length(metadata_json)` in bytes, `umr_tasks` rows carrying
`reuse_check_result`):
- **Before the fix** (5 largest pre-fix rows, all timestamped 2026-08-06
  before the fix landed): 7,128,106 / 7,110,799 / 6,970,888 / 6,934,965 /
  6,915,398 bytes (**~6.9–7.1MB each**, matching the SPEC's own "6.7 to
  7.1MB" claim).
- **After the fix** (10 most recent real dispatches, today 2026-08-15,
  04:15–04:53 UTC): 73,395 / 110,892 / 95,676 / 90,980 / 113,995 / 88,815 /
  88,263 / 87,276 / 87,336 / 88,510 bytes (**~73–114KB each** — roughly
  **60–95× smaller**, three orders of magnitude off the pre-fix ~7MB).
- Inspected the single most recent row's `reuse_check_result` structure
  directly: `wiring.matches` len=10, `total_matches`=50,
  `matches_truncated`=true; `knowledge.matches` len=10, `total_matches`=50,
  `matches_truncated`=true; `capability`/`system_index_search` under their
  natural counts (3 and 5) and correctly untruncated. This confirms **both**
  layers are live simultaneously today: the query-side LIMIT 50 bounds what
  `lookup_entity()`/`query_knowledge()` fetch, and the independent
  embed-side cap of 10 bounds what actually lands in the stored row — proof
  the "fix one path, other stays exploitable" failure mode the SPEC warned
  about (step two) is closed.

## LIMIT justification (as implemented in the already-merged fix, restated here since SPEC requires it be stated)

`WIRING_LOOKUP_MATCH_LIMIT` / `KNOWLEDGE_QUERY_MATCH_LIMIT = 50`: FTS5's own
`ORDER BY rank` already sorts most-relevant-first, so the top 50 keeps far
more candidates than a human/agent reviewer could usefully scan as "possible
duplicates to check" (realistically tops out around 5-10 before ceasing to
be a useful signal), while staying generous enough that a real near-duplicate
essentially never gets pushed out of a top-50 rank-ordered slice by noise.
`EMBEDDED_MATCH_SUMMARY_LIMIT = 10` (deliberately smaller than the 50):
bounds only what's permanently stored on a `umr_tasks` row for
accountability — a human/PM skimming `metadata_json` needs a few concrete
examples plus a `total_matches` count, not fifty.

## Mandatory condition honored

No existing row's `metadata_json` was read for mutation, deleted, rewritten,
compacted, vacuumed, or truncated by this task. The `SELECT
length(metadata_json)` queries above are read-only size probes against the
live DB via the real Python sqlite3 module (no write statements issued);
nothing was written back. The one-off scratch `.py` files used to run those
read-only queries were deleted immediately after use and were never
committed.

## Root cause of the duplicate dispatch (found via `--query-umr --umr-id`)

Querying `UMR-20260806-141250-1ceb` directly (not `--search`, which is a
full-text match and returned 0 hits on the bare UMR id) showed the real
mechanism: this row's own `reason` field read *"reconcile_dispatched_dead_zone.py
auto-reset (UMR-20260806-115605-854d): status='dispatched' for 12305.9 real
minutes (>15.0 threshold), no real task directory, no real systemd unit, no
real ocid_artifact_links evidence."* The original 2026-08-06 worker did the
real work and got PR #176 merged, but never called `mark-umr-terminal` to
close its own `umr_tasks` row out — so ~8.5 days later the dead-zone
reconciler (correctly, from its own vantage point) treated the still-open
row as abandoned and reset it to dispatchable, and it got redispatched today
as this task, reusing the same UMR id. This is a bookkeeping-completeness
gap in the *original* task, not a flaw in today's dedup check.

## record-completion evidence (real, independently verified)

Ran `python3 agent_work_briefing.py record-completion --umr-id
UMR-20260806-141250-1ceb ...` citing `--umr-commit-sha
4d0a0b0b2c5f243580a33eb1ea34d73c033cb69f --umr-pr-number 176 --umr-repo
veridian-scripts --files-touched superboss-register.py --files-touched
plan_generator.py --files-touched tests/test_reuse_check_unbounded_metadata_fix.py`.
The tool's own independent GitHub check confirmed: *"veridian-scripts#176
independently confirmed via GitHub: 3 non-docs-only file(s) in its real diff
(state=MERGED, merged_at=2026-08-06T16:36:44Z)"* — `verified: true`. The
`umr_tasks` row is now genuinely `status=completed`,
`ts_completed=2026-08-15T04:57:21Z`, closing the bookkeeping gap that caused
the erroneous re-dispatch in the first place.

## Completed
- [x] Step zero: real dedup check via `resource_governor.py --query-umr`
      (`--search "reuse_check_result"`, `--search "proposal 86"`, `--search
      "cf13"`) — found this exact UMR's own prior completed work (PR #176,
      merged, live-deployed, tested).
- [x] Verified PR #176 is merged (`gh pr view`), is an ancestor of the live
      `/opt/veridian/scripts` checkout's current `HEAD` (`git merge-base
      --is-ancestor`), and its code is physically present in the live files.
- [x] Ran the existing real test (`tests/test_reuse_check_unbounded_metadata_fix.py`)
      live: 4/4 pass.
- [x] Step four (before/after proof): real DB file size and real
      per-dispatch `metadata_json` size, before and after, measured live
      against the real production DB (see above).
- [x] Confirmed both layers (query-side LIMIT + embed-side cap) are active
      simultaneously on a real, current (2026-08-15) production dispatch
      row.
- [x] Progress file written and committed (this file).
- [x] `record-completion` called against this task's own UMR
      (UMR-20260806-141250-1ceb) documenting this as a duplicate-dispatch
      re-confirmation, not new code.

## Remaining
- [ ] None for this task. Root cause of the re-dispatch identified above
      (original worker never called `mark-umr-terminal`, so
      `reconcile_dispatched_dead_zone.py` reset the row after ~8.5 days and
      it was redispatched under the same UMR id) and closed by this task's
      own `record-completion` call. Worth a PM/owner note: consider whether
      `mark-umr-terminal` should be enforced more strongly at the end of a
      worker's own successful PR-merge path so this class of "real work
      done, bookkeeping left open -> dead-zone reconciler resurrects it ->
      duplicate dispatch" doesn't recur for other tasks; out of this task's
      own approved scope to fix, noted for a future gap.

## Note on the completion gate

This task's SPEC names specific code files (`superboss-register.py`,
`plan_generator.py`) as its objective. This diff intentionally contains no
change to those files, because the real, tested, deployed fix already
exists (PR #176, `FChecklist/veridian-scripts`, merged 2026-08-06,
pre-dating this task by 9 days) and re-adding identical code would be a
dishonest no-op commit, not real work. `progress_completion_gate.py`'s own
cross-repo-evidence path does not recognize PR #176 as evidence *for this
task* (its branch name/creation time correlate to the *original* dispatch of
this same UMR, not to `task-20260815-045117-...`) — that's expected and
correct: this genuinely is a duplicate dispatch, not a cross-repo delivery
of new work, and it should read as fully-investigated/no-code-needed rather
than be forced to fabricate a diff to satisfy a heuristic built for a
different scenario.
