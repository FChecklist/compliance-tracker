# Package lf-d1-edge-fixes (backend, repo compliance-tracker)

Branch `claude/lf-d1-edge-fixes` from `origin/feat/lf-sync-backend`. **No new migration.** Findings to fix: `ai-os/cloud-agents/review-findings/D1.md` (28 findings, one BLOCKER, the rest major/minor). Read that file completely first; every finding has the scenario and a verified fix.

## Goal
An independent review of the local-first backend found real defects in the two Edge Functions that a laptop talks to. Fix them so the wire behaves the way `supabase/functions/projexa-sync/README.md` and `projexa/docs/local-first/CONTRACT.md` (repo `projexa`, branch `origin/feat/local-first-complete`) promise, and prove each fix with a test that fails when the fix is removed.

The BLOCKER (CORS preflight rejects the `X-Px-Client` header, so a real browser blocks every call) must be fixed and proven FIRST: commit and push it before anything else. Then the push-path majors (deadline, per-op isolation, error classification, size limits, cost of one push), then the rest.

## Files you own (edit freely)
`supabase/functions/projexa-sync/{handler.ts,index.ts,sign.ts,README.md}`, `supabase/functions/ai-work-link-exec/{handler.ts,index.ts}`, new test files under `src/lib/services/` named `projexa-sync-edge-*.test.ts` (handler-only tests with injected fakes need no database; use PGlite only where a real SQL function is the point), and the existing handler-facing tests that D1 findings cite. You may add exports to the handler for testing.

## Files you must NOT edit (other engineers own them in parallel; a conflict costs the integrator hours)
`drizzle/**` (all migrations and down files), `src/lib/services/projexa-sync-*.pglite.test.ts` (other than adding a NEW file), `src/lib/services/__test-helpers__/**`, `supabase/functions/ai-work-link/function-registry.generated.json`, `src/lib/pipeline/function-registry.ts`. If a fix needs a SQL change, do the handler half only, state the exact SQL change you need in your report under RISKS AND DECISIONS, and write the handler so it works with both the old and the new SQL result shape where that is cheap.
The SQL engineers change these in parallel: `projexa_sync_push_begin/finish` (package D2: concurrency, project-bound conflict check, an `uncertain` resolution path, the 600/hour cap) and the change feed / ids / retention (package D3). Do not re-implement their work in the handler.

## Hard design rules for this package
1. **Cost near zero is the owner's first priority** (then ease of work, then security; isolation between organisations and role-based visibility are non-negotiable). Every Edge invocation counts against a 500,000/month free quota. A fix must not add invocations per laptop action; prefer fewer. Finding F-02/F8 (one push of 50 ops = up to 100+ invocations) is a cost bug: reduce it if you can do so safely (for example a batch execution route in `ai-work-link-exec`, run inside one invocation), and if you cannot, say so with numbers.
2. **CORS**: `Access-Control-Allow-Headers` must include `x-px-client`; expose `Retry-After`; a preflight must be cached (`Access-Control-Max-Age`) so a laptop does not pay an extra invocation per call. Every error response (401, 404, 413, 426, 429, 503) must carry the CORS headers so the browser can read it.
3. **Error classes in push** (SYNC-04, tests F02): derive the transient / needs-server / permanent classification from the codes the pipeline REALLY returns (read `src/lib/pipeline/*` for the actual `BACKEND_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, ... codes), not invented ones, and make the tests use those real codes. A transient failure must never be recorded as terminal `rejected`.
4. **No poison ops** (F-03): the size limits of the SQL layer, the Edge body cap and the exec cap must agree (characters vs bytes!), so an accepted op can always be executed.
5. **426 gate** (F-09): block only a client that is OLDER than `min_compatible` or on an incompatible protocol, in the direction the contract says; never a newer client.
6. **Attestation** (TI-2, F-12): implement the holder-binding the finding describes in a way a laptop can do with no server call and while offline: `POST /attest` accepts an optional `device_pub_jwk` (ES256 P-256 public JWK), puts its RFC 7638 thumbprint in the token as `cnf.jkt`, and the signed-row message commits to the view class so a row redacted for one class cannot be passed off as another. Keep the old behaviour working when no key is sent (the client work lands later) but report it. Document the peer handshake step in `README.md`.
7. Keep `SERVER_PROTOCOL`, the route list and response shapes backward compatible unless a finding requires otherwise; if you change a shape, update `README.md` and say so in the report so the laptop contract can follow.

## Tests
`bun test --isolate <file>`; bunfig's test root is `src`, so tests live under `src/`. The handler is plain TypeScript with injected `rpc`, `session`, `limiter`, `now`, `signing`: handler-only tests are fast. Existing suites that exercise the handler must stay green: `projexa-sync-read`, `projexa-sync-keys-ids`, `projexa-sync-versions`, `projexa-sync-release`, `projexa-sync-push`, `projexa-sync-jobs`, `projexa-sync-more-kinds`, `projexa-sync-org-routes`, `ai-work-link-sync-run` (run them all before your final push; note that some are slow, 1-3 minutes each, do not run them in parallel).
PLANT the bug for every fix (remove the fix, see the test fail, restore) and list each in the report.

## Final report
As in the preamble, plus a table `finding key -> FIXED (where, test) | PARTLY | WON'T FIX (reason)` covering all 28 findings. A reasoned WON'T FIX is acceptable for a design choice whose cost exceeds its benefit under the priority order above; a silent omission is not.
