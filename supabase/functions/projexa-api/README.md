# projexa-api: PROJEXA's /api proxies on Supabase instead of Vercel (AUDIT-100 A2)

One generic Edge Function that answers a LISTED set of PROJEXA `/api/*` routes with the same contract as their Next handlers on Vercel
(status, JSON body, error vocabulary, Retry-After, role gate, acting person, the organisation's own VERIDIAN key). Everything else is 404
(deny by default).

| File | What |
|---|---|
| `handler.ts` | the pure handler (`handleApi`): routing, session, membership, write gate, upstream call, answer. Bun-tested. |
| `lookups.ts` | PROJEXA `memberships` (with the person's own token, RLS decides) and `veridian_credentials` (service role) reads. |
| `index.ts` | Deno wiring. |
| `member-link.ts` | `POST /link-member` (not an `/api/*` proxy, so outside the generated route table): gives the signed-in PROJEXA person their own VERIDIAN user in their organisation, role mapped down (owner/admin -> admin, pm -> manager, site_engineer/member -> member, client_viewer -> client_viewer), idempotent, never an upgrade. Organisation and role come only from PROJEXA `memberships` (person's own token) and `veridian_credentials.veridian_org_id` (service role); SQL `public.projexa_ensure_member_user` (drizzle/0728). Called by PROJEXA after an invitation is accepted and lazily when an AI work link call answers USER_NOT_LINKED. Uses the platform-injected `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for that one rpc. Tests: `src/lib/services/projexa-api-member-link.test.ts`, `src/lib/services/projexa-member-link.pglite.test.ts`. |
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
`success_status` (201 for a create), `cache_control` (`private, max-age=<n>` only), `error_style`. Batch 5 added: `roles` (the handler's
own `requireRole(ctx, ROLE_GROUPS.X)`, checked right after the organisation is known: no role or a role outside the set is 403), `root`
(VERIDIAN's `/api/v1` root instead of `/api/v1/projexa`, veridian-client's `root: true`), `body` `json_lenient` (`request.json().catch(() =>
({}))`: an empty or broken body is `{}`) and `empty` (a constant `{}`, the request body is not read), and `body_defaults` (spread under the
caller's body, `{ action: "status", ...body }`). The generated `SHADOW_ROUTES` are Next routes that stay on Vercel but win over a dynamic
edge route for some path (GET `/api/drawings/export` is not `/api/drawings/:id`): 404 here, and the browser switch keeps them same-origin;
a literal edge route also beats a dynamic one (`/api/materials/issues` is not `/api/materials/:id`), as in the App Router.

Batch 6 added the handlers' own statements as data, each one ported from the handler's source and proven by the parity contract with good,
missing, empty, falsy, JSON-null, array, number and broken bodies and with every query form: `body_required` (`[{ fields, error }]`, in the
handler's order: `if (!body.a || !body.b) 400`), `body_pick` (`{ a: body.a, b: body.b }`), `body_object_error` (`request.json().catch(() =>
null)` + `!body || typeof body !== "object"`), `invalid_body_error` (the handler's own 400 for a bad JSON body), `body_in_try` (a bad JSON body
caught by the handler's catch: the fallback 502), `body_reject_if` (a field combination the handler refuses: the client_viewer cost floor),
`body_const` + `upstream_method` (DELETE answered by an upstream PATCH of `{ isActive: false }`), `optional_query` (`?k=` / `&k=` +
encodeURIComponent, only when set), `query_flags` (`?k=v` only for exactly v), `search_params_omit_empty` (no bare `?`),
`forward_query_normalized` (`searchParams.toString()`), `required_query_any` (one of several), `roles_also` (roles on top of the own set:
`if (ctx.role !== "member") requireRole(...)`), `response_pick` (`{ k: data.k ?? default }`) and `response_wrap` (`{ deactivated: true, id,
vendor: data }`). A handler that THROWS (a field read on a JSON-null body) is an empty 500 on both sides (Next:
`next/dist/build/templates/app-route.js` answers `new Response(null, { status: 500 })`); the recorder models exactly that.

Batches: 1 = the shell's 7 routes (2026-10-05); 2 = the 40 most-used plain proxies of the online screens (2026-10-06); 3 = the next 33;
4 = the last 33 plain proxies (2026-10-06): 113 routes in all; 5 = 72 proxies that were plain in all but form (own role sets, the VERIDIAN
root, empty / lenient / defaulted bodies, options in any order): 185 routes; 6 = 32 proxies with their own validation, query rebuilding or
answer reshaping (schedule, timesheets day submit/review, tasks, BOQ categories / lines / compare / cost visibility, billing milestones,
reports, vendor / customer deactivate): 217 routes.

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

- An invalid JSON body on a route that reads it strictly OUTSIDE its try is `400 {"error":"Invalid JSON body"}` (the Next route throws, an
  empty 500). A route with its own message (`invalid_body_error`), a lenient read, or the read inside its try (`body_in_try`, batch 6) is
  parity-exact instead. (Batch 1-5 routes that read the body inside their try were specified as plain `json`: there a broken body is this
  400 on the edge and the fallback 502 on Next; both are refusals with nothing sent, recorded here so it is not mistaken for parity.)
- (Fixed in batch 5, no longer a difference.) A path parameter is percent-encoded into the upstream path on both sides: 35 Next handler
  sites that inserted it raw (`/leads/${id}`, so `..%2F` in an id walked the upstream path with the org's key) now encode it, and the
  parity contract holds path-walking ids (`..%2F..%2Fadmin`) for both.
- Sign-in keys unreachable is `503` with Retry-After (the Next route says 401).
- The upstream is still the VERIDIAN backend (`VERIDIAN_API_BASE_URL`): a call costs one VERIDIAN invocation instead of one PROJEXA Vercel
  invocation plus one VERIDIAN invocation.
