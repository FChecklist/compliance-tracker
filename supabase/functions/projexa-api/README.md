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
- Sign-in keys unreachable is `503` with Retry-After (the Next route says 401).
- The upstream is still the VERIDIAN backend (`VERIDIAN_API_BASE_URL`): a call costs one VERIDIAN invocation instead of one PROJEXA Vercel
  invocation plus one VERIDIAN invocation.
