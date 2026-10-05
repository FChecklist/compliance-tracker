# projexa-api: PROJEXA's /api proxies on Supabase instead of Vercel (AUDIT-100 A2)

One generic Edge Function that answers a LISTED set of PROJEXA `/api/*` routes with the same contract as their Next handlers on Vercel
(status, JSON body, error vocabulary, Retry-After, role gate, acting person, the organisation's own VERIDIAN key). Everything else is 404
(deny by default).

| File | What |
|---|---|
| `handler.ts` | the pure handler (`handleApi`): routing, session, membership, write gate, upstream call, answer. Bun-tested. |
| `lookups.ts` | PROJEXA `memberships` (with the person's own token, RLS decides) and `veridian_credentials` (service role) reads. |
| `index.ts` | Deno wiring. |
| `policy.generated.ts` | GENERATED in the projexa repo (`bun scripts/projexa-api-edge.mjs --write --ct <this checkout>`): the role-tier table of projexa `src/lib/authz/api-write-policy.ts`, its decision functions, and the route list `ai-os/audit37/projexa-api-routes.json`. Never edit by hand: `SOURCE_SHA256` is checked. |
| `parity.golden.json` | the PARITY CONTRACT, recorded from the REAL projexa Next pipeline (`src/lib/projexa-api-parity.test.ts`); replayed here by `src/lib/services/projexa-api-edge-parity.test.ts`. |

## Add a route

In the projexa repo: add it to `ai-os/audit37/projexa-api-routes.json` (it must be a `veridian-proxy` route of the inventory) and to
`REQUESTS` in `src/lib/projexa-api-parity-cases.ts`, record the contract (`UPDATE_PARITY_GOLDEN=1 bun test src/lib/projexa-api-parity.test.ts`),
regenerate with `--write --ct`, add it to `PX_EDGE_ROUTES` in `src/lib/px-api.ts`. Both repos' tests fail until all of that agrees.
`bun scripts/projexa-api-candidates.mjs` (projexa) lists the remaining proxies whose handler is a PLAIN proxy and derives each one's spec from
the handler's own source; the recorded parity contract is what proves the derived spec right.

ORDER (binding): merge + DEPLOY this function with a new route BEFORE the projexa change that adds the route to `PX_EDGE_ROUTES` merges
(the browser must never be pointed at a route the deployed function does not answer).

Spec keys per method: `upstream` (with `{param}` / `{query:x}`), `fallback`, `acting_user`, `required_query`, `timeout_ms`, `search_params`,
`forward_search` (append the request's query string byte for byte, like `request.nextUrl.search`), `body`, `body_actor_email`,
`success_status` (201 for a create), `cache_control` (`private, max-age=<n>` only), `error_style`.

Batches: 1 = the shell's 7 routes (2026-10-05); 2 = the 40 most-used plain proxies of the online screens (2026-10-06); 3 = the next 33;
4 = the last 33 plain proxies (2026-10-06): 113 routes in all.

## Secrets

`PROJEXA_SUPABASE_URL`, `PROJEXA_SUPABASE_ANON_KEY` (public), `PROJEXA_SERVICE_ROLE_KEY` (reads `veridian_credentials` only), `VERIDIAN_API_BASE_URL`.

## Deploy (owner-authorised; from a clean checkout of origin/main)

```
bun <projexa>/scripts/projexa-api-edge.mjs --check-ct .      # the deployed table is the projexa repo's
npx --yes supabase@latest functions deploy projexa-api --project-ref pcrjmlpuqsbocqfwoxod --no-verify-jwt --use-api
curl https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/_policy   # source_sha256 must equal the projexa repo's
```

`--no-verify-jwt`: the caller's token is signed by the PROJEXA Auth project, not verdian-ai; `handler.ts` verifies it (ES256, PROJEXA issuer only).

## Known, deliberate differences from the Next routes

- An invalid JSON body is `400 {"error":"Invalid JSON body"}` (the Next route throws, a 500).
- A path parameter is always percent-encoded into the upstream path. Some Next handlers insert it raw (`/leads/${id}`), so an id holding
  `/`, `?` or `#` would address a different upstream path there; the edge is the stricter of the two. Ordinary ids (and a space, which
  fetch encodes on the wire either way) reach the upstream identically: the parity contract compares the path as it goes on the wire.
- Sign-in keys unreachable is `503` with Retry-After (the Next route says 401).
- The upstream is still the VERIDIAN backend (`VERIDIAN_API_BASE_URL`): a call costs one VERIDIAN invocation instead of one PROJEXA Vercel
  invocation plus one VERIDIAN invocation.
