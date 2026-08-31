# VERIDIAN AI OS — Public API Rate Limiting

**Covers:** every request authenticated with an `Authorization: Bearer vk_...`
API key — `/api/v1/**` and `/api/mcp` (see
[`docs/API_CHANGELOG.md`](./API_CHANGELOG.md) for the versioned route
surface itself). Session-cookie-authenticated requests (the internal
`(app)/` UI) are not subject to this per-key limiter.

**Ground truth:** this document describes exactly what
`src/lib/supabase/api-key-auth.ts`'s `validateApiKey()` enforces today — it
is not a forward-looking promise. If that file changes, update this page in
the same PR (same convention `API_CHANGELOG.md` already follows).

## There is no fixed Free/Pro/Enterprise tier ladder

Unlike a typical SaaS API, VERIDIAN AI does not gate rate limits by
subscription plan. Each API key has its own independent
`rateLimitPerMinute` value, set directly by an org admin from **Settings →
API Keys** (or via `PATCH /api/settings/api-keys/{id}`) — there is no
preset tier name to pick from, just a number.

| Value | Meaning |
|---|---|
| **Default (unset / blank)** | **Unlimited** — every key starts this way when first generated via `POST /api/settings/api-keys`; no cap is applied until an admin explicitly sets one. |
| **Any positive integer `N`** | Capped at **`N` requests per rolling 60-second window**, counted per individual API key (not per org — an org with multiple keys gets an independent budget per key). |

There is no minimum or maximum `N` enforced beyond "a positive whole
number" — an org can set a key as tight (e.g. `10`/min for a low-trust
integration) or as loose as it wants. Clearing the field (setting it back
to blank/`null`) removes the cap entirely.

## How enforcement works

- **Window:** a fixed 60-second rolling window (`RATE_LIMIT_WINDOW_SECONDS`
  in `api-key-auth.ts`), evaluated on every request by counting that key's
  rows in `api_key_request_log` created in the last 60 seconds.
- **Over the limit:** the request is rejected before it reaches the route
  handler, with `{ status: "rate_limited", retryAfterSeconds: 60 }` from
  `validateApiKey()`, surfaced by `requireAuthOrApiKey()` as an HTTP
  **`429 Too Many Requests`** with a `Retry-After: 60` header — distinct
  from the plain `401` an invalid/missing key gets.
- **Every request is logged**, whether it was allowed or rate-limited, into
  `api_key_request_log`. This is the same table that powers the **Settings
  → API Keys → Usage** analytics panel
  (`GET /api/settings/api-keys/usage`, `src/lib/services/api-usage-service.ts`) —
  an org can see its own rate-limited-request rate there.

## Setting a limit on a key

```
PATCH /api/settings/api-keys/{id}
Content-Type: application/json

{ "rateLimitPerMinute": 120 }
```

Pass `"rateLimitPerMinute": null` (or omit the field entirely on a fresh
key) to leave it unlimited. The API rejects anything else — zero, negative
numbers, and non-integers all return `400`.

## Why "unlimited by default" instead of a low default cap

Every pre-existing API key before Wave 96 (Comparison CSV 3 gap analysis:
API002/API009, `drizzle/0081_wave96_api_rate_limit_usage_log.sql`) had no
rate limiting concept at all. Defaulting new keys to `null` (unlimited)
rather than silently applying some new low cap preserves that exact prior
behavior for every existing integration — the feature is opt-in tightening,
not a retroactive restriction. An org that wants a cap sets one explicitly.
