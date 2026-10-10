# Database saturation: what is already protected, what is left, what only the owner can decide (2026-10-08)

## The problem in plain words
The live database is a small "Micro" server. It allows 60 connections in total. Every running copy of the web app keeps up to 10 of them open.
On 2026-10-01 and 2026-10-02 the connection pool filled up with stuck sessions (mostly the api-key audit writer, `record_api_key_request_batch`),
and every screen that needs the database showed "data service did not respond" until someone cleared the stuck sessions by hand.

## What I checked today (read only, nothing changed)
- `app_runtime` (the role the web app uses) already has `idle_in_transaction_session_timeout = 30s` and `transaction_timeout = 90s` set on the role.
  So a session that sits inside an open transaction doing nothing is cut after 30 seconds, and nothing can hold a transaction open longer than 90 seconds.
- `authenticator` (the REST gateway) has `statement_timeout = 30s` and `lock_timeout = 8s`.
- Server-wide `statement_timeout` is 120 s; `max_connections` is 60.
- At the time of the check there were no stuck sessions: only Supabase's own idle sessions and two idle `authenticator` sessions.

## Decision: no new timeout migration
The protection I would have drafted (an idle or transaction timeout on `app_runtime`) already exists live. Adding another number would change nothing
and risk cutting legitimate long reports. I wrote no migration for this. (If you ever want the live settings kept in the repo as a record, they are
`ALTER ROLE app_runtime SET idle_in_transaction_session_timeout = '30s'` and `SET transaction_timeout = '90s'`; they are not in `drizzle/` today.)

## What is still open (not fixed by timeouts)
1. The 2026-10-03 investigation could not reproduce the stuck sessions by killing or freezing a client. The best-supported cause is the pooler
   (Supavisor) running out of checkout slots when many app copies each hold up to 10 connections: "unable to check out connection from the pool".
2. The 5 second time box around the audit write stops the app waiting, but does not cancel the query, so the connection stays busy until it finishes.
3. Each app copy holds up to 10 pooler connections (`max: 5` in `src/lib/db/index.ts` and `max: 5` in the tenant-scoped client). On a 60-connection
   server, 6 busy copies are enough to fill it. This is a code setting, not a compute setting; lowering it is a change to shared database code
   and I did not touch it in this stage.

## Options (owner decision)
| Option | Cost | Effect |
|---|---|---|
| A. Keep Micro, keep today's timeouts | $0 | Works while traffic is small (offline-first PROJEXA keeps most load on the laptops). A pile-up can still happen if many app copies start at once; clearing it is a one-minute manual step (see below). |
| B. Move to the next compute size in Supabase | paid, monthly | More connections and memory; the surest single fix. Changing compute is yours to approve and I did not touch it. |
| C. Reduce connections per app copy (code change, later) | $0 | Lower `max` in the two database clients and route the audit writer through a single shared connection. Needs a careful test run, so it is a separate task. |

My recommendation: A now, C when the next database code stage opens, B only when real customers are on the live app.

## If it happens again (read first, change second)
1. Read-only: look at `pg_stat_activity` grouped by user and state; list `app_runtime` sessions that are `active` with `wait_event = ClientRead` and a transaction older than 60 seconds.
2. Only if they are all the audit writer: end exactly those sessions (`pg_terminate_backend`) and nothing else. Audit rows in flight are lost, nothing else.
3. Check `https://veridian-compliance-ai.vercel.app/api/health` returns 200 `db:up`.
