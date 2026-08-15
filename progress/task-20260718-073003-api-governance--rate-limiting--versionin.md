# task-20260718-073003-api-governance--rate-limiting--versionin

VERIDIAN Review Framework gap-closure: API Governance (Rate Limiting,
Versioning, Webhooks) / Rate Limiting & Key Scoping.

## Finding

- [Medium] Public API rate-limit tiers documented and enforced.
  Gap: enforcement is real; public documentation of tiers is missing.
  Recommended approach: add a docs page listing default and available tier
  values.

## Investigation (read-before-code, per prompt.txt instruction)

Read the real implementation before writing anything:

- `src/lib/supabase/api-key-auth.ts` (`validateApiKey()`) — enforcement is
  confirmed real: 60s rolling window, counts `api_key_request_log` rows per
  key, returns `{ status: "rate_limited", retryAfterSeconds: 60 }` → 429 +
  Retry-After (Wave 96, API002/API009).
- `src/lib/db/schema.ts` — `apiKeys.rateLimitPerMinute` is a nullable
  integer (`null` = unlimited).
- `src/app/api/settings/api-keys/route.ts` (POST) — new keys are always
  created with `rateLimitPerMinute` unset → defaults to `null`/unlimited.
- `src/app/api/settings/api-keys/[id]/route.ts` (PATCH) — org admins set
  any positive integer, or `null` to clear it; anything else is a 400.
- `src/components/ApiKeySection.tsx` — Settings → API Keys UI, confirms the
  same free-form per-key model (no tier picker/dropdown exists anywhere).

**Correction to the finding's framing:** there is no fixed named
Free/Pro/Enterprise-style tier ladder in this codebase — grepped `tier` and
`rate.limit` across `src/`, `drizzle/`, `docs/` and found nothing of the
sort. The real model is a single admin-configurable per-key
`rateLimitPerMinute` integer, defaulting to unlimited. The gap itself
(no public docs describing this) is real and unresolved, so this is not a
"nothing to do, already fixed" case — it's "document the real
default-and-available-values model" rather than a set of named tiers that
don't exist in code, per the instruction not to assume the gap description
is still accurate.

## Completed

- [x] Read the real rate-limiting implementation end-to-end (enforcement,
      defaults, admin-facing controls, usage-analytics linkage).
- [x] Added `docs/API_RATE_LIMITS.md` — documents the real default
      (unlimited), the real available values (any positive integer/min, or
      null), the 60s window, the 429+Retry-After behavior, how an admin
      sets a cap (`PATCH /api/settings/api-keys/{id}`), and why the default
      is unlimited rather than a new low cap (Wave 96 backward-compat
      rationale already in `api-key-auth.ts`'s own comments).
- [x] Linked the new page from `docs/API_CHANGELOG.md`'s intro (the
      existing convention for this repo's public `/api/v1/**` docs).
- [x] Added a one-line rate-limiting summary + pointer to the new doc in
      the live, unauthenticated `GET /api/v1/openapi.json` `info.description`
      (`src/lib/openapi/generate.ts`) — this is the most literally "public"
      surface (served with no auth by design, per that route's own header
      comment), so it's the best place for a caller to discover the doc
      exists before they even have a key.
- [x] Did not touch `permission-service.ts` or any other worker's scope
      (no permission changes needed for a docs-only gap).

## Remaining

- [ ] None — finding is closed. (No code enforcement changes needed; the
      gap was purely a missing docs page, per the finding's own
      "Recommended approach.")

## Resume (invocation 15) — PR #1222 landing

Work itself was already done and committed by invocation ~14 (commit
`fa6e86d56`). This invocation found the PR open (#1222) but not merged:
`audit-check` was failing (no structured audit verdict comment posted yet,
per Rule 7c/10 — `.github/workflows/mandatory-audit-check.yml` +
`scripts/validate-audit-verdict.ts` require one on every PR, not just
`ai-team/*` branches — see memory
`veridian-audit-check-applies-to-all-prs-not-just-ai-team`), and the branch
was `BEHIND` main.

- [x] Merged `origin/main` into this branch (clean, no conflicts — picked
      up an unrelated route-error-handling gap-closure from a sibling
      session) and pushed.
- [x] Re-verified the PR's own diff against live code before self-auditing
      (not just trusting this file's own earlier claims) — confirmed
      `src/lib/supabase/api-key-auth.ts`, `schema.ts:680`
      `rateLimitPerMinute`, and the PATCH route's validation all match
      what the new docs page says.
- [x] Posted the required structured `AUDIT: PASS` comment (8 fields per
      `audit-protocol.ts`'s `AuditProtocolFields`) on PR #1222.
- [ ] Confirm all CI checks (incl. audit-check) go green on the latest
      push, then merge via `gh pr merge --squash` (Rule 12: full autonomy,
      no separate human sign-off needed for an already-approved,
      docs-only, non-security/non-financial change).
