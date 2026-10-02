# projexa-sync

PROJEXA local-first sync: a laptop keeps a copy of the projects its person may read (and the organisation data its role allows), works on it with no server, and syncs two ways with Supabase and with other laptops.
**No Vercel in the path.** Spec shared with the laptop code: `projexa/docs/local-first/CONTRACT.md`. Requirements register: `ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md`.

Base: `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync`. Every call: `Authorization: Bearer <PROJEXA Supabase access token>` (verified by `../ai-work-link/session.ts`; `verify_jwt` is false because the token is signed by the PROJEXA Auth project) and, from a laptop, `X-Px-Client: <release>; protocol=2; schema=3`. A release id is `YYYY.MM.DD-NNN` (three digits: `2026.10.02-003`, not `2026.10.02-3`); any other form is treated as a dev build and never blocked.

**CORS (browser laptops).** Allowed origins: `https://projexa-ai.com`, `https://www.projexa-ai.com`, `http://localhost:3100`, `http://localhost:3101`. The preflight allows `authorization, content-type, x-px-client`, exposes `Retry-After`, and is cached for 7200 s (an OPTIONS is one billed invocation per URL per cache period, so keep the route set small and stable). Every answer, errors included (401/404/405/413/426/429/503/500), carries the CORS headers so a browser can read it.

Authority is **never decided here**: the person, the project binding, the row scope and every redaction are the SQL functions' (`projexa_*`, which reuse the AI work link's own `projexa_read_resolve_user`, `ai_work_link__bind`, `ai_work_link__records_core`). An unknown project, an unknown kind, another organisation's project and a project the person may not read are ONE answer: 404.

| Route | Purpose | Migration |
|---|---|---|
| `GET /manifest` | who the person is, their projects, the synced project kinds (28) and `org_kinds` (9), `view_class`, `org_view_class`, `release{current,min_compatible,protocol}` | 0677, 0678, 0680, 0683, 0684 |
| `POST /pull {project_id, kind, after, limit<=500}` | keyset page of one kind (cursor = (updated_at or created_at, id)); each item `{id, updated_at, version, data, sig, sig3}` and the page's `kid` | 0677, 0679 |
| `POST /pull {project_id, kind, ids:[<=200]}` | exact rows (a table without `updated_at` changes without moving the cursor); body up to 16 KB, so 200 ids of 64 characters fit | 0679 |
| `POST /pull {kind, after, limit}` / `{kind, ids}` | an ORGANISATION kind: no `project_id` (absent, null or `"__org__"`); same page, signed with project `__org__` | 0684 |
| `POST /changes {project_id, after_seq, limit<=1000}` | what changed since a sequence number, tombstones included; `after_seq: null` returns only `head_seq`; `project_id: "__org__"` is the organisation feed | 0679, 0684 |
| `POST /ids {project_id, kind, after_id, limit<=5000}` | id inventory (the repair path for deletes); an organisation kind takes no project | 0678, 0684 |
| `POST /push {device_id, ops:[...]}` | a laptop's edits, see **Push** below | 0681 (+ `ai-work-link-exec` `/sync-run-batch`, `/sync-run`) |
| `POST /attest {device_pub_jwk?}` | a 24 h signed statement for peer laptops (org, projects, view class, and `cnf.jkt` when a device key is sent), `holder_bound`, the org `channel`, the per-view-class `class_channel`, the public keys | 0678 |
| `GET /release/current[?files=0]`, `POST /release/register`, `POST /install` | the app release registry (`files=0` leaves out the file table), the owner-published manifest registration (fetched at most once a minute per isolate, whoever asks), one row per laptop install | 0680 |
| `POST /jobs/{enqueue,claim,heartbeat,result,get}` | leased work an online laptop runs for another (display-only types; a result is a proposal) | 0682 |

## What is enforced where
- **Versions.** Every record of the 28 kinds has a `version` (+1 per real change) and an append-only history (`platform.projexa_record_head`, `projexa_change_log`), written by an AFTER trigger that can never block a business write (0679, 0683). A push carries the version the laptop edited; a newer head is a CONFLICT and nothing is written.
- **Signing.** Every pulled row is signed ES256 twice: `sig` over `px2|org|project|kind|id|version|updated_at|sha256(canonicalJSON(data))` and `sig3` over `px3` + `JSON.stringify([org, project, kind, view_class, id, version, updated_at, sha256(...)])` (`sign.ts` `itemMessageV3`). `sig3` commits to the view class the row was redacted for: a receiver verifies it with ITS OWN view class, so a row cut for another class fails. Laptops should move to `sig3`; `sig` stays until they have. A page is never silently unsigned: when a key is configured but cannot be used right now the answer is `503 SIGNING_UNAVAILABLE` (retry), so the laptop's cursor never moves past rows it could not hand to a peer.
- **Push.** The decision (registered write on the AI-link registry, role rank, project readable, op id never reused with other content, 600 ops/hour, 5 create_project/day, conflict by version) is SQL (`projexa_sync_push_begin`); the write is TypeScript in `ai-work-link-exec` (`runSyncOp`: the AI-link path, as the person with the live role, provenance `px-sync:<device>`).
- **Updates.** A laptop OLDER than the server (protocol below `SERVER_PROTOCOL`, or release below `min_compatible`) gets `426 UPDATE_REQUIRED`; a laptop on a NEWER protocol gets a retryable `503 SERVER_UPDATING` (Retry-After 300) and keeps its queue. **Deploy order: this function first, then the release that raises the protocol.** `release/current`, `release/register` and `install` stay reachable either way.
- **Limits** (all in UTF-8 BYTES, refused on Content-Length before reading and while streaming, never after buffering): 120 requests a minute per person (per isolate), bodies 4 KB (pull 16 KB, push 256 KB, jobs: claim/heartbeat/get 2 KB, enqueue 20 KB, result 300 KB), 50 ops per push, 60,000 bytes per op.

## Push
`POST /push {device_id, ops:[{op_id, function_id, project_id, params, record?:{kind,id,base_version}, resolution?}]}` -> `{results:[{op_id, status, record_id?, route?, version?, server?, uncertain?, error?:{code, missing?}}], server_time}`, one result per op, in order.

- **Checked here first, no database call:** op shape (the same rules as the SQL), size <= 60,000 bytes (`TOO_LARGE`; the SQL counted characters and exec counts bytes, so a long Devanagari note used to pass begin and be refused by exec forever), no U+0000, nesting <= 32 (`BAD_OP`). Both are `rejected`.
- **Statuses:** `applied`, `duplicate`, `conflict` (with the current signed `server` row), `rejected` (terminal), `failed` (retry the same op id later), `needs_server` (offer the online path). A failed run is classified from the pipeline's REAL codes (`classifyFailure`, a test fails when `src/lib/pipeline/error-codes.ts` gains an unclassified code): `BACKEND_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `INTERNAL_ERROR` and every unknown code are `failed` (never a terminal loss of the edit); `FUNCTION_NOT_AVAILABLE` is `needs_server`; the business codes (`VALUE_REQUIRED`, `RECORD_NOT_FOUND`, `ALREADY_RECORDED`, ...) are `rejected`.
- **`EXECUTION_UNCERTAIN`** (the write may have happened: exec's answer lost, a 5xx, or the ledger could not be closed) is `status: "failed"` with **`uncertain: true`**: keep the op, do not invent a new op id, do not loop fast on it.
- **Isolation:** an SQL error on ONE op's begin is that op's answer (`BAD_OP` or `BEGIN_FAILED`) and the batch goes on; three in a row stop the push (`RETRY_LATER` for the rest). Service down / not linked before anything ran is the whole answer as before (503 / 403); after something ran, the ops already settled keep their answers (200) and the rest are `failed SERVICE_UNAVAILABLE` / `NOT_LINKED`.
- **Deadline:** no new op starts after 30 s; the rest come back `failed RETRY_LATER` (nothing ran). The push therefore answers inside the laptop's 60 s timeout.
- **Cost:** the ops the SQL lets run go to `ai-work-link-exec` `/sync-run-batch` in ONE invocation (ops on one record still run in order, a failed one holds the later ones); the signed rows come back with one pull-by-ids per kind. A push of 50 ops is 2 invocations instead of up to 51. If `/sync-run-batch` is not deployed (404) it falls back to `/sync-run` per op.
- **Trust boundary of `/sync-run*`:** the exec function's sync routes accept `AWL_SYNC_EXEC_SECRET` when the owner sets it (else `AWL_EXEC_INTERNAL_SECRET`). With `public.projexa_sync_push_claim` deployed (SQL, not yet written), the context that runs is the one the database returns for a `running` ledger row, one-shot; until then the caller's context is used.

## Peers: the handshake step (holder binding)
1. Each laptop generates an ES256 (P-256) key pair once per install, private half non-extractable, and sends the public JWK in `POST /attest {device_pub_jwk}`. The token then carries `cnf: {jkt}` (RFC 7638 thumbprint) and the answer says `holder_bound: true`.
2. In the handshake (offline, no server call), the verifier sends a fresh random `nonce` and its own id; the holder answers with its token, its public JWK and an ES256 signature over `holderProofMessage(nonce, verifierId, jkt)` = `"px-hold" + JSON.stringify([nonce, verifierId, jkt])`.
3. The verifier checks the token (signature, org, view, expiry, projects), then `verifyHolderProof` (`sign.ts`): the JWK's thumbprint equals `cnf.jkt` and the signature verifies. A token copied by another laptop fails here.
4. Until every laptop sends a key, a token without `cnf` is still issued; a verifier that requires `cnf` (recommended once the client ships) refuses it.
5. Signalling: use `class_channel` (one per organisation AND view class: only compatible peers hear each other); `channel` (per organisation) stays for older laptops.

## Tests (PGlite = real Postgres as WASM, plus the real handler)
```
bun test --isolate src/lib/services/projexa-sync-edge-cors.test.ts          # CORS exactly as a browser preflights it (handler-only)
bun test --isolate src/lib/services/projexa-sync-edge-push.test.ts          # push classification, edge op checks, isolation, deadline, batch cost (handler-only)
bun test --isolate src/lib/services/projexa-sync-edge-exec.test.ts          # the exec HTTP contract against the real ai-work-link-exec handler, /sync-run-batch, claim
bun test --isolate src/lib/services/projexa-sync-edge-misc.test.ts          # 426 direction, limits, error branches, caches, attest holder binding, sig3
bun test --isolate src/lib/services/projexa-sync-edge-push-ledger.pglite.test.ts # lost finish, mid-batch failure, transient resend on the real ledger
bun test --isolate src/lib/services/projexa-sync-read.pglite.test.ts        # 0677 read side
bun test --isolate src/lib/services/projexa-sync-keys-ids.pglite.test.ts    # 0678 signing, ids, attest
bun test --isolate src/lib/services/projexa-sync-versions.pglite.test.ts    # 0679 versions, changes, pull by ids
bun test --isolate src/lib/services/projexa-sync-release.pglite.test.ts     # 0680 release registry, install, 426
bun test --isolate src/lib/services/projexa-sync-push.pglite.test.ts        # 0681 push ledger and conflicts
bun test --isolate src/lib/services/ai-work-link-sync-run.test.ts           # the real pipeline run of a pushed write
bun test --isolate src/lib/services/projexa-sync-jobs.pglite.test.ts        # 0682 job queue
bun test --isolate src/lib/services/projexa-sync-more-kinds.pglite.test.ts  # 0683 the 15 extra kinds
bun test --isolate src/lib/services/projexa-sync-org-masters.pglite.test.ts # 0684 organisation masters (SQL functions)
bun test --isolate src/lib/services/projexa-sync-org-routes.pglite.test.ts  # 0684 organisation kinds over the Edge routes
```
Every rule above has a planted-bug (mutation) check recorded in its commit message.

## Organisation kinds (0684)
Nine kinds are **not project-scoped**: `vendors` (`erp_suppliers`), `customers` (`erp_customers`), `companies` (`erp_companies`), `boq_categories` (`construction_boq_categories`), `currencies` (`erp_currencies`), `exchange_rates` (`erp_exchange_rates`), `departments` (`departments`), `org_people` (`users`; not `people`, which is the AI link's project kind) and `cost_visibility` (`cost_visibility_config`). The SQL list is `public.projexa_sync__org_kinds()`, kept apart from the 28 project kinds of `projexa_sync__kinds()`.

**The Edge routing is wired** (commit 71ed701f, tested by `projexa-sync-org-routes.pglite.test.ts`):

| SQL function (service_role only) | Route |
|---|---|
| `projexa_sync_manifest` (replaced, superset) | `GET /manifest` adds `org_kinds: [{kind, project_scoped:false, cursor_field, deletes_supported:true, peer_shareable}]` (only the kinds the role may read) and `org_view_class`; `kinds` stays the 28 project kinds |
| `projexa_sync_org_pull(p_sub, p_email, p_kind, p_after_ts, p_after_id, p_limit)` | `POST /pull {kind, after, limit}`: no `project_id` (absent, null or `"__org__"`); same page shape, items `{id, updated_at, version, data}`, same opaque cursor |
| `projexa_sync_org_pull_ids(p_sub, p_email, p_kind, p_ids)` | `POST /pull {kind, ids:[<=200]}` |
| `projexa_sync_org_ids(p_sub, p_email, p_kind, p_after_id, p_limit)` | `POST /ids {kind, after_id, limit}` |
| `projexa_sync_org_changes(p_sub, p_email, p_after_seq, p_limit)` | `POST /changes {project_id:"__org__", after_seq, limit}`: only the organisation kinds the role may read |

- **Signing.** Items are signed exactly like project rows with `project = "__org__"`; `sig3` uses `org_view_class`. The handler's second money pass for these kinds is not applied (`org_people` must NOT go through `kindDef("people")`); their columns and money are decided in SQL.
- **Scope.** Every query is `t.org_id = <person's organisation>` (one scope string, `projexa_sync__org_src.scope_sql`). Versions and tombstones live in `projexa_record_head` / `projexa_change_log` under the sentinel project `__org__`.
- **Role gate.** Rank (`ai_work_link__role_rank`) ≥ 2 (member) for every kind but `cost_visibility` (≥ 1, so every laptop can hide cost fields the way the server does). Below it: the one 404. A viewer / client_viewer never receives vendor, customer or company data.
- **Columns.** An explicit allow-list per kind, intersected with the columns that exist; never `select *`. Not sent: tax ids, bank accounts, passwords/passcodes, auth ids, login times, risk/sanction screening, internal notes. `org_people` = `id, name, role, is_active, email`, the email masked by `ai_work_link__mask_email` except the person's own. `credit_limit` (vendors, customers) is NULL below rank 3 (the `ai_work_link__hidden_cols` rule).
- **Versions.** For organisation kinds the content hash is over the allow-listed columns only: a login or password change is not a new version.
- **Peers.** Organisation rows may move between laptops only when `org_view_class` is equal; `org_people` rows are `peer_shareable: false` (the person's own row carries their unmasked email).

## Logging
One redacted line per 5xx, per lost exec answer / lost ledger close, per begin failure and per signing outage: the route or SQL function and a status or SQLSTATE class, never a token, an email, a row or an error message. `index.ts` keeps the isolate alive on an unhandled rejection (same listeners as `ai-work-link-exec`).
