# projexa-read (PROJEXA-BUILD-001 U-25, PMD-01)

The identity gateway. A PROJEXA browser session reads verdian-ai construction data of its own organisation by calling this Edge Function with its own PROJEXA access token. No Vercel function is in the path, and no verdian-ai table is granted to `anon` or `authenticated`.

## Request

`GET /functions/v1/projexa-read?fn=boq_lines&projectId=<id>[&after=<line id>][&limit=1..500]` with `Authorization: Bearer <PROJEXA access token>`.

| Answer | When |
| --- | --- |
| 200 `{"fn":"boq_lines","projectId","rows":[...],"nextAfter"}` | the caller is linked and the project belongs to the caller's organisation. Rows: that project's BOQ line items across all its BOQs, ordered by line id (byte order); `limit` defaults to 100; pass `nextAfter` back as `after` until it is `null`. Numbers are strings (exact). `qtyProject` and `rateProject` are never returned (cost-visibility-service.ts is their one gate). |
| 400 | unknown `fn`, missing or malformed `projectId`/`after`, `limit` outside 1..500 |
| 401 `{"error":"Unauthorized"}` | no token, or a token that fails any check below; always the same body |
| 403 `{"error":"Your PROJEXA account is not linked ...","code":"USER_NOT_LINKED"}` | the token is valid but its `sub` maps to no active user of exactly one organisation (not linked, deactivated, or ambiguous) |
| 404 `{"error":"Not found"}` | the project is another organisation's, or does not exist (the same answer, so existence is not revealed) |
| 503 | the switch is off, or the PROJEXA key set could not be fetched |
| 204 | `OPTIONS` preflight |

Every response carries `Cache-Control: private, no-store` and `Vary: Authorization, Origin`. `Access-Control-Allow-Origin` is sent only for `https://projexa-ai.com`, `https://www.projexa-ai.com` and `http://localhost:3100`.

## Token checks (jwt.ts)

Compact JWS, protected header `alg` = `ES256` (none, HS256, RS256 refused before and inside jose), signature by a key of the PROJEXA project's published key set (the Auth project `evpckeuxgvahguwsaeul`, path `/auth/v1/.well-known/jwks.json`; jose fetches it and caches it 10 minutes), `iss` = the PROJEXA Auth issuer, `aud` = `authenticated`, not expired (5 s tolerance), `sub` a UUID, `role` = `authenticated`, not an anonymous sign-in. The key set is public; no signing secret exists anywhere in this function.

## Who the caller is

`sub` is matched against `compliance.users.auth_user_id` by `public.projexa_read_resolve_user`: exactly one active user with an organisation, or nothing. An email match is used only when `platform.projexa_gateway_settings.email_fallback` is on (default off) and then also only for exactly one active user. The organisation is never read from the request.

## Files

- `jwt.ts`: token verification, with jose passed in (no Deno global, no import).
- `handler.ts`: the request handler with verify and RPC passed in, run under bun by `src/lib/services/projexa-read-gateway.test.ts`.
- `index.ts`: `Deno.serve`, `npm:jose`, the key set resolver (built once per isolate) and the service-role client. Nothing else.

## Database objects (drizzle/0618_build001_projexa_gateway.sql, all `service_role` only)

- `platform.projexa_gateway_settings`: one row; `enabled` (the fail-closed switch) and `email_fallback`, both default off. Switched on only by a separate reviewed migration.
- `public.projexa_read_enabled()`: the switch.
- `public.projexa_read_resolve_user(text, text)`: `(user_id, org_id, reason)`; reason is `not_linked`, `deactivated` or `ambiguous`.
- `public.projexa_read_boq_lines(text, text, text, text, integer)`: `{"status": "ok" | "disabled" | "not_linked" | "deactivated" | "ambiguous" | "not_found", ...}`. Filters on `projects.org_id`, `construction_boqs.org_id` and `construction_boq_line_items.org_id`.

## Secrets

None beyond the platform-injected `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Deploy

`verify_jwt` must be **false** (the caller's token is signed by the PROJEXA project, not verdian-ai). Deployed through the Supabase MCP by the PM after the claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` is on `main`, and after migration 0618 is applied. The switch stays off until its own migration.

## Check it worked

With the switch off: any valid token gets 503, no token gets 401. After the switch migration: `bash scripts/verify/projexa-gateway-isolation.sh` with an org A user's token in `PROJEXA_ACCESS_TOKEN` prints `200 404 401 401` (BR-322).
