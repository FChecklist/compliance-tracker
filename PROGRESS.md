# PROGRESS -- rebase-final-1019 (real rebase-merge for PR #1019)

## Scope
Real rebase-merge of PR #1019 (`worker/task-20260718-083004-cache---synchronization--cache-integrity`,
"Close Cache & Synchronization / Cache Integrity & Security gaps (3 findings)")
onto current main, per this repo's standard rebase-sweep protocol. Original
PR content (already independently reviewed, not re-litigated here): [High]
Cache Security & Encryption -- `src/lib/llm-response-cache.ts`'s `content`
column now encrypted at rest via the existing pgcrypto helper
(`src/lib/ai-config-crypto.ts`), reused rather than a new scheme; [Medium]
Automatic Cache Invalidation -- `CACHE_TTL` named presets + a per-call
`ttlMs` option; [Critical] Offline Cache Support -- new read-only offline
shell (`public/sw.js` + `public/offline.html` + `OfflineShell.tsx` +
`use-online-status.ts`), allowlisted to FM register-digitization rows GET +
construction site-diary GET aliases, with every cached API response rebuilt
from JSON body only (no Set-Cookie ever persisted to Cache Storage) and full
Cache Storage purged on logout (`AppTopbar.tsx`'s `handleLogout`).

## Completed
- [x] Worktree: `git worktree add -b rebase-final-1019` from
      `origin/worker/task-20260718-083004-cache---synchronization--cache-integrity`,
      `bun install`.
- [x] `git merge origin/main`, round 1 -- real `CONFLICTING`/`DIRTY` state
      (main 530 commits ahead / 11 behind at merge time). 3 real conflicts:
      - `PROGRESS.md`: this repo's current convention is single-current-entry
        (confirmed by reading `origin/main`'s copy directly) -- replaced
        wholesale.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml`: main had independently pruned/
        rotated its `active:` list since this PR branched -- kept main's
        current list wholesale, appended this task's own claim entry under
        `active:` with a `rebase_note:`, matching the precedent already
        recorded in this same file (the rebase-sweep2b-668 entry's own
        `rebase_note:`).
      - `ai-os/registry/terminology-guardrail-exemptions.yaml`: purely
        additive on both sides -- kept all entries, deduped the ones
        unchanged on both sides.
      - No `drizzle/` conflicts: this PR's own commits never touch
        `drizzle/` (confirmed via diff against the merge-base).
- [x] **Race condition caught before pushing**: between fetching main and
      finishing round-1 conflict resolution, PR #1531 (OCID-038,
      GAP-NO-SERVICE-WORKER-OFFLINE-BLANK-PAGE) merged to main -- an
      independent gap-closure that *also* created `public/sw.js` +
      `public/offline.html` and registered a service worker in
      `AppShell.tsx`, for a different finding. Caught this by re-checking
      `gh pr view` on the not-yet-pushed branch out of caution; confirmed
      via `git merge-base --is-ancestor` that this commit landed after my
      original `git fetch origin main`, not before.
      `git merge origin/main`, round 2 -- real `add/add` conflicts on
      `public/sw.js` and `public/offline.html` (plus a 3rd PROGRESS.md
      conflict). Genuinely merged both service-worker implementations into
      one file rather than picking a side: kept PR #1019's full
      structure (cache-first static assets, allowlisted read-only GET
      caching with `cacheBodyOnly()` cookie-stripping, navigate-fallback),
      and added OCID-038's real contribution -- pre-caching `/offline.html`
      + the logo mark on `install`, so the offline fallback is guaranteed
      available even on a tab's very first load. Also found and removed a
      duplicate `navigator.serviceWorker.register("/sw.js")` call site (one
      in `AppShell.tsx` from OCID-038's merge, one in `OfflineShell.tsx`
      from this PR) -- harmless at runtime (idempotent) but redundant;
      centralized in `OfflineShell.tsx`, which already mounts at the same
      authenticated app-shell point OCID-038 needed. `public/offline.html`:
      kept PR #1019's copy (more specific/accurate to what's actually
      cached).
- [x] Security-relevant diff re-verified directly against the final merged
      tree (not just the original PR description): `cacheBodyOnly()` in the
      merged `public/sw.js` rebuilds every cached response from JSON body
      only with a bare `Content-Type: application/json` header (never
      forwards the original `Response`, so no `Set-Cookie` is ever
      persisted); only the two allowlisted read-only GET route families are
      cached, all non-GET requests and authenticated page navigations are
      excluded; the logout handler unconditionally purges all Cache Storage
      via `caches.keys().then(keys => keys.forEach(key => caches.delete(key)))`
      before the login redirect. No gap found in this logic, including
      after the OCID-038 merge.
- [x] **Real bug found and fixed in `ai-os/registry/terminology-guardrail-
      exemptions.yaml` itself**: after both merge rounds, this manifest had
      5 files with 2-3 *duplicate* `file:` entries each
      (`src/components/AppShell.tsx`, `AppTopbar.tsx`, plus 3 harmless
      exact-duplicates from round-1's own conflict). `scripts/check-
      terminology-guardrail.mjs`'s `loadExemptions()` keys a `Map` by
      `file`, so only the LAST entry in file order was ever actually
      applied -- silently dropping the other entries' reasoning and, for
      `AppShell.tsx`/`AppTopbar.tsx`, undercounting the real total (a live
      regex re-scan found 5 dated comments in `AppShell.tsx`, not 4, and 3
      in `AppTopbar.tsx`, not 2 -- both missing a comment from an unrelated
      PR #1224 accessibility rebase that predates and is untouched by this
      merge). Consolidated each to one accurate entry.
- [x] Ran `node scripts/check-terminology-guardrail.mjs --full-repo` for
      real (not just the files this PR touches) as an extra check beyond
      this repo's stated validation commands, given the duplicate-entry bug
      just found. Surfaced 3 more pre-existing count-drift files, all
      unrelated to this PR's own commits (confirmed via `git diff <merge-
      base> <PR-head>` touching none of them) -- same "another PR's rebase
      landed after the last full-repo baseline snapshot" pattern already
      documented multiple times elsewhere in this same manifest
      (`ai-os/MASTER-TRACKER.yaml` 203->204, `ai-os/registry/asset-
      registry-coverage.yaml` 87->88, `src/lib/db/schema.ts` 100->101), plus
      this PR's own `progress/task-20260718-...-cache-integrity.md` (had no
      entry at all, 3 genuine dated progress-log comments) and `src/lib/
      engines/marketing-engine.test.ts` (from PR #668/#1529, already on
      main, also had no entry). Spot-read every flagged instance across all
      5 files before raising -- same benign class throughout (dated
      changelog/gap-closure/task-ID/tracker comments), not hardcoded
      secrets, PII, or human example data. Re-ran `--full-repo` after
      fixing: passes clean.
- [x] `node scripts/check-governance-yaml-parse.mjs` -- clean.
- [x] Full-repo `tsc --noEmit` (both `node_modules/.bin/tsc.exe` and
      `bunx tsc`) hits `FATAL ERROR: ... JavaScript heap out of memory` at
      ~2GB heap in this sandbox, on the whole ~400+ table schema graph --
      same documented limitation as this repo's own prior rebase sessions
      (reproduces on a clean checkout too, unrelated to this PR's diff).
      Relied instead on: `bunx eslint` on every security-relevant
      touched/new file (`src/lib/llm-response-cache.ts`,
      `src/lib/llm-response-cache.test.ts`, `src/lib/ai-config-crypto.ts`,
      `public/sw.js`, `AppTopbar.tsx`, `AppShell.tsx`, `OfflineShell.tsx`,
      `use-online-status.ts`) -- clean, 0 errors (1 pre-existing complexity
      warning on `AppShell.tsx`, unrelated to this PR); and `bun test`
      itself type-checking the imported modules during execution. Real CI's
      own `Type Check` job (full tsc, more memory than this local sandbox)
      is the authoritative check.
- [x] `bun test src/lib/llm-response-cache.test.ts` -- 8 pass, 0 fail.
- [x] **Round 3**: before pushing, re-fetched `origin/main` once more out of
      the same caution that caught round 2 -- PR #1533 (OCID-050, GET
      `/api/me` perf + settings `isAdmin` loading gate) had landed. Merged
      cleanly except `PROGRESS.md` itself (single-current-entry convention,
      this entry kept on top). Re-verified `ai-os/MASTER-TRACKER.yaml`
      (also touched by #1533) still matches this manifest's exemption count
      after the merge -- unaffected, passes. No other files overlapped.
- [x] Push `rebase-final-1019`, open replacement PR citing #1019, close
      #1019 as superseded.
- [ ] Verify real CI on the new PR (audit-check must genuinely pass with a
      correctly-enumerated severity value -- the original PR's failure was
      a verdict-comment format bug, not a substantive finding). Merge only
      once genuinely green.
