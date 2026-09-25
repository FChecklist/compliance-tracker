# U-25 spike report: the PROJEXA identity gateway (PMD-01)

Written 2026-09-25 for PROJEXA-BUILD-001 item U-25 (register rows BR-317 to BR-324). Every number below was read on 2026-09-25 with SELECT-only queries (Supabase MCP as postgres, or the pooled `app_runtime` connection) or with a public GET, unless the row says it is cited. Nothing was applied, deployed or written to any database.

The two lines the register greps for (BR-323, BR-324):

exposed_schemas: public,graphql_public,compliance
decision: continue_gateway

The exposed-schemas value is the one the PM read through the Management API on 2026-09-25. It was confirmed independently the same day: a GET to verdian-ai's PostgREST with `Accept-Profile: u25_probe_not_a_schema` answered HTTP 406, code PGRST106, hint "Only the following schemas are exposed: public, graphql_public, compliance".

## 1. Why continue

The spike had three questions. The first two are answered well enough to build on. The third lists what is still unproven, and none of those gaps is a reason to fall back to option (c).

1. **Can the PROJEXA key set be verified with jose?** Yes. The verifier (`supabase/functions/projexa-read/jwt.ts`) runs with the real `jose` 6.2.10 package. It accepts a token from the PROJEXA issuer. It refuses (401) a foreign issuer, a wrong audience, an expired token, alg none, HS256, RS256, a signature by another key with the same kid, an unknown kid, an altered payload and no token. That is 37 tests with a WebCrypto ES256 key pair and an injected key resolver. The production resolver code (`createProjexaKeyResolver`, jose `createRemoteJWKSet`) was also pointed at the real PROJEXA key set: it fetched and imported the live key, and it refused a token signed by another key that carried the live kid (section 2c).
2. **Can the wrapper keep organisations apart?** Yes, but through explicit filters. Row-level security (RLS) cannot do it inside the wrapper, and the report says so plainly rather than claiming it:
   - Postgres refuses `SET [LOCAL] ROLE` inside a SECURITY DEFINER function ("cannot set parameter "role" within security-definer function"; test `why RLS is not the second layer inside the wrapper`, run on PGlite).
   - The wrapper's owner, `postgres`, has `rolbypassrls = true` on verdian-ai, so setting `app.current_org_id` inside the wrapper would change nothing.
   - What does isolate: the organisation comes only from the verified `sub`. Three independently stored columns are each filtered to it: `projects.org_id`, `construction_boqs.org_id` and `construction_boq_line_items.org_id`.
   - Two mutations were tried, and each made a test fail: dropping the project filter, and dropping the BOQ and line filters (section 4).
   - Separately, the tenant policies themselves isolate these tables for `app_runtime`. That was proven live by BR-320 (section 3) and on PGlite.
3. **What is unverified.** See section 6.

The fallback, option (c), would keep reads on Vercel. Nothing found in this spike needs it.

## 2. Measured facts (2026-09-25)

### 2a. Roles and defaults on verdian-ai (`pg_roles`, `pg_default_acl`, `pg_auth_members`)

| fact | value |
|---|---|
| `postgres` | rolsuper false, **rolbypassrls true**, member of `app_runtime` with SET |
| `app_runtime` | rolbypassrls false, login (the pooled role VERIFY_DATABASE_URL uses; user `app_runtime`, port 6543) |
| `service_role` | rolbypassrls true |
| default privileges, schema `public`, functions | EXECUTE to anon, authenticated, service_role for every new function (so 0618 revokes anon and authenticated explicitly) |
| default privileges, schema `platform`, tables | read/write to service_role and app_runtime for every new table (so 0618 revokes both and grants SELECT to service_role only) |
| `compliance.construction_boqs`, `compliance.construction_boq_line_items`, `compliance.projects`, `compliance.users` | RLS on and FORCE; owner postgres; grants to app_runtime and service_role only |

### 2b. Users and links (`compliance.users`, verdian-ai)

| fact | value |
|---|---|
| rows | 1,096 |
| rows with `auth_user_id` | 493 (493 distinct: no id is linked twice; 0 have no org) |
| of those, id present in verdian-ai's own `auth.users` | 400 |
| of those, id NOT in verdian-ai `auth.users` (read as: PROJEXA-linked) | 93 (91 active), across 8 organisations |
| linked rows that are inactive (any source) | 16 |
| emails equal when lower-cased (would be "ambiguous" for the email fallback) | 0 |

The PROJEXA side was **not** re-read: its `auth.users` lives in the other project (evpckeuxgvahguwsaeul), outside this spike's read scope. So the "92 of 114 linked, 22 unlinked" split is **cited** from A09 (IDENTITY_AND_EDGE_FINDINGS.md), not re-measured. The 93 above agrees with it to within one row. That extra row is UNVERIFIED: it could be a stale link or an id from a third source.

### 2c. The PROJEXA key set (public GETs)

| fact | value |
|---|---|
| key set GET | HTTP 200, `Cache-Control: public, max-age=600`, `application/json` |
| keys | 1: kty EC, crv P-256, alg ES256, use sig, key_ops ["verify"], kid prefix `e025e1ba`, no private part |
| OpenID configuration `issuer` | `https://evpckeuxgvahguwsaeul.supabase.co/auth/v1`, the same string as `PROJEXA_ISSUER` in jwt.ts |
| OpenID `id_token_signing_alg_values_supported` | RS256, HS256, ES256. The gateway accepts ES256 only. A token signed with the project's legacy HS256 secret, if the project ever issued one again, would be refused (fail closed). |
| production resolver against the live key set (run under bun) | imported the live key (CryptoKey, public, ECDSA P-256). A token with the live kid but signed by a key made locally: `{"ok":false,"reason":"invalid"}`. A token with an unknown kid: `{"ok":false,"reason":"invalid"}`. |

### 2d. BOQ data and cost of the query (verdian-ai)

| fact | value |
|---|---|
| BOQs / BOQ lines | 7,735 / 15,197 |
| orphan lines; lines whose org differs from their BOQ's; BOQs whose org differs from their project's | 0; 0; 0 |
| organisations with BOQ lines | 6 |
| largest project | 12,168 lines across about 6,558 BOQs (test revisions), so 25 pages of 500 |
| EXPLAIN ANALYZE, one 500-row page of that largest project (the wrapper's query shape) | 40 ms execution, 25 ms planning, all buffers in memory |

### 2e. Grants and guards before 0618 is applied

| check | value |
|---|---|
| BR-321 (anon/authenticated grants on `compliance.construction_*`) | 0 through `sql-assert` as app_runtime (exit 0), and 0 by catalog (`aclexplode`) as postgres |
| guard G-5 (public `projexa_%` executable by anon or authenticated) | 0 |
| `public.projexa_read_%` functions live / `platform.projexa_gateway_settings` live | 0 / absent (nothing applied) |
| `compliance.construction_*` tables | 30 |

**Finding on BR-321's command:** as app_runtime it cannot fail. `information_schema.role_table_grants` shows only grants whose grantor or grantee is a role the current user belongs to. Measured as app_runtime, the view shows 0 `service_role` grants on `compliance.construction_*`, while the catalog shows 120. So the view would also show 0 anon or authenticated grants even if they existed.

A role-independent form was run as app_runtime through `sql-assert` and answered 0 (exit 0):

`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname = 'compliance' and c.relname like 'construction%' and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))`

The PM should consider amending BR-321 to that form.

## 3. BR-320 run against the live database (read only, always rolled back)

`bash scripts/verify/gateway-crossorg-sql.sh` with VERIFY_DATABASE_URL = the DATABASE_URL line of `.env.local`, which is app_runtime through the transaction pooler. The first attempt ended `cannot run: query or connection error: write CONNECT_TIMEOUT aws-1-ap-south-1.pooler.supabase.com:6543` (exit 2; a pooler connect timeout). The immediate retry printed:

```
role=app_runtime bypassrls=false
candidates: compliance.organisations visible with no organisation set = 0 (0 expected under its app_runtime policy)
candidates: distinct compliance.users.org_id visible with no organisation set = 192
candidates tried: 3; organisations with visible BOQ lines found: 2
as 1850e900: other org 4ecc472f lines=0 boq headers=0; own lines=1
as 4ecc472f: other org 1850e900 lines=0 boq headers=0; own lines=12173
transaction rolled back (read only; nothing written)
CROSS_ORG_ROWS=0 OWN_ORG_ROWS_NONZERO=yes
```

It exited 0 (`PASS BR-320`). Under its app_runtime policy, `compliance.organisations` shows no row when no organisation is set. So the candidate organisations come from `compliance.users`: its policy `app_runtime_preauth_read_users` lets app_runtime read users while no organisation is set. Each candidate is then set in turn and asked what it can see.

## 4. Tests and falsifiability

`bun test --isolate src/lib/services/projexa-read-gateway.test.ts`: 37 pass, 0 fail, 202 expect() calls.

Each mutation below was applied to the real source, the file was run, and the source was then restored byte for byte (sha256 compared):

| mutation | result |
|---|---|
| none (baseline) | 37 pass |
| drop the issuer check (jwt.ts) | 2 fail (foreign issuer; handler 401 set) |
| drop the audience check (jwt.ts) | 1 fail |
| drop the project org filter (0618) | 1 fail |
| drop the BOQ and line org filters (0618) | 2 fail |
| grant `projexa_read_boq_lines` to anon (0618) | 1 fail (grants and G-5) |
| leave app_runtime's default grant on the switch table (0618) | 1 fail |
| email fallback always on (0618) | 1 fail |
| handler echoes the wrapper's rows on a 404 | 1 fail |
| handler logs the token | 1 fail |

Other checks:

- `bash scripts/verify/rollback-replay.sh`: `ok 0618_build001_projexa_gateway restored h0=317e7dee63eeb3d7f1a288a70ffb5fed h1=32fc3c5432719c2dee3f8d9d8edb98a0 h2=317e7dee63eeb3d7f1a288a70ffb5fed (n_objects 241/270/241; schemas compliance,public,platform); DO block PASS_ROLLED_BACK`, and `SCHEMA_HASH_MISMATCH=0` over all 4 listed migrations.
- BR-322 self-test (`bash scripts/verify/projexa-gateway-isolation.sh --self-test`, local fake gateway): a correct fake gives `200 404 401 401` (exit 0). A fake that wrongly accepts the altered token gives `200 404 401 200` (exit 1). The token was never in the output.

## 5. SHARED_BOUNDARY.md

- **R5: no conflict.** The three `public.projexa_read_*` functions are SECURITY DEFINER with EXECUTE for `service_role` only. After apply, G-5 is expected to stay 0. The PGlite test asserts the same G-5 query, with Supabase's default EXECUTE-to-anon/authenticated reproduced.
- **R4: needs a one-line amendment.** R4's `public` row still reads "ONLY `projexa_timer_*` functions". The claim merged in #1856 added `platform.projexa_gateway_settings` to the `platform` row but did not add `projexa_read_*` to the `public` row. Per R2, the PM updates it (and section 6's Edge Function table) when 0618 is applied and the function deployed.
- **R6: no Vercel action.**

## 6. UNVERIFIED (said plainly)

- **No real PROJEXA-signed token was available.** No PROJEXA session was minted (forbidden in verify commands), and the owner has not supplied one. So acceptance of a genuine PROJEXA access token is unproven. In particular these are unseen: its exact claims (`iss`, `aud`, `role`, `sub`, `email`, `is_anonymous`), and that its header says ES256 with the live kid. The tests use a locally generated key and tokens shaped like Supabase's. The only end-to-end proof is BR-322, which is blocked until the owner runs it.
- **The Supabase Edge runtime (Deno) never ran this code.** There is no Deno and no Docker on the laptop, and no deploy is allowed. `index.ts` (Deno.serve, `npm:jose@6.2.10`, `npm:@supabase/supabase-js@2`) is not typechecked or executed by any test, the same as projexa-timer's `index.ts`.
- These platform behaviours are unproven until deploy:
  - that the function relay passes a foreign-project JWT through untouched when `verify_jwt` is false;
  - that the relay needs no `apikey` header;
  - how the relay answers an `OPTIONS` preflight.
- A token stays usable until its `exp` (default 1 hour) after the user signs out of PROJEXA. The gateway does not call PROJEXA's Auth API to check the session, because that would need a PROJEXA key.
- The 92/22 split is cited, not re-measured (section 2b).
- `jose` is not a direct dependency in `package.json`. It is present only as the hoisted transitive dependency of `@modelcontextprotocol/sdk` (bun.lock pins it to 6.2.10). The test imports it from `node_modules` and asserts that its version equals the `npm:jose@` pin in `index.ts`. If the SDK drops jose, the test breaks loudly. Adding `jose` 6.2.10 as a devDependency is a PM decision; it touches `package.json` and `bun.lock`.
- The first BR-320 attempt failed on a pooler connect timeout. The retry passed. The script's exit-1 path (a visible cross-organisation row) was not provoked live, because that would need a write or a policy change.
