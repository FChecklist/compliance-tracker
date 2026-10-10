# Package lf-c2-jobs (laptop app, repo projexa)

Branch `claude/lf-c2-jobs` from `origin/feat/lf-client-core` if it exists, else `origin/feat/local-first-complete`.

## Goal
Owner clarification: "the system knows who is online and hands work to an online user's browser, which runs it on that user's RAM and CPU and returns the result". Build the work-offload CLIENT for the backend job queue: `POST /jobs/enqueue`, `/jobs/claim`, `/jobs/heartbeat`, `/jobs/result`, `/jobs/get` (read compliance-tracker `origin/feat/lf-sync-backend`: `drizzle/0682_projexa_work_jobs.sql` and `supabase/functions/projexa-sync/handler.ts` `jobs()`).
Rules (enforced server side; your client must respect and test them): job types are only `boq_rollup`, `csv_export`, `report_preview`, `search_index`; by default a job runs on the REQUESTER's own device(s); a colleague only if the requester opted in (visibility `project`); leases of 60 s with heartbeats (max 5 min); a result is a PROPOSAL (never used to write money or approvals: results are only for display/export); a requester always has a local fallback (it computes the same thing itself) so offload never blocks work.

## Build under `src/lib/local-first/jobs/`
1. `job-types.ts`: for each of the 4 types a PURE deterministic function over local-database rows (runs in a Web Worker): `boq_rollup` (totals by category / parent line from boq_lines with only the money columns the person may see: null-safe), `csv_export` (rows of a kind to CSV with proper escaping and a stable column order), `report_preview` (a small table summary of one kind), `search_index` (a tokenised inverted index of titles/descriptions of a project's records for local search).
2. `worker.ts` + a typed message protocol, run in a real Web Worker in the browser and in-process in tests (injectable runner), with a 50 ms main-thread budget test (chunk + yield) for 10,907 BOQ lines.
3. `runner.ts`: the claim loop. Poll `POST /jobs/claim` ONLY while the tab is visible, the device is idle and the person has not opted out. Cost rule: one tiny request per interval per idle laptop, and the interval is adaptive: 20 s with recent activity, 120 s otherwise, 0 when hidden/offline/low battery/data-saver. Heartbeat while running, submit the result, honour lease expiry, never run a job whose project is not in the local manifest, never run unknown types. Expose a "Your machine is helping" indicator state for the UI (small, calm) and an opt-out setting stored in the local database.
4. `requester.ts`: enqueue a job and wait for the result with a timeout, then fall back to computing locally.
5. Presence: Supabase Realtime presence on the organisation channel is OPTIONAL: expose a hook that lists online colleagues but never block on it.

## Tests
Unit tests for each job type (golden inputs/outputs), the worker protocol, the claim loop with a fake clock and a fake server implementing the 0682 semantics (lease expiry, attempts, view class), the adaptive polling (no requests while hidden/offline/opted out), fallback after timeout, requester-only default, opt-out.
PLANT: poll while hidden; running an unknown type; ignoring the lease expiry; a result submitted after expiry treated as success locally; no fallback; each must be caught.
