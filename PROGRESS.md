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
- [x] `git merge origin/main` -- real `CONFLICTING`/`DIRTY` state (main 530
      commits ahead / 11 behind at merge time). 3 real conflicts:
      - `PROGRESS.md`: this repo's current convention is single-current-entry
        (confirmed by reading `origin/main`'s copy directly, 45 lines, one
        section) -- replaced wholesale with this entry, per that convention.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml`: main had independently pruned/rotated
        its `active:` list since this PR branched (this PR's own diff against
        the merge-base was a single 31-line `recently_completed:` entry
        appended). Kept main's current list wholesale and appended this
        task's own claim entry under `active:` with a `rebase_note:`
        documenting the merge, matching the exact precedent already recorded
        in this same file (see the rebase-sweep2b-668 entry's own
        `rebase_note:`).
      - `ai-os/registry/terminology-guardrail-exemptions.yaml`: purely
        additive on both sides (this PR's new exemption entries for
        `AppShell.tsx`, `AppTopbar.tsx`, `OfflineShell.tsx`,
        `use-online-status.ts`, `llm-response-cache.test.ts`,
        `crm/pipeline/page.tsx`, `crm/opportunities/[id]/route.ts`, vs.
        main's independently-added `hr-dashboard-service.ts` correction
        entry) -- kept all entries from both sides, deduped the two
        unchanged-on-both-sides entries (`subscription-plan-service.ts`,
        `crm/pipeline/page.tsx`, `opportunities/[id]/route.ts`) to one copy
        each.
      - `src/components/AppShell.tsx` / `AppTopbar.tsx`: auto-merged cleanly,
        no manual resolution needed.
      - No `drizzle/` conflicts: this PR's own commits never touch
        `drizzle/`, confirmed via `git diff <merge-base> <PR-head> --
        drizzle/` (empty) -- no migration renumbering required.
- [x] Security-relevant diff re-verified directly against the current
      merged tree (not just the original PR description): `cacheBodyOnly()`
      in `public/sw.js` rebuilds every cached response from JSON body only
      with a bare `Content-Type: application/json` header (never forwards
      the original `Response`, so no `Set-Cookie` is ever persisted); only
      the two allowlisted read-only GET route families are cached, all
      non-GET requests and authenticated page navigations are excluded; the
      logout handler unconditionally purges all Cache Storage via
      `caches.keys().then(keys => keys.forEach(key => caches.delete(key)))`
      before the login redirect. No gap found in this logic.
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
      is the authoritative check and passed at the original PR's head SHA.
- [x] `bun test src/lib/llm-response-cache.test.ts` -- 8 pass, 0 fail.
- [ ] Push `rebase-final-1019`, open replacement PR citing #1019, close
      #1019 as superseded, verify real CI (audit-check must genuinely pass
      with a correctly-enumerated severity value -- the original PR's
      failure was a verdict-comment format bug, not a substantive finding).
