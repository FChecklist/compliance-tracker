# Way 5 owner steps: the software pulls from a connected mailbox or Drive folder on its own (WP-13, AW-605)

Names of secrets only. No value appears in this file, and none is ever committed. Every step below is the owner's or the PM's; the engineer
who built way 5 set, created or ran none of them.

## What way 5 does

A schedule wakes on a clock, as its owner (a person with role member or above), and scans one place that person connected: a Gmail mailbox
or one Google Drive folder. For each new `.xlsx` file it:

1. downloads the file (5 MB at most, `.xlsx` only, and from the senders named in the schedule when it names any);
2. reads it as one job keyed by the file's sha256 (the WP-01 reader first, the extraction and reconciliation of WP-02 after it). The same
   bytes twice are one job, in any folder, however often they are listed;
3. records one PROPOSAL for the person: "new project from a workbook", with the file name, the number of sheets and lines, how many
   questions need an answer, and whether the totals matched. It shows no amount. Nothing is created: no project, no BOQ, no line;
4. moves its cursor past the file, and only after the job row and the proposal are stored. A crash before that is repaired by the next scan
   without a second model call and without a second proposal.

A file that is refused (not a workbook, too large, a total that does not add up, a hostile sheet) creates no proposal. The job row keeps the
reason.

## The trigger is the external scheduler path, not a Vercel cron

```
pg_cron job projexa-scheduler-bridge (every 5 minutes, created INACTIVE, drizzle/0642)
  -> pg_net -> Edge Function projexa-scheduler-bridge
  -> POST <SCHEDULER_BRIDGE_APP_URL>/api/internal/scheduler-bridge/run
  -> runDueSchedules() -> the schedule's job scan_connected_folder
```

`vercel.json` names neither the scan job nor the bridge, and this work did not touch it (`scripts/verify/way5-zoomies.sh` checks that).
No Vercel cron is needed or added. What still runs on the app host is the last hop, because the scan is code of this application (the
workbook reader and the ledger). When Vercel is paused that last hop does not run, so the cron job stays inactive until go-live. An
Edge-only bridge (moving the reader into an Edge Function) is not built; it is a separate decision.

## Owner steps, in order

1. **Connect the mailbox or the Drive folder (OAuth).** The person whose schedule it will be signs in to the app and connects the toolkit
   (`POST /api/connectors` with `gmail` or `googledrive`), completes the Google consent screen, and the connection shows `ACTIVE`. Read-only
   scopes are enough and the only ones the scan uses (`gmail.readonly`, `drive.readonly`; the allow-list is in
   `src/lib/composio-connectors.ts`). The connection is that person's own: a schedule cannot name someone else's connection.
   Prerequisite: `COMPOSIO_API_KEY` in the app environment.
2. **Extraction secrets.** Edge Function `projexa-document-extract`: `PROJEXA_DOCUMENT_EXTRACT_SECRET` and the provider key you name (D-2 of
   the plan). The same `PROJEXA_DOCUMENT_EXTRACT_SECRET` in the app environment. Without them the scan waits and keeps its cursor: every file is
   tried again once they exist (nothing is lost, nothing is skipped).
3. **Scheduler bridge secrets** (already named in `supabase/functions/projexa-scheduler-bridge/README.md`):
   - Vault: `projexa_scheduler_bridge_url`, `projexa_scheduler_bridge_secret`;
   - Edge Function secrets: `SCHEDULER_BRIDGE_APP_URL`, `SCHEDULER_BRIDGE_INTERNAL_SECRET`;
   - app environment: `SCHEDULER_BRIDGE_INTERNAL_SECRET` (same value).
4. **Switch the cron job on** (at go-live, when the app host answers):
   `select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'projexa-scheduler-bridge'), active := true)`.
5. **Create the schedule row.** No screen creates one yet, so this is one insert by the PM or the owner, with the person's `compliance.users`
   id as owner (role member or above) and the product the projects will be made in:

   ```sql
   insert into compliance.pipeline_schedules (org_id, owner_user_id, function_id, params, cadence, next_run_at)
   values ('<organisation id>', '<owner compliance.users id>', 'scan_connected_folder',
           '{"source":"drive","folderId":"<Drive folder id>","productId":"<product id>"}'::jsonb,
           '*/15 * * * *', now());
   ```

   Parameters: `source` (`drive` or `mailbox`), `productId`, and for `drive` the `folderId`. For `mailbox` optionally `label` (a Gmail label)
   and `allowedSenders` (up to 20 addresses; **set it for a mailbox**, because anyone can send a file to a mailbox), and for either
   `maxFiles` (1 to 5, default 3 per run). An unknown key or a wrong value makes the run fail with a stated reason and read nothing.

## What to check after the first run

- `select last_result from compliance.pipeline_schedules where function_id = 'scan_connected_folder'` shows the counts (listed, proposed,
  skipped, refused, waiting, failed) and a stop word when the run stopped early. It never holds a file name.
- `GET /api/v1/projexa/scheduler-proposals` (signed in) lists the proposals: a member sees their own, a manager the organisation's.
- `select count(*) from compliance.audit_logs where action = 'pipeline_schedule.run' and user_id is not null and api_key_id is null` grows
  with each run.

## What is not done, and what is not proven

- **Approving a proposal of a new project has no action yet.** The proposal is listed with its state (`answers` when the extraction has
  questions, `approval` when it is ready). The project's approval list approves only `create_boq` today, and a new project has no project.
  The approve action for this proposal, and the screen that answers the questions, belong to the proposals page work (WP-10) and need the
  owner's answer to D-1 (does one confirmation of a fully read proposal count as asking the human).
- **The live response shapes of the four connector actions are not verified** (`GMAIL_FETCH_EMAILS`, `GMAIL_GET_ATTACHMENT`,
  `GOOGLEDRIVE_FIND_FILE`, `GOOGLEDRIVE_DOWNLOAD_FILE`). They were written from the documentation and read defensively, and a download is
  accepted only when the response carries the file as base64. If the live answer carries only an address to fetch, the scan refuses it with the
  reason `download_shape_unsupported` and nothing is read. Run one scan with a test file at the first connection and read `last_result`.
- **Each new file costs one extraction call** through the Edge Function, under its own spend cap and the ledger's limit of 30 new files an
  hour per organisation. A mailbox with no sender list can spend that budget on files from strangers.
- No Drive or mailbox was connected in any test. The tests use a fake folder (`src/lib/services/__test-helpers__/fake-folder-source.ts`)
  and the stand-in model; the flow on real SQL is `src/lib/services/folder-watch-store.test.ts`.
