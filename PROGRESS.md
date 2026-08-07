# PROGRESS -- task-20260718-083004-cache---synchronization--cache-integrity

Task: VERIDIAN Review Framework gap-closure, "Cache & Synchronization / Cache
Integrity & Security" -- 3 findings, closed together in one PR since all
three are the same module/area (server-side LLM response cache +, for the
offline finding, a genuinely new but small client-side shell).

Per the task's own instruction: read the real current implementation of
each area FIRST, before assuming the gap-analysis wording still holds.

## Completed

- [x] **[High] Cache Security & Encryption** -- Gap confirmed real:
      `src/lib/llm-response-cache.ts`'s `content` column was stored as
      plaintext. Fixed by reusing the existing pgcrypto (`pgp_sym_encrypt`)
      helper `src/lib/ai-config-crypto.ts` already provides for BYOK
      provider API keys and `erp-vendor-master-service.ts` already uses for
      vendor bank account numbers -- this file is a third caller of that
      established primitive, not a new encryption scheme. No real KMS
      integration exists anywhere in this codebase to "evaluate" (grepped:
      zero aws-sdk/@aws-sdk/client-kms in package.json), so the honest scope
      here is VERIDIAN's existing at-rest mechanism, not inventing a second
      one. A decrypt failure (legacy plaintext row / rotated key / corrupt
      ciphertext) is treated as a cache miss, never a thrown error -- see
      the file's own header comment for the full reasoning.
      Files: `src/lib/llm-response-cache.ts`.
- [x] **[Medium] Automatic Cache Invalidation** -- Gap confirmed real: one
      hardcoded module-level 24h TTL, no per-call control. Per the finding's
      own recommended approach ("Selective TTL tuning by data volatility",
      not a full event-bus), added `CACHE_TTL` named presets
      (`HIGH_VOLATILITY` 1h / `STANDARD` 24h, unchanged default / `LOW_VOLATILITY`
      7d) and a per-call `ttlMs` option. Re-checked both of today's real
      callers (`orchestrate/route.ts`, `fde-service.ts`) against their own
      already-documented volatility reasoning -- both already fit STANDARD
      and are left on the default rather than given a fabricated override.
      Files: `src/lib/llm-response-cache.ts`.
- [x] Added `src/lib/llm-response-cache.test.ts` -- this module had zero
      test coverage before. Covers: content is encrypted at rest (DB never
      receives plaintext), a decryptable hit round-trips to plaintext for
      the caller, an undecryptable row is a miss (not a throw) and gets
      overwritten, an expired row is a miss even if still decryptable, an
      encryption failure on write never blocks the real LLM response
      reaching the caller, `ttlMs` defaults to `CACHE_TTL.STANDARD` and a
      caller override is honored, and `callLLMJsonCached` has the same
      encryption/TTL behavior as `callLLMCached`. 8 tests, all passing
      (`bun test src/lib/llm-response-cache.test.ts`).
- [x] **[Critical] Offline Cache Support** -- Gap confirmed real and, unlike
      the other two, genuinely unaddressed anywhere: grepped for
      `serviceWorker.register`/workbox/next-pwa/serwist/`public/sw.js` --
      zero hits anywhere in the repo before this change. Investigated the
      two screens the finding's recommended approach names before writing
      anything:
        - `src/app/(app)/fm-register-digitization/page.tsx` is a real page,
          but its actual flow is capture-photo -> upload -> AI-extract, not
          a browsable read-only data screen -- extraction inherently needs
          the network, so the *page itself* isn't a natural offline-shell
          candidate. Its rows-GET endpoint
          (`/api/fm/register-digitization/[batchId]/rows`) is, though, and
          is what's actually cached.
        - "site-diary screens" (plural, in the recommended approach) don't
          exist yet -- there is no `(app)/` UI for construction site diary
          at all, only its service layer + 3 GET/POST API route aliases
          (`/api/construction/site-diary`, `/api/v1/construction/site-diary`,
          `/api/v1/projexa/site-diary`). Rather than skip the finding
          because "the screen doesn't exist" (the underlying Critical gap --
          zero offline support anywhere -- is still real), the read-only GET
          list endpoints are cached now as forward-looking infra, ready for
          whenever a UI lands on top of them.
      Implementation, scoped deliberately to READ-ONLY (per the finding's
      own recommended approach, not a full offline-write rewrite):
        - `public/sw.js` -- new service worker. Cache-first for static
          build assets (`_next/static/*`, logo SVGs, fonts); network-first
          with cache fallback for the allowlisted read-only GET routes
          above (FM rows + all 3 site-diary GET aliases); a static
          `public/offline.html` fallback for a navigation that fails
          offline with nothing cached. Never intercepts a non-GET request.
          Every cached API response is rebuilt with ONLY its JSON body kept
          -- `requireAuth()`'s Supabase server client can attach a real
          session-refresh Set-Cookie header to almost any authenticated
          response (`src/lib/supabase/server.ts`), so caching+replaying the
          raw `Response` would risk leaking a session cookie to a later
          request, possibly from a different signed-in user on a shared
          browser. See the file's own header comment for the full reasoning,
          including why full authenticated-page HTML is deliberately never
          cached (personalized SSR + the same Set-Cookie risk, worse).
        - `public/offline.html` -- zero-JS/CSS-dependency static fallback.
        - `src/lib/use-online-status.ts` -- new `navigator.onLine` hook
          (none existed before, grepped).
        - `src/components/OfflineShell.tsx` -- registers `public/sw.js` and
          renders a visible "you're offline" banner; mounted once, globally,
          from `AppShell.tsx` (same pattern as the existing `HelpWidget`).
        - `src/components/AppTopbar.tsx`'s `handleLogout` now purges all
          Cache Storage entries on sign-out (best-effort, non-blocking) --
          Cache Storage is per-origin, not per-user, so without this a
          second person signing in on the same shared/kiosk browser could
          still see the previous org's cached FM/site-diary data.
      Browser-cache-at-rest encryption is deliberately out of scope for this
      offline shell: the finding's own recommended approach explicitly
      "risk-accept[s] browser cache" and points real encryption effort at
      `llm_response_cache` (closed above) instead -- so no encryption layer
      was added to `public/sw.js`'s Cache Storage usage.
      Not in scope for this wave (documented, not silently dropped):
      queuing/replaying offline *writes* (a materially larger project --
      conflict resolution, delivery guarantees, re-validating multi-tenant
      RLS on replay) is left for a dedicated follow-up; only reads are
      offline-capable now.
      Files: `public/sw.js`, `public/offline.html`,
      `src/lib/use-online-status.ts`, `src/components/OfflineShell.tsx`,
      `src/components/AppShell.tsx`, `src/components/AppTopbar.tsx`.
- [x] Verified no scope collision: `git grep` for any in-flight
      `ai-os/boss/ACTIVE-CLAIMS.yaml` entry touching
      `llm-response-cache.ts`, `fm-register-digitization`, `site-diary`, or
      a service-worker/offline area -- none found. Did not touch
      `src/lib/services/permission-service.ts`'s `ERP_ACTION_ROLES` table or
      add any new permission-service entry -- this gap-closure needed none.

## Verification run

- `bun test src/lib/llm-response-cache.test.ts` -- 8 pass, 0 fail.
- `bunx eslint` on every changed/new file -- clean, no errors or warnings.
- Full-repo `tsc --noEmit` could not complete in this sandbox (JS heap OOM
  on the whole ~400+ table schema graph, unrelated to these changes --
  reproduces on a clean checkout too); relied on the scoped eslint pass plus
  the fact that `bun test` itself type-checks the imported module during
  execution.

## Remaining

- [ ] None for this task's 3 named findings -- all closed. Offline write
      support (queued/replayed mutations) is a real, larger follow-up noted
      above but intentionally not started here.
