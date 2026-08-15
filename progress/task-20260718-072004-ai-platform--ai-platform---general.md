# PROGRESS -- task-20260718-072004-ai-platform--ai-platform---general

Finding: "[Low] Option to Bring Your Own AI (BYOAI) Integration -- not all 6
supported providers are equally validated/tested for BYO keys."
Recommended approach: write a test suite hitting model-config/route.ts with
a mock key per provider.

## Investigation (before writing code, per this task's own instruction)
- Read src/app/api/settings/model-config/route.ts (GET/POST) and
  [id]/route.ts (DELETE) -- the real BYOAI CRUD surface.
- Found PR #384 (merged 2026-07-16) already closed the *bigger* half of
  this finding: POST used to only validate shape before persisting a BYO
  key; that PR added a real testProviderConnection() connectivity check
  (src/lib/orchestra-model-resolver.ts) run before persisting, plus
  src/lib/orchestra-model-resolver.test.ts covering testProviderConnection
  itself.
- BUT: orchestra-model-resolver.test.ts only mocks fetch and calls
  testProviderConnection() directly with openai/groq -- it never hits
  route.ts's own POST handler (auth/role gate, VALID_PROVIDERS allow-list,
  existing-key-reuse-on-update, persist-after-successful-test), and never
  exercises anthropic/google at all. No src/app/api/settings/model-config/
  route.test.ts existed anywhere in the repo. So the finding's underlying
  gap -- uneven per-provider validation coverage -- is real, just narrower
  than the "6 providers" framing suggests.
- Provider-count reconciliation: llm-client.ts's `LLMProvider` type has 6
  values (groq/openai/anthropic/google/openrouter/cerebras). The Postgres
  `ai_provider` enum (schema.ts) only has 5 (no cerebras -- inserting one
  would violate the DB enum). route.ts's own `VALID_PROVIDERS` allow-list
  has only 4 (groq/openai/anthropic/google) -- openrouter/cerebras are
  platform-internal failover/floor-tier providers, never exposed as a BYO
  choice at this route. Widening VALID_PROVIDERS to match all 6 would be a
  real product decision (needs a DB enum migration for cerebras) well
  beyond this Low-severity finding's "write tests" recommendation, so not
  done here -- documented instead of silently expanded.

## Completed
- [x] Registered this task's claim in ai-os/boss/ACTIVE-CLAIMS.yaml before
      starting real work.
- [x] Reverted an accidental stomp on the shared PROGRESS.md left over from
      a prior invocation of this same task slot (it had overwritten a
      different task's -- cost-estimate-5org-50user -- progress notes with
      a stub for this task). Restored via `git checkout -- PROGRESS.md`.
      This task now uses only its own progress/*.md file, per the current
      RESUME protocol (the prompt.txt's older "maintain PROGRESS.md"
      instruction is superseded by the newer per-task progress/ file
      convention this invocation was given).
- [x] Wrote src/app/api/settings/model-config/route.test.ts: a real test
      suite hitting the actual GET/POST route module (dynamic `import
      ("./route")`, same pattern as the existing
      settings/branding/route.test.ts), mocking only
      @/lib/supabase/auth-guard, @/lib/db/tenant-scoped, @/lib/ai-config-
      crypto and @/lib/orchestra-model-resolver -- not a live DB, matching
      this repo's established route-test convention. Covers:
      - all 4 BYO-eligible providers (groq/openai/anthropic/google), each
        with its own distinct mock key, success path: testProviderConnection
        called with that exact (provider, model, key), config persisted,
        raw key never echoed back (`hasKey: true` only).
      - per-provider failure path: testProviderConnection returns
        ok:false -> POST returns 400 and the DB insert is never reached.
      - provider rejection for values outside the 4-provider allow-list
        (including "cerebras" and "openrouter", which are real
        LLMProvider values elsewhere in the codebase but not BYO-route-
        eligible) -- 400, testProviderConnection never called.
      - missing/blank modelName -> 400 before any connectivity test.
      - admin-only gate on POST (member/branch_manager 403, admin/
        veridian_admin allowed), matching the branding route test's
        pattern.
      - existing-key reuse: updating modelName/isActive with no new
        apiKey decrypts and reuses the existing stored key to run the
        connectivity test, and the update path (not insert) is used.
      - GET: returns layers + configs with hasKey booleans only (never a
        raw/decrypted key field in the response), 400 when there's no
        orgId on the account.
- [x] `bun install` (fresh workspace, node_modules wasn't present).
- [x] `bun test src/app/api/settings/model-config/route.test.ts` -- 17 pass /
      0 fail / 84 expect() calls.
      `bun test src/app/api/settings/branding/route.test.ts` (pre-existing,
      unrelated to this change -- ran as a sanity check on the same route-
      test pattern) still 7 pass / 0 fail.
- [x] `NODE_OPTIONS="--max-old-space-size=6144" bunx tsc --noEmit` -- 0
      errors (plain `bunx tsc --noEmit` OOMs on this repo's full project
      graph regardless of this change; raising the heap limit was needed
      just to get a result, not a change caused by this diff).
- [x] `bunx eslint src/app/api/settings/model-config/route.test.ts` -- 0
      errors/warnings.
- [x] Full `bun test` (whole repo): 1438 pass / 0 fail / 2874 expect()
      calls across 104 files -- no regressions from this change. (The
      console noise in the run -- APP_RUNTIME_DATABASE_URL warnings,
      "db unreachable", "simulated network failure" -- is expected stderr
      output from OTHER pre-existing tests deliberately exercising their
      own fail-closed/error paths, not real failures.)

## Remaining
- [ ] Commit, push, open PR (Rule 6 -- no direct push to main), let CI run.
