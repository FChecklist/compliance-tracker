# Sync freshness: one cheap "what changed across all my projects" call (2026-10-08)

Verdict: **the server already offers it. No server change was needed, none was made.** It is `GET /heads` on the `projexa-sync` Edge function (migration `drizzle/0686_projexa_sync_hardening.sql`, SQL `public.projexa_sync_heads`, handler `supabase/functions/projexa-sync/handler.ts` `heads()`, line ~331).

## Request
```
GET https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync/heads
Authorization: Bearer <PROJEXA Supabase access token>
X-Px-Client: <release>; protocol=2; schema=3
```
No body. One Edge invocation per call, whatever the number of projects. (Because of the Authorization header a browser laptop sends a CORS preflight first; it is cached for 7200 s, so it costs one extra invocation per two hours, not per poll.)

## Response (200)
```
{ "heads": { "<project_id>": <integer>, ..., "__org__": <integer> },
  "projects_etag": "<16 hex> | null",
  "role": "<live role> | null",
  "view_class": "<string> | null",
  "org_view_class": "<string> | null",
  "epoch": "<32 hex> | null",
  "server_time": "<ISO>" }
```
- `heads` has one entry for EVERY project this person may read right now, plus `"__org__"` (the organisation-data feed, counting only the organisation kinds the role may read). A project not in the object is not readable (new access appears as a new key, removed access as a missing key). `0` means no change ever recorded.
- Each value is the newest change-log position (transaction id based, commit-order safe) of that project. It is the same figure `/changes` returns as `head_seq`; a test asserts `/heads` equals the feed head (`src/lib/services/projexa-sync-tracking.pglite.test.ts`, "/heads answers every readable project and the organisation in one call").
- Cost on the database: one backward index probe per readable project plus one for the organisation feed (`LIMIT 1` each). No row data leaves.
- Errors: same set as every route (401, 426 `UPDATE_REQUIRED`, 429 over 120 requests/minute/person, 503, not-linked 403/404). The 120/min cap is irrelevant at poll rates of minutes.

## How the laptop scheduler should use it (documented for the laptop side, not edited here)
1. Every N minutes call `/heads` once. Keep the last answer per project.
2. For each project whose head differs from the stored one: call `POST /changes {project_id, after_seq: <stored cursor>, limit}` (the cursor is the `next_seq` it returned last time), then pull the listed ids. Projects whose head did not move cost nothing more.
3. Call `GET /manifest` only when `projects_etag` changed (a project was added, renamed or its status changed, or access changed).
4. Reset the local copy of the affected scope when `view_class` / `org_view_class` / `epoch` changed (role or cost-visibility change, database rollback). `reset_required: true` from `/changes` means the same for one project.
5. The organisation data is the `"__org__"` entry and `POST /changes {project_id: "__org__", ...}`.

So polling ALL projects every few minutes is one request per poll, not one per project. The current "open project often, others hourly" scheme costs 1 + (open) per few minutes plus hourly per-project calls; `/heads` replaces all of them.

## Cost against the free quota (500K invocations a month; ~108 laptops budget, `ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md` row G4: harness 209 requests per laptop per working day, 22 working days, so 4,598 a month each)
Arithmetic (8 hour working day, 22 days; the harness 209/day is assumed NOT to already contain heads polls, which I could not verify from the repo; if it already does, the numbers below are conservative):

| poll every | calls/day | calls/month | total/laptop/month | laptops inside 500K |
|---|---|---|---|---|
| 15 min | 32 | 704 | 5,302 | ~94 |
| 10 min | 48 | 1,056 | 5,654 | ~88 |
| 5 min | 96 | 2,112 | 6,710 | ~74 |
| 2 min | 240 | 5,280 | 9,878 | ~50 |

Recommendation: 5-minute poll while the app is in the foreground and the laptop online, back off to 15 minutes when idle/hidden; poll only during use (not 24 h). Skip a poll when the previous one is still in flight and use `Retry-After` on 429/503. Dropping the old hourly per-project `/changes` calls gives back part of the budget. Realistic freshness: a change by someone else shows within ~5 minutes at a cost of ~74 laptops on the free quota (the 108 budget holds at a 15-30 minute poll). If more laptops are needed, the server-push alternatives (Realtime) were not examined here.

## Not verified
- No live call was made (Stage 1, local only); the shape above is from the handler, the SQL and the PGlite test. Quota arithmetic uses the document's 209/day figure. Per-project head semantics (xid vs seq) were taken from the migration comments and the equality test, not from running it.
