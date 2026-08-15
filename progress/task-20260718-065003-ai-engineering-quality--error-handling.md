# Progress -- task-20260718-065003-ai-engineering-quality--error-handling

Gap-closure for VERIDIAN Review Framework findings:
- [Low] Error Handling Quality -- ~9% of API routes lack a visible try/catch
- [Medium] Logging Quality -- no confirmed centralized structured logging utility

## Investigation (before writing code)

- Re-checked the "~9%" figure against current `main`: 65 / 878 `route.ts` files
  (7.4%) export an HTTP handler with no `try {` anywhere in the file (checked
  via `git grep -L "try"` over every `git ls-files src/app/api/**/route.ts`).
  Close enough to the original "~9%" to call the finding still accurate --
  not stale, not already resolved. Full list captured during investigation
  (not committed, regenerable via the same grep).
- Confirmed the codebase's own established pattern for the fixed 91% is:
  `try { ... } catch (error) { if (error instanceof ServiceError) return
  NextResponse.json({ error: error.message }, { status: error.status });
  console.error(...); return NextResponse.json({ error: "..." }, { status: 500 }) }`
  (`ServiceError` from `src/lib/services/compliance-service.ts`, re-exported
  by most other service modules). New work follows this same shape rather
  than inventing a new one.
- Searched for an existing centralized structured/correlation-ID-aware
  logger: none exists. `src/lib/orchestra-execution-logger.ts` is a
  DB-persisted *AI execution* observability helper (LLM call metadata --
  tokens/cost/model), not a general operational logger, and is unrelated to
  this gap. Confirmed still a real gap, not already resolved.
- Checked `ai-os/boss/ACTIVE-CLAIMS.yaml`: no other session currently
  claims this area. Registered a claim entry for this task before starting
  real work (per Rule 11 / that file's own protocol).
- Did not touch `src/lib/services/permission-service.ts` (out of scope per
  the task prompt) or any file another active claim names.

## Approach taken

Rather than a one-off mechanical fix to all 65 files (real collision risk
with the several other in-flight workers editing `src/app/api/**` right
now, per `ACTIVE-CLAIMS.yaml`, for a "Low"-severity finding whose own
recommended fix is "add a check", not "rewrite 65 files"), this closes the
gap the way the finding's own recommended approach describes and the way
this codebase already enforces this class of rule (`check-guardrail-presence.mjs`,
`check-migration-collision.mjs`, `check-asset-registry-coverage.mjs`, etc.):

1. **`src/lib/logger.ts`** -- new lightweight structured operational logger.
   JSON-line output (timestamp/level/message/correlationId/context) via
   console.*, correlation-ID helper that reads `x-correlation-id`/
   `x-request-id` or mints a fresh UUID, `logger.error` normalizes
   `Error` objects. Explicitly distinct from the `audit_logs` compliance
   tables (`src/lib/audit.ts`) -- this is operational/debugging logging,
   not the compliance audit trail.
2. **`scripts/check-route-error-handling.mjs`** -- new CI check, same
   enforcement class/precedent as `check-migration-collision.mjs`: only
   fails on **new or modified** `src/app/api/**/route.ts` files that export
   an HTTP method handler with no visible `try {`, so it stops the gap from
   growing without retroactively failing CI on the 65 pre-existing files
   (documented honest-limitation comment in the script itself, matching
   this codebase's other check-*.mjs headers).
3. Wired into `.github/workflows/ci.yml` as a new job
   (`route-error-handling`), same shape as the other `check-*.mjs` jobs.
4. Fixed 3 of the 65 pre-existing violations as real, low-risk examples
   (small, single-owner files, not claimed by any other active session):
   `src/app/api/approvals/route.ts`, `src/app/api/bcm/route.ts`,
   `src/app/api/board-evaluation/route.ts` -- wrapped in try/catch using the
   established `ServiceError` pattern and the new `logger.error(...)` call
   instead of bare `console.error`.
5. Added `src/lib/logger.test.ts` (bun:test) covering level filtering,
   JSON-line shape, correlation-ID header precedence/fallback, and Error
   normalization.

## Completed

- [x] Re-verified both findings are still accurate against current `main`
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
- [x] `src/lib/logger.ts` -- structured, correlation-ID-aware operational logger
- [x] `src/lib/logger.test.ts` -- unit tests
- [x] `scripts/check-route-error-handling.mjs` -- CI check (new/changed routes only)
- [x] Wired check into `.github/workflows/ci.yml`
- [x] Fixed 3 sample pre-existing violations (approvals, bcm, board-evaluation)
- [x] Moved claim entry to `recently_completed:` in ACTIVE-CLAIMS.yaml

## Remaining

- [ ] Open PR, let CI run, merge per Rule 6
- Residual: 62 of the original 65 pre-existing `route.ts` files still lack
  try/catch (not fixed here -- see "Approach taken" above for why; the new
  CI check prevents this number from growing but does not retroactively
  fix it). Left as known, documented debt for a future wave/worker to pick
  up incrementally, same posture as `check-migration-collision.mjs` takes
  toward pre-existing migration-number collisions.
