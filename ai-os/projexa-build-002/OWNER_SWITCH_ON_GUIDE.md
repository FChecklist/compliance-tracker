# Owner guide: switching on the AI work link write path (PROJEXA-BUILD-002 WP-09)

Status: the write path is built, tested and switched OFF. Nothing described here has been done. Every step below is yours (the owner) or is marked as the project manager's (PM). No step uses Vercel, and no step spends money beyond ordinary Supabase Edge Function calls.

Register rows this guide closes: AW-511 (the kit is complete), and with the smoke test the live proofs of AW-502 and AW-505. The kill switch (section 7) is proven locally by `bash scripts/verify/awl-killswitch-drill.sh`.

## 1. What switching on does

- A person's AI (through a Universal AI Work Link at level 1) can record work progress, attendance, timesheets, meetings and documents in that person's name, directly. A level-2 change (a roster entry, a BOQ revision) is a draft that the person confirms while signed in; once confirmed it is applied.
- Every such write is recorded as a submission with `via = 'ai_link'`, the link's id and the person as the user; the task is recorded as executor `ai` with `model_calls` 0. No model runs on link traffic. The memory row a write leaves is marked `ai_link` and stored without an embedding.
- The role used is the person's role at the moment of the write. A person demoted after making the link is refused (`ROLE_CHANGED`).
- One master switch, `platform.ai_work_link_settings.writes_enabled`, controls every link at once. Turning it off is the kill switch (section 7) and takes effect on the next request.

## 2. Before you start (the PM has done these; ask for a yes on each)

| Item | Where it is proven |
| --- | --- |
| Migrations 0629 and 0630 are applied to the verdian-ai database (`pcrjmlpuqsbocqfwoxod`) | `select count(*) from information_schema.columns where table_schema='compliance' and table_name='submissions' and column_name in ('via','ai_link_id');` returns 2 |
| The `ai-work-link-exec` Edge function is deployed with `verify_jwt` false (built by `bun run scripts/build-ai-work-link-exec.ts`) | Supabase dashboard, Edge Functions |
| The `ai-work-link` function is deployed with the exec client (its constant `EXEC_FUNCTION_PRESENT` is still false) | Supabase dashboard, Edge Functions |
| `writes_enabled` is false | `select writes_enabled from platform.ai_work_link_settings;` returns `f` |

## 3. The two secrets (the only new credentials)

Edge Function secrets are project-wide: every function of the project can read them. That includes the DPDP and PROJEXA functions. If you want the database credential kept from them, create a dedicated pooler role for the exec function first and use its string in step 3b; the code needs no change.

Step 3a. A long random shared secret (any 32 or more random characters). Choose it once and keep it for step 4:

```
supabase secrets set AWL_EXEC_INTERNAL_SECRET="<your random value>" --project-ref pcrjmlpuqsbocqfwoxod
```

Step 3b. The `app_runtime` database connection, through the pooler. It is the same value Vercel's own `APP_RUNTIME_DATABASE_URL` setting holds (do not use the `postgres` role's string: the business writes must run as `app_runtime` under row-level security):

```
supabase secrets set APP_RUNTIME_DATABASE_URL="<the app_runtime connection string>" --project-ref pcrjmlpuqsbocqfwoxod
```

Neither value is ever written into this repository, printed by a script or sent in an answer.

## 4. Pre-flight (read only)

In a shell where you set the same secret as an environment variable (never as an argument):

```
AWL_EXEC_INTERNAL_SECRET="<your random value>" bash scripts/verify/awl-exec-preflight.sh
```

Expected last line: `AWL_EXEC_READY db_role=app_runtime`. Anything else prints one line saying why: `NOT_CONFIGURED` names the missing secret, `401` means the value differs from the one set in step 3a, `DB_UNREACHABLE` means step 3b is wrong, `not app_runtime` means the connection string is the wrong role. Fix it and run it again. Do not go on until it prints `AWL_EXEC_READY`.

## 5. Two switches, in this order

Step 5a (PM). Change `EXEC_FUNCTION_PRESENT` to `true` in `supabase/functions/ai-work-link/config.ts` and redeploy `ai-work-link`. This is the only Edge code change. While `writes_enabled` is still false nothing can run.

Step 5b (you). Apply the prepared migration `ai-os/projexa-build-002/prepared/0645_build002_awl_enable_writes.sql` in the Supabase SQL editor (or ask the PM to apply it through the Supabase MCP after you say go). It refuses unless 0629 and 0630 are in place, sets `writes_enabled = true` and stamps `updated_at`. Check:

```
select writes_enabled from platform.ai_work_link_settings;   -- t
```

## 6. Smoke test on the test project

Use a test person and the test project only.

1. Make a level-1 link for the test person (the "Connect my AI" screen, or ask the PM).
2. Read `GET <link>/context`: `writes_enabled` is true, `level` is 1, `direct_open` is true.
3. Apply one write: `POST <link>/actions` with `{"function":"record_attendance","params":{"rosterId":"<a roster id of the test project>","date":"<today>"},"idempotency_key":"smoke-1"}`. Expect 201 with `status: "done"` and a `record.route`. The same request again is 200 with `replayed: true` and no second row.
4. Read it back in the database:

```
select s.id, s.via, s.ai_link_id, s.user_id, s.model_calls, s.level1_outcome, t.executor, t.function_id, t.status
from compliance.submissions s join compliance.pipeline_tasks t on t.submission_id = s.id
where s.via = 'ai_link' order by s.created_at desc limit 5;
```

Expect `via ai_link`, the test person as `user_id`, `executor ai`, `model_calls 0`, `level1_outcome not_needed`, `status done`.

5. The full conformance harness (24 checks including the one write): `bash scripts/verify/awl-harness.sh full --link A --link-b B --member-link M --revoked-link R --demoted-link D --write` on the test project only (see `scripts/verify/awl-README.md`).

## 7. The kill switch and rollback

Turn every write off at once. Direct actions answer 403 `WRITES_NOT_ENABLED`, confirms answer 503 and wait, drafts keep recording, an intent that is executing finishes or reads `failed EXECUTION_UNCERTAIN` after 10 minutes:

```
update platform.ai_work_link_settings set writes_enabled = false, updated_at = now() where id;
```

The same statement is `ai-os/projexa-build-002/prepared/0645_build002_awl_enable_writes.down.sql`. Proven locally, with no secret, by `bash scripts/verify/awl-killswitch-drill.sh` (expected last line `AWL_KILLSWITCH actions=403 exec=refused rows_written=0 resumed=done`).

Further steps if you want the path removed, not only paused:

1. `supabase secrets unset APP_RUNTIME_DATABASE_URL AWL_EXEC_INTERNAL_SECRET --project-ref pcrjmlpuqsbocqfwoxod` (the exec function then answers 503 `NOT_CONFIGURED` to everything).
2. The PM sets `EXEC_FUNCTION_PRESENT` back to false and redeploys `ai-work-link`, or redeploys its previous version.
3. Records already written are not undone. List them: `select id, raw_input, created_at from compliance.submissions where via = 'ai_link' order by created_at desc;` (each carries its intent id in `raw_input`).

## 8. Known limits (so nothing surprises you)

- The business write and the record of its outcome are two database calls. A crash between them leaves the intent `executing`, read as `failed EXECUTION_UNCERTAIN` after 10 minutes, and it is never run again automatically: check the record it names.
- An executor that did not answer never marks an intent failed by itself: the intent stays `recorded` (the same request runs it) or `executing`. A retry with the same key never writes twice.
- The automation-rule trigger that a progress or labour write fires in the app is skipped for link writes; the rules still run for the same change made in the app.
- The memory row a link write leaves has no embedding, so it does not appear in semantic memory search until a repair pass embeds it.
- The local run of the whole path (no secret, no live data): `AWL_EXEC_INTERNAL_SECRET=<any local string> bun run scripts/awl-local-exec-host.ts --dry`; `--live` runs against the database of your `.env.local` and is for the persona run only.

## 9. What the PM does, in order

1. Builds the bundle (`bun run scripts/build-ai-work-link-exec.ts`; `node scripts/verify/awl-exec-closure.mjs` first) and deploys `ai-work-link-exec` with `verify_jwt` false, and the current `ai-work-link` with the exec client, through the Supabase MCP or CLI. Never Vercel.
2. Applies migrations 0629 and 0630 after the aborted-transaction rehearsal (apply 0630 before merging the pipeline code that writes its columns).
3. After you finish steps 3 and 4, changes `EXEC_FUNCTION_PRESENT` to true and redeploys `ai-work-link` (step 5a).
4. After you finish step 5b, runs the smoke test of section 6 with you and records the result against AW-502 and AW-505.
