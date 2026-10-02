# projexa-sync

PROJEXA local-first sync: a laptop keeps a copy of the projects its person may read (and the organisation data its role allows), works on it with no server, and syncs two ways with Supabase and with other laptops.
**No Vercel in the path.** Spec shared with the laptop code: `projexa/docs/local-first/CONTRACT.md`. Requirements register: `ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md`.

Base: `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync`. Every call: `Authorization: Bearer <PROJEXA Supabase access token>` (verified by `../ai-work-link/session.ts`; `verify_jwt` is false because the token is signed by the PROJEXA Auth project) and, from a laptop, `X-Px-Client: <release>; protocol=2; schema=3`.

Authority is **never decided here**: the person, the project binding, the row scope and every redaction are the SQL functions' (`projexa_*`, which reuse the AI work link's own `projexa_read_resolve_user`, `ai_work_link__bind`, `ai_work_link__records_core`). An unknown project, an unknown kind, another organisation's project and a project the person may not read are ONE answer: 404.

| Route | Purpose | Migration |
|---|---|---|
| `GET /manifest` | who the person is, their projects, the synced kinds (28), `view_class`, `release{current,min_compatible,protocol}` | 0677, 0678, 0680, 0683 |
| `POST /pull {project_id, kind, after, limit<=500}` | keyset page of one kind (cursor = (updated_at or created_at, id)); each item `{id, updated_at, version, data, sig}` and the page's `kid` | 0677, 0679 |
| `POST /pull {project_id, kind, ids:[<=200]}` | exact rows (a table without `updated_at` changes without moving the cursor) | 0679 |
| `POST /changes {project_id, after_seq, limit<=1000}` | what changed since a sequence number, tombstones included; `after_seq: null` returns only `head_seq` | 0679 |
| `POST /ids {project_id, kind, after_id, limit<=5000}` | id inventory (the repair path for deletes) | 0678 |
| `POST /push {device_id, ops:[...]}` | a laptop's edits: each op is a registered AI-link write run through the REAL pipeline as the person; per-op result `applied / duplicate / conflict / rejected / failed / needs_server` | 0681 (+ `ai-work-link-exec` `/sync-run`) |
| `POST /attest {}` | a 24 h signed statement for peer laptops (org, projects, view class), the org channel name, the public keys | 0678 |
| `GET /release/current`, `POST /release/register`, `POST /install` | the app release registry (version, per-file number and version), the owner-published manifest registration, one row per laptop install | 0680 |
| `POST /jobs/{enqueue,claim,heartbeat,result,get}` | leased work an online laptop runs for another (display-only types; a result is a proposal) | 0682 |

## What is enforced where
- **Versions.** Every record of the 28 kinds has a `version` (+1 per real change) and an append-only history (`platform.projexa_record_head`, `projexa_change_log`), written by an AFTER trigger that can never block a business write (0679, 0683). A push carries the version the laptop edited; a newer head is a CONFLICT and nothing is written.
- **Signing.** Every pulled row is signed ES256 over `px2|org|project|kind|id|version|updated_at|sha256(canonicalJSON(data))` (`sign.ts`); a peer laptop verifies it with the public keys of `/attest`. Rows only move between laptops of the same organisation AND the same `view_class` (a signed row cannot be re-redacted).
- **Push.** The decision (registered write on the AI-link registry, role rank, project readable, op id never reused with other content, 600 ops/hour, 5 create_project/day, conflict by version) is SQL (`projexa_sync_push_begin`); the write is TypeScript in `ai-work-link-exec` (`runSyncOp`: the AI-link path, as the person with the live role, provenance `px-sync:<device>`).
- **Updates.** A laptop below `min_compatible`, or on another protocol, gets `426 UPDATE_REQUIRED`; `release/current`, `release/register` and `install` stay reachable.
- **Limits.** 120 requests a minute per person (per isolate), bodies 4 KB (push 256 KB, jobs 300 KB), 50 ops per push.

## Tests (PGlite = real Postgres as WASM, plus the real handler)
```
bun test --isolate src/lib/services/projexa-sync-read.pglite.test.ts        # 0677 read side
bun test --isolate src/lib/services/projexa-sync-keys-ids.pglite.test.ts    # 0678 signing, ids, attest
bun test --isolate src/lib/services/projexa-sync-versions.pglite.test.ts    # 0679 versions, changes, pull by ids
bun test --isolate src/lib/services/projexa-sync-release.pglite.test.ts     # 0680 release registry, install, 426
bun test --isolate src/lib/services/projexa-sync-push.pglite.test.ts        # 0681 push ledger and conflicts
bun test --isolate src/lib/services/ai-work-link-sync-run.test.ts           # the real pipeline run of a pushed write
bun test --isolate src/lib/services/projexa-sync-jobs.pglite.test.ts        # 0682 job queue
bun test --isolate src/lib/services/projexa-sync-more-kinds.pglite.test.ts  # 0683 the 15 extra kinds
```
Every rule above has a planted-bug (mutation) check recorded in its commit message.
