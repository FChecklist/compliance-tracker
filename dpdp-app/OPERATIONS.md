# How the DPDP product runs itself (WO-DPDP-015)

Nothing here needs a person on a Monday. This page says what runs by itself, how each piece is proved, and what a red light means.

## What runs by itself

| What | Where | When | If it fails |
|---|---|---|---|
| Monday digest emails (one per active member) | pg_cron `dpdp-monday-digest` → Edge Function `dpdp-monday-email` | Mon 00:30 UTC (06:00 IST) | `dpdp-monday-retry` tries again at 01:30, 03:30 and 06:30 UTC, but only if this week has no complete run |
| Leak-clock / rights-clock reminders | pg_cron `dpdp-legal-clocks` | daily 03:30 UTC | the next day's run |
| Public site + external AI work link check | GitHub `DPDP live smoke` | daily 05:15 UTC and after every site deploy | the run turns red; GitHub emails the watchers |
| The site itself (`veridian-aios.com`, `www`, `app.`) | GitHub `dpdp-app deploy` → Cloudflare Pages, one project `veridian-dpdp-app` | every merge that touches `dpdp-app/` | the deploy run turns red |
| Every mail sent to `dpdp@veridian-aios.com` (ticket, class, notice to the operator, acknowledgement) | Cloudflare Email Routing → Email Worker `dpdp-inbound-mail` → Edge Function `dpdp-inbound-mail` → `dpdp.mail_inbound` | on arrival | the Worker forwards the raw original to the fallback Gmail; nothing is dropped (see "Single mailbox" below) |
| Sales Partner emails (welcome, referral signed up, commission earned, payout sent, details changed) | pg_cron `dpdp-partner-mail` → Edge Function `dpdp-partner-email` | every 30 minutes | the notices stay in `dpdp.partner_notice`; the next run tries again (5 tries) |
| Sales Partner monthly statement email | pg_cron `dpdp-partner-statements` → `dpdp-partner-email` `{"job":"statements"}` | 11th of the month, 03:30 UTC (09:00 IST) | queued once per partner per month, so a re-run never sends a second copy |

The Monday run goes through one organisation at a time, so one slow or broken organisation cannot stop the others. Every run writes one row to `dpdp.timer_run` (`ok`, `partial`, counts, error). A digest is unique per person per week, so running it again never sends anyone a second copy.

**Look at this week's Monday run** (Supabase SQL editor):

```sql
select week_key, ok, partial, orgs, digests, sent, skipped, failed, started_at
from dpdp.timer_run where job = 'monday' order by started_at desc limit 5;
select public.dpdp_timer_monday_done(now());   -- true once this week's run is complete
```

`ok = false` means at least one organisation failed or the time budget ran out: read `error`, the retry job has already been asked to go again. To run it by hand, POST `{"job":"monday"}` to the function with the timer secret (the cron reads it from Vault `dpdp_timer_secret`); add `"orgId":"…"` and `"dryRun":true` to try one organisation without sending.

Addresses on reserved test domains (`*.test`, `example.*`, `*.invalid`, `localhost`) are never sent to, only recorded as skipped.

## How it is proved

| Proof | Command | What it covers |
|---|---|---|
| Every role, both editions, on the real database | `bun test --env-file=.env.local src/lib/services/dpdp-editions-roles.test.ts` (set `DPDP_REQUIRE_DB=1` so an unreachable database fails instead of skipping) | a new visitor opens their own organisation; owner, Grievance Officer, coordinator, staff, group members, the CA and the client's owner each see the right page and only their own jobs, act, get their Monday digest, and use the external AI work link at the right authority. It runs inside one transaction that is rolled back, so it leaves nothing behind. |
| The Monday timer | `bun test --env-file=.env.local src/lib/services/dpdp-timer.test.ts` | digests, escalation, email links, unsubscribe |
| The static app in a browser | `cd dpdp-app && VITE_MOCK=1 bun run build && bunx playwright test` | 126 checks: the 70 acceptance checks, each role's screens, both landing pages start to finish |
| The live site | `node dpdp-app/scripts/live-smoke.mjs` | every public page, the two landings' links, the external AI link's refusals, the Monday worker's bearer check |
| The mailbox code (classifier, handler, taxonomy) | bare `bun test --isolate` at the repo root, which is what CI runs (via `src/lib/services/dpdp-mail-edge-functions.test.ts`) | every class and rule, the never-drop default, the acknowledgement guards, the Gmail filter file, the payment-proof mail, the placement-test envelope |
| The Email Worker | `cd workers/dpdp-inbound-mail && bun test` (not in CI: it needs its own `bun install`) | the fallback forward on every failure, the 128 KiB read cap, `postmaster@`/`abuse@`, the Worker → function → database round trip on PGlite |

## What a red light means

- **DPDP live smoke red, "Start free"/"Sign in" lines:** the deployed site is older than `main`. Check the `dpdp-app deploy` run.
- **DPDP live smoke red, `/ai/…` lines:** the external AI work link path is broken (Cloudflare function or the `dpdp-ai-link` Edge Function). Redeploy `dpdp-ai-link`.
- **`dpdp_timer_monday_done` false on Monday afternoon:** read `dpdp.timer_run.error` and the Edge Function logs for `dpdp-monday-email`.
- **`dpdp-editions-roles.test.ts` red:** a role saw something it should not, or could not do something it should. The failure message names the role.
- **A mail in the operator's Gmail with the header `X-Veridian-Fallback-Reason`:** the ticketing path failed and the Worker forwarded the original instead. The value says why (`post_http_401` = wrong secret, `post_http_502` = the notice could not be sent, `post_timeout`, `config_missing`, `parse_unusable`, `oversize_full_copy` = a big mail that was also ticketed). The mail may have no ticket, so read it and, if it matters, forward it to `dpdp@` to give it one. `role_mailbox:postmaster` / `role_mailbox:abuse` are not failures: those two addresses are forwarded on purpose.

## Switches

- `DPDP_INTERNAL_AI_ENABLED=1` (Next.js app only) brings back the older in-app AI pages. Off by default; the external AI work link is the DPDP way.
- The AI work link in the Monday email (Edge Function secrets; all FAIL CLOSED, a typo turns the feature off or read-only, never up): `DPDP_EMAIL_AI_LINK_ENABLED` and `DPDP_EMAIL_AI_CHANGES_ENABLED` are on when unset or exactly `1`; `DPDP_EMAIL_AI_LINK_LEVEL` is `1` (read + small edits + drafts) when unset or `1`, anything else is read-only; `DPDP_EMAIL_AI_LINK_DAYS` is exactly `1`, `7` or `30` (default `7`). The link is a credential: a new one every Monday, the previous one retired after the new email has gone. Emergency stop for every live emailed link: `update dpdp.ai_link set revoked_at = now() where label = 'Monday email' and revoked_at is null;`. Keep Resend click tracking OFF for the sending domain. Details in `supabase/functions/dpdp-monday-email/README.md`.

## Single mailbox (dpdp@veridian-aios.com)

The public shows exactly one address, `dpdp@veridian-aios.com`. Everything the platform sends comes from `VERIDIAN AI DPDP <dpdp@veridian-aios.com>` (Resend sending domain `veridian-aios.com`), and everything that comes back to it is sorted, given a ticket number and put in front of the operator. **Nothing is silently dropped or demoted.** A grievance or a data-subject request must never miss its clock or its acknowledgement, whatever tag, thread or header the mail arrived with.

**Status when this section was written (2026-09-29): none of it is live.** The migration is not applied, the Edge Function and the Worker are not deployed, Email Routing is not pointed at the Worker, and the Resend domain is not confirmed as verified. The go-live list below is the order to do it in. Until it is done, do not let a page or an email tell people to write to `dpdp@` unless mail sent there already reaches a person.

### How a mail travels

```
 a person, a customer, another system
        |   writes to dpdp@   dpdp+<tag>.<ref>@   grievance@ / partners@ (old, still answered)
        |                     postmaster@ / abuse@ (RFC 2142 role mailboxes)
        v
 Cloudflare Email Routing (zone veridian-aios.com), each rule = "Send to a Worker"
        |
        v
 Email Worker  dpdp-inbound-mail            workers/dpdp-inbound-mail
        |   refuses every other address (bounce "Unknown recipient")
        |   postmaster@ / abuse@  -> forwarded untouched to the fallback Gmail, no ticket
        |   reads at most 128 KiB, parses it, POSTs JSON with a bearer secret
        v
 Edge Function  dpdp-inbound-mail           supabase/functions/dpdp-inbound-mail
        |   1. find the mail we sent that this answers (the ref in the address, or In-Reply-To)
        |   2. classify it (tag, thread, auto-mail, keywords, default = review)
        |   3. write a row in dpdp.mail_inbound with a ticket number   (drizzle/0662)
        |   4. grievance / data request / review: acknowledge the sender
        |   5. grievance / data request only: email the operator a notice at once (every other class: the daily digest, about 09:00 IST)
        |   6. sales and DPDP_SALES_FORWARD_TO set: forward the message there (Reply-To = the sender)
        v
 the operator's Gmail   [GRIEVANCE G-2026-0042] original subject      (Gmail labels, see below)

 ANY failure on the way (Worker misconfigured, function down or slow, database down, notice
 not sent) ==> the Worker forwards the raw original to the fallback Gmail. Nothing waits in a queue.

 Mail going OUT: dpdp-monday-email, dpdp-invoice-email and the acknowledgement send through Resend
 From dpdp@ with Reply-To dpdp+<tag>.<ref>@, a subject prefix "[VERIDIAN DPDP · <Class>]",
 the headers X-Veridian-Class / X-Veridian-Ref, and a row in dpdp.mail_outbound.
```

### The classes

One list, in `supabase/functions/_shared/mail-taxonomy.ts` (never rename a tag: old mail still carries it). A test keeps this table in step with it.

| Class | Tag in the address | Label in subjects | Ticket letter | Legal clock, acknowledged | Operator told | What it is |
|---|---|---|---|---|---|---|
| `grievance` | `grv` | GRIEVANCE | G | **yes** | **yes, at once** | a grievance or complaint |
| `data_request` | `dsr` | DATA REQUEST | D | **yes** | **yes, at once** | withdraw consent, erase, access, correct (also an unsubscribe by email) |
| `review` | `rev` | REVIEW | R | **yes** | no, daily digest | could not be classified: handled with grievance priority. It is also the default when nothing matched, so it is never "unknown, ignore" |
| `clock` | `clk` | Statutory | K | no (see below) | no, daily digest | a reply to a statutory notice WE sent (72-hour leak clock, rights clock) |
| `monday` | `mon` | Monday | M | no | no, daily digest | a reply to the Monday digest |
| `sales` | `sal` | Sales | S | no | no, daily digest (+ forward if `DPDP_SALES_FORWARD_TO` is set) | a new sales enquiry |
| `sales_chain` | `sch` | Sales thread | T | no | no, daily digest | a reply inside an outbound sales conversation |
| `invoice` | `inv` | Invoice | I | no | no, daily digest | about an invoice we sent, or a payment proof |
| `partner` | `prt` | Partner | P | no | no, daily digest | a partnership or reseller enquiry |
| `support` | `sup` | Support | H | no | no, daily digest | product help |
| `auto` | `aut` | Auto | A | no | **no, logged only** | a bounce, an out-of-office, a delivery notice |

- **Who is emailed, and when (owner decision 2026-10-01).** Per message, at once: only `grievance` and `data_request` (and a message the classifier failed on). Every other class is only recorded in `dpdp.mail_inbound` and listed in **one daily digest** (about 09:00 IST, [DPDP daily digest] N new tickets), sent only on a day when at least one non-auto, still-open ticket arrived that no earlier digest listed. A `sales` message is also forwarded to `DPDP_SALES_FORWARD_TO` when that secret is set. See "Operator daily digest and sales forward" below. A `review` ticket (could not be classified) is still acknowledged to the sender but reaches you in the digest, up to a day later: check the digest every morning.
- **Order of deciding, first match wins:** (1) the sender is our own mailbox (`auto`, loop guard); (2) machine-only signals, meaning a mailer-daemon or postmaster sender, an empty return path, a delivery-status content type (`auto`, and never raised: a bounce is a bounce); (3) auto-mail headers the sender chose (`Auto-Submitted`, `X-Autoreply`, `Precedence: bulk`, an out-of-office subject) (`auto`, unless the person's own words carry a legal keyword, see the next point); (4) the tag in the address; (5) the thread (In-Reply-To / References names something we sent); (6) keywords in the subject and the first 4096 characters, English and Hindi/Hinglish, in the order data request, grievance, invoice, partner, sales, support; (7) otherwise `review`. Exact rules and their order live in the header of `supabase/functions/dpdp-inbound-mail/classify.ts`; a deliberate mail to a legal tag (`grievance@`, `dpdp+grv@`) is not diverted to `auto` by headers.
- **Escalation (the owner's rule: a legal request never misses its clock, whatever it arrived on).** When the class chosen is not a legal-clock class, or auto-mail headers chose `auto`, the classifier runs only the data-request and grievance keyword rules over what the person actually wrote (quoted text, "On ... wrote:" blocks and our own footer removed). A hit raises the class and keeps where it came from in the reason, for example `tag:mon; escalated keyword:data_request:"..."`. So "stop sending me these, delete my data" as a reply to the Monday digest is a data request, and "thanks for the invoice" stays an invoice. If no keyword hits and the person wrote nothing of their own above the quoted original (a reply typed *below* it, which Thunderbird does by default), the mail becomes `review` instead of the class of its tag, because it cannot be read safely; a bottom-posted reply that has a line of the person's own above the quote ("Hi,") is still filed under its tag. A reply in a script the keyword lists do not cover (Bengali, Tamil, Gujarati, Urdu and the other non-Devanagari Indian scripts) is a `review` too, because nobody can read it automatically; English, Hindi, Hinglish and Marathi are read.
- **`auto` is deliberately hard to reach.** An `aut` tag typed into an address is ignored; machine-only signals decide it; sender-chosen headers decide it only when nothing legal was written. It is the one class logged without telling the operator.
- **`clock` is not itself a legal-clock class.** It labels a reply to a statutory notice we sent (the platform sends those as class `clock`); the reply is not a request. If its own words contain a data-subject request or a grievance, escalation (above) raises it to `data_request` or `grievance`, whatever tag or thread it arrived on.
- **The keyword lists are over-inclusive on purpose** (a false data request costs the operator one ticket; a missed one costs a clock). A message written only in another language is `review`.
- **Ticket numbers:** `<letter>-<year>-<number>`, for example `G-2026-0042`. The year is the Indian calendar year; the number counts up per letter and year (never a duplicate, and no gap for a mail that was recorded), and simply grows past 9999.

### What each subject looks like

| Where | Subject | Sent to |
|---|---|---|
| Platform mail out (for example the Monday digest and invoices) | `[VERIDIAN DPDP · Monday] the original subject` (the prefix is added once, never stacked on a reply) | the customer |
| Acknowledgement | `[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0042)`; for a review ticket `[VERIDIAN DPDP] We received your message (ticket R-2026-0007)`, with no class word, so the sender never sees our internal "REVIEW" | the sender, only for grievance / data request / review |
| Notice to the operator | `[GRIEVANCE G-2026-0042] original subject` (also `[Sales ...]`, `[Sales thread ...]`, `[Invoice ...]`, `[Monday ...]`, `[Statutory ...]`, `[Partner ...]`, `[Support ...]`, `[DATA REQUEST ...]`, `[REVIEW ...]`) | `DPDP_OPERATOR_EMAIL` |
| Notice when the classifier itself failed | `[CLASSIFIER FAILED R-2026-0007] original subject` (filed as review) | the operator |
| Raw copy when the database was down | `[GRIEVANCE UNRECORDED] original subject`, no ticket | the operator |
| Alert when a Resend inbound message could not be processed (Resend refused or failed the fetch, an unexpected error) | `[UNPROCESSED <resend email id>] original subject`, no ticket yet (the message is still in Resend and Svix retries for about a day); the body says what to do | the operator |
| The Worker's fallback forward | the original subject, untouched, plus the header `X-Veridian-Fallback-Reason` | the fallback Gmail |

The notice starts with a summary (class and the rule that chose it, ticket, "Respond by", from, to, the ticket it answers, acknowledgement status) and then quotes the message. Attachments are not stored anywhere; the notice only says there were some.

### The legal clock

- **Which mail starts one:** `grievance`, `data_request` and `review`. Each gets a ticket with a **due date** (`due_at` = received time + `DPDP_LEGAL_RESPONSE_DAYS` days, an Edge Function secret, whole days 1 to 365), an acknowledgement to the sender, a "Respond by" line in the operator's notice, and, with the Gmail filters below, a star and Important.
- **`DPDP_LEGAL_RESPONSE_DAYS` defaults to 90. That number is the owner's and counsel's to confirm.** The code asserts nothing legal: it only stops a ticket sitting unnoticed. The acknowledgement says the message was received, gives the ticket number and says we will respond; it states no deadline and no statute.
- **The acknowledgement is held back, and the ticket and notice still happen,** when: the mail carries sender-chosen auto-mail headers and was not raised to a legal class (an auto-responder answering an auto-responder is a loop; a raised message is acknowledged whatever headers it carries, except a header-flagged reply to our own acknowledgement); the sender is our own mailbox or a no-reply / postmaster / mailer-daemon / bounce address; the sender failed DMARC (backscatter to a forged address); or three acknowledgements already went to that sender in 24 hours, or thirty to anyone in the last hour (the operator's notice then says to answer by hand). A held-back acknowledgement is not retried. The acknowledgement never repeats anything the sender wrote, not even their subject.
- **Nothing chases a ticket that passes its date.** The due date is stored and indexed, but no job emails about an overdue ticket. Until one exists, look at the open list weekly (query below) and treat a starred, un-actioned Gmail notice as overdue work.
- **A mail to `postmaster@` or `abuse@` has no ticket, no acknowledgement and no clock:** it is only forwarded. If one turns out to be a grievance or a data request, forward it to `dpdp@` so it gets one.

### Working a ticket

1. The notice arrives in Gmail, labelled `DPDP/...`. The three legal-clock classes are starred and marked Important.
2. Read it. The rule line says why it got that class; if that is wrong, the ticket still stands: act on what the person actually wrote.
3. Answer with **Reply** on the notice: its Reply-To is the original sender, so the answer goes straight to them. Choose **From: dpdp@veridian-aios.com** (set up below). Leave the ticket number in the subject: it is what the person was told to quote.
4. See what is open (Supabase SQL editor):

```sql
select ticket_no, class, status, received_at, due_at, from_addr, subject
from dpdp.mail_inbound
where status <> 'closed'
order by due_at nulls last, received_at;
```

5. Close it when done. Nothing else ever closes a ticket:

```sql
select public.dpdp_mail_close('G-2026-0042', 'answered by email 30 Sep');
```

A follow-up from the same person is a **new ticket**; it names the earlier one in its notice ("In reply to") only when the earlier message was one we sent and logged. Tickets are not merged.

### What happens when something breaks

| What goes wrong | What happens | What you see |
|---|---|---|
| Worker vars or secret wrong, function down, slow (8 s) or answering non-2xx | The Worker forwards the raw original to `FALLBACK_FORWARD_TO`. No ticket unless the function got as far as writing one. | The original in the fallback Gmail with `X-Veridian-Fallback-Reason` (`post_http_401`, `post_timeout`, `config_missing`, ...) |
| Database down | The function emails the operator the raw message, no ticket. | `[CLASS UNRECORDED] subject` |
| Resend inbound: the function cannot read the received message (the API key may only send, Resend is down, the message is gone) | The webhook is answered 502, so Svix retries for about a day; the operator is emailed once per message. No ticket and no acknowledgement until a retry works. | `[UNPROCESSED <resend email id>] subject`. Fix the cause; the retry (or the reconcile job) then makes the ticket. |
| The operator notice cannot be sent (Resend domain not verified, no `DPDP_OPERATOR_EMAIL`, no `RESEND_API_KEY`) | The message is recorded with its ticket, the function answers 502, and the Worker forwards the original. | The original with `X-Veridian-Fallback-Reason: post_http_502`; a row in `dpdp.mail_inbound`; no acknowledgement went out |
| The classifier throws | Filed as `review`, raw copy in the notice. | `[CLASSIFIER FAILED ...]` |
| A mail over 128 KiB (a scan, a photo) | Ticketed from its head (`truncated`) **and** the whole original is forwarded. | Two mails: the notice, and the original with `oversize_full_copy` |
| The same delivery twice (a lost reply made the Worker forward as well) | One ticket; the operator may see the mail twice. | A duplicate is normal after a fault, not a second request |
| `postmaster@` / `abuse@` | Forwarded untouched, not ticketed. | `role_mailbox:postmaster` or `:abuse` |
| Any other address at the domain | Bounced with "Unknown recipient". | The sender's own bounce; nothing in the log |
| The forward to the fallback Gmail itself fails (address not verified in Email Routing) | The Worker throws and the sender's server is told the delivery failed. This is the last resort; it is why "verify the fallback address" is a go-live step. | A bounce at the sender |

### Retention: the owner's call

`dpdp.mail_inbound` keeps each mail's subject, the sender's address and the **first 4096 characters of the text** (which can hold whatever personal data the sender typed) until someone deletes them. Attachments are never stored. **No retention period is set and nothing deletes or redacts anything, `dpdp_mail_close` included.** How long a closed ticket's excerpt, subject and address may be kept is the owner's decision with counsel; decide it, then add a job for it. The same question applies to the copies in the operator's Gmail, and to what Resend and Cloudflare keep in their own logs (not covered here).

### Operator daily digest and sales forward (owner decision 2026-10-01)

**Digest.** `drizzle/0667_dpdp_operator_daily_digest.sql` adds `dpdp.mail_inbound.digested_at`, two service_role-only functions (`dpdp_mail_digest_pending`, `dpdp_mail_digest_mark`) and the pg_cron job `dpdp-operator-digest` (`30 3 * * *`, 03:30 UTC = 09:00 IST). The job POSTs `{"job":"operator_digest"}` to the `dpdp-inbound-mail` function using the same Vault secrets as `dpdp-monday-retry` (`dpdp_timer_url` with the function name swapped, `dpdp_timer_secret` as bearer), so there is no new secret to create. The function sends ONE plain-text email to `DPDP_OPERATOR_EMAIL` only if at least one non-auto, not-closed ticket was recorded in the last 25 hours and has not been in an earlier digest; the email lists ticket number, class, age, sender and subject (never the message text). After the send the listed tickets get `digested_at`, so nothing repeats. A quiet day sends nothing.

- **Check it ran:** `select jobid, jobname, schedule, active from cron.job where jobname = 'dpdp-operator-digest';` and `select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'dpdp-operator-digest') order by start_time desc limit 5;` (a `succeeded` run means the HTTP request was sent; the function's answer is in `net._http_response`, and in the function's logs as `{"evt":"dpdp-inbound-mail","job":"operator_digest",...}`).
- **See what the next digest would list:** `select public.dpdp_mail_digest_pending();` (service role).
- **Run it by hand:** `curl -X POST https://<ref>.supabase.co/functions/v1/dpdp-inbound-mail -H "Authorization: Bearer <DPDP_INBOUND_SECRET>" -H "Content-Type: application/json" -d '{"job":"operator_digest"}'` - answers `{"ok":true,"sent":...,"count":N}`.
- **Honest limits:** a ticket is only listed if it was recorded within 25 hours of the run, so if the cron is down for more than a day, older undigested tickets are NOT listed automatically (find them with `select ticket_no, class, from_addr, subject, received_at from dpdp.mail_inbound where digested_at is null and class <> 'auto' and status <> 'closed' order by received_at;`). `review` and `clock` tickets now reach you in the digest, up to a day after they arrive (the sender of a `review` is still acknowledged at once).
- **Gmail:** `workers/dpdp-inbound-mail/gmail-filters.xml` has a filter that labels the digest `DPDP/Daily digest` and keeps it out of Spam; re-import it (duplicates of the older filters are harmless).

**Sales forward.** Set the Edge Function secret `DPDP_SALES_FORWARD_TO` to one plain address (for example a colleague's mailbox). From then on every message filed as `sales` is also forwarded there: From `DPDP_EMAIL_FROM`, `Reply-To` the original sender (so Reply answers the enquirer), subject `[Fwd Sales S-2026-0042] original subject`, the original text under one line saying what it is. Unset it to stop; with it unset sales mail is only recorded and listed in the digest. No address is stored in the code or the database. A failed forward is logged (without the address) and never loses the message: it is recorded and in the digest.

**Go-live order for this change:** (1) apply `drizzle/0667` to the live database (the same procedure as 0662/0666, via the Supabase Management API `database/query`; the file is idempotent and creates the cron job only because `pg_cron` and `pg_net` exist there); (2) redeploy `dpdp-inbound-mail` (verify_jwt stays OFF); (3) optionally set `DPDP_SALES_FORWARD_TO`; (4) run the digest once by hand (above) and confirm the email, then confirm `digested_at` is set on the listed tickets and a second run sends nothing. Until step (2) the old behaviour (an email per message, every class) stays in force; applying only step (1) is harmless.
### Gmail set-up for the operator (once)

**Labels and stars.** Import `workers/dpdp-inbound-mail/gmail-filters.xml`: Gmail on the web, signed in as the operator, Settings (gear) → See all settings → Filters and Blocked Addresses → **Import filters** → Choose file → Open file → tick all → **Create filters**. It applies these labels: `DPDP/Grievance`, `DPDP/Data request`, `DPDP/Review`, `DPDP/Sales`, `DPDP/Sales thread`, `DPDP/Invoice`, `DPDP/Monday replies`, `DPDP/Statutory`, `DPDP/Partner`, `DPDP/Support`. It also stars and marks Important the three legal-clock classes (grievance, data request, review) and the classifier-failure notice, and sets "never send to Spam" on every notice. **No filter archives, mutes, deletes or forwards anything.** Gmail matches a subject by word anywhere in it, not by "starts with", and the filters also require From `dpdp@veridian-aios.com`, so a notice whose original subject contains another class word may carry two labels: harmless. If `DPDP_EMAIL_FROM` is ever set to a different address, change the `from` values in the file to match before importing. Tick "Also apply filter to matching conversations" only if there is already mail to label.

**Send mail as dpdp@veridian-aios.com** (so an answer goes out from the one public address):

1. Resend → API Keys → create a **new key with "Sending access" only**, named for Gmail. Do not reuse the full-access key, and never write the key into a file, a chat or this repository.
2. Gmail → Settings → Accounts and Import → **Send mail as** → Add another email address. Name `VERIDIAN AI DPDP`, address `dpdp@veridian-aios.com`.
3. SMTP server `smtp.resend.com`, port `465`, Secured connection using SSL, username `resend`, password = the key from step 1.
4. Gmail sends a confirmation mail to `dpdp@veridian-aios.com`. It arrives through Email Routing and the Worker like any other mail, as a ticketed notice in the operator's inbox: open it and use the code or link. (Email Routing must already be live, so do this after the drills.) If no notice shows up, the classifier may have filed it as `auto`, which is logged without a notice: read its `excerpt` in `dpdp.mail_inbound` in the SQL editor. This step has not been tried on the real system.
5. When replying to a notice, pick the `dpdp@` From address. Sending through Resend keeps the mail signed for `veridian-aios.com`; sending as `dpdp@` through Gmail's own servers would not.

**Replies and the tag.** Mail the *platform* sends carries `Reply-To: dpdp+<tag>.<ref>@veridian-aios.com`, so when a person hits Reply their answer is classified from the address alone, with no keyword guessing, and tied to the message it answers. A reply the operator types *in Gmail* has From `dpdp@` and no tag, and it is not logged in `dpdp.mail_outbound`: the person's next answer goes to plain `dpdp@`, is classified by its words, and becomes a new ticket. It is still ticketed and never dropped, but it will not join a thread. Keep the ticket number in the subject of every manual reply.

### Go-live checklist, in this order

**Which path.** On 2026-09-29 the owner chose **Resend inbound** to receive mail for `dpdp@veridian-aios.com`: the domain's root MX points at Resend (`inbound-smtp.ap-northeast-1.amazonaws.com`, receiving is already enabled on the Resend domain), Resend stores each message and sends the Edge Function a Svix-signed webhook (`email.received`), and the function fetches the full message from Resend and runs the same pipeline as before. The Cloudflare Email Worker in the diagram above is the **optional alternative** and stays in the repository; the list below is the Resend path, and the Worker steps are at the end. What the function does with a webhook, its answers, its recipient rules and the reconcile job are in `supabase/functions/dpdp-inbound-mail/README.md`, section "Resend inbound".

**Read this before step 6.** Resend accepts **every** address at `veridian-aios.com`. The Worker used to bounce the addresses nobody publishes; Resend does not. From the moment the root MX points at Resend, **any human mailbox on this domain (Google Workspace, an alias, a forward: `rajat@`, `hello@`, ...) stops receiving mail**, and what people write to it is filed as a logged-only `auto` ticket (reason `unknown-recipient`) instead of reaching them. Only `dpdp@`, `dpdp+<tag>@`, `grievance@`, `partners@`, `postmaster@` and `abuse@` reach a person. Make the list of live addresses first and decide what happens to each.

Nothing on this list had been done when it was written. Steps 1 and 2 are decisions and can start now; the rest are actions on live systems.

1. **Decide:** confirm `DPDP_LEGAL_RESPONSE_DAYS` (default 90) with counsel; decide the retention rule above (it can wait until there is real volume, but not longer); confirm the operator address (`raajat.agarwal@gmail.com` today); **list every live address at the domain and decide for each one** (see the warning above).
2. **Resend:** the sending domain `veridian-aios.com` must show **Verified** (everything that sends from `dpdp@`, that is the acknowledgement, the operator notice and steps 9 and 10, fails until then); receiving must be enabled on it (it is). Check what SPF/MX the bare domain already has before touching it (it also carries Google Workspace addresses, and step 6 changes its MX).
3. **Apply `drizzle/0662_dpdp_single_mailbox_mail_log.sql`** (additive: three tables, six `public.dpdp_mail_*` functions for the service role only). Check that `dpdp.mail_inbound` exists.
4. **Set the Edge Function secrets** (Supabase dashboard → Edge Functions → Secrets; run `supabase secrets list` first): `DPDP_RESEND_WEBHOOK_SECRET` (the `whsec_...` signing secret of the Resend webhook endpoint), `DPDP_INBOUND_SECRET` (48+ random characters; it also protects the reconcile job), `DPDP_OPERATOR_EMAIL` (must not be `dpdp@` itself), `RESEND_API_KEY` (the function uses it to fetch the received message, so it must be allowed to read received emails; the digest functions share it), and **delete or update a stale `DPDP_EMAIL_FROM`** that still names `send.veridian-aios.com`: it overrides the new default for all three functions. Optional: `DPDP_LEGAL_RESPONSE_DAYS`.
5. **Deploy the function with JWT verification off:** `supabase functions deploy dpdp-inbound-mail --no-verify-jwt` (Resend presents a Svix signature, not a Supabase JWT; with it on, every webhook would be refused before it reached the code). Through the Supabase MCP `deploy_edge_function`: `verify_jwt: false` and the files `index.ts`, `handler.ts`, `classify.ts`, `resend-inbound.ts` and `../_shared/mail-taxonomy.ts`. Then **register the webhook in Resend** (Webhooks → add endpoint): URL `https://<project-ref>.supabase.co/functions/v1/dpdp-inbound-mail`, event `email.received`. Send the dashboard's test event: an answer of `502` (its fake email id cannot be fetched) proves the signature is right; `401` means the secret in Supabase is not the one Resend shows, `503` that a secret is unset.
6. **Swap the root MX to Resend** (Cloudflare DNS, zone `veridian-aios.com`), and remove the MX records that pointed at Cloudflare Email Routing or at anything else that must stop receiving. Only after the addresses in step 1 are dealt with. Check the change has propagated before the drills.
7. **Drills, all of them:** mail to `dpdp@` gives a ticket and a notice in the operator's inbox that states the SPF / DKIM / DMARC verdicts and the Resend received-email id; `dpdp+grv.k3f9x2ab7q@` keeps its tag; `grievance@` arrives as a grievance and `partners@` as a partner enquiry; a random address (`info@`) gives an `A-` ticket and **no** notice; `postmaster@` and `abuse@` give a `support` notice and **no acknowledgement**; a grievance sent from a different mailbox produces an **acknowledgement in that mailbox's inbox, not its spam**; then run the reconcile job once with `{"job":"reconcile","hours":1}` (bearer `DPDP_INBOUND_SECRET`) and check that it lists the drill messages and creates nothing new.
8. **Gmail:** import the filters and add the Send-mail-as address (section above).
9. **Deploy the outbound functions** `dpdp-monday-email` and `dpdp-invoice-email` (they now send From `dpdp@` with the tagged Reply-To). Only after step 2 is Verified. Send one test digest to yourself, check the Reply-To, reply to it, and confirm it arrives as a `Monday` ticket.
10. **Publish the site last:** merging the change that names `dpdp@` (and points the billing widget's payment-proof link at it) deploys through `dpdp-app deploy`. Merge it only once step 7 has passed, then run `node dpdp-app/scripts/live-smoke.mjs`.
11. **A week later:** read the `unknown-recipient` tickets (`select ticket_no, received_at, from_addr, to_addr, subject from dpdp.mail_inbound where class = 'auto' and classifier_reason like '%unknown-recipient%' order by received_at desc;`), look at the webhook's delivery log in the Resend dashboard for failed deliveries, and run the reconcile job for the past week if any failed; decide whether the old `grievance@` / `partners@` addresses can go (nothing breaks if they stay).

**If the Cloudflare Worker is used instead of Resend inbound** (the optional path): replace steps 5 to 7 by the following, and keep the rest. Deploy the function as in step 5 (the Worker needs no webhook, only `DPDP_INBOUND_SECRET`); deploy the Worker (`cd workers/dpdp-inbound-mail`, `bun install`, `bunx wrangler login`, `bunx wrangler secret put DPDP_INBOUND_SECRET`, `bunx wrangler deploy`; its vars `DPDP_INBOUND_URL`, `FALLBACK_FORWARD_TO`, `MAX_RAW_BYTES = "131072"` come from `wrangler.toml`); in Cloudflare Email Routing look at the domain's existing MX records first, add and **verify the fallback Gmail as a destination address**, create rules `dpdp`, `postmaster`, `abuse`, `grievance` and `partners` → **Send to a Worker** → `dpdp-inbound-mail`, and give every live human address its own rule to a verified destination *before* any catch-all is turned on, because the Worker refuses addresses it does not own; then run the drills in `workers/dpdp-inbound-mail/README.md`, "Verify after deploy", including **the fallback drill** (a deliberately wrong secret must land the mail in the fallback Gmail with `post_http_401`).

## Online payment (Razorpay)

**What it is.** The owner's Billing panel has a "Pay online" button (yearly plan, Rs 9,999). It calls the Edge Function `dpdp-pay`, which makes a Razorpay Payment Link and sends the browser to Razorpay's own page; no card field exists on our site. Razorpay then calls `dpdp-pay/webhook`; the function checks the signature, checks that amount and currency equal what we asked for, records the payment exactly once through the existing `dpdp_record_confirmed_payment` (org goes active, referral commission is created) and emails a receipt. The manual path ("I have paid by bank transfer" and your own confirmation screen) is unchanged and is what the app shows until the keys below exist (the function then answers 503 "Online payment is not switched on yet").

**What you do (6 steps, all yours; nobody else needs to see a key):**

1. Create a Razorpay account at razorpay.com and finish KYC for the company. Start in **Test mode**.
2. Dashboard > Account & Settings > API Keys > generate a key. You get a Key Id and a Key Secret.
3. Dashboard > Account & Settings > Webhooks > add `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-pay/webhook`, choose a webhook secret you invent, and tick exactly: `payment.captured`, `payment_link.paid`, `order.paid`.
4. Supabase dashboard > Edge Functions > Secrets: set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (the one from step 3). Type them there yourself; never paste them in chat or a file.
5. Test in Test mode: press Pay online from a trial organisation and pay with Razorpay's test card or test UPI. Within a minute the panel says "Payment received, thank you", the organisation shows active, and `select * from dpdp.razorpay_event order by created_at desc limit 5;` shows `recorded`.
6. Go live: in Razorpay switch to Live mode, generate Live keys and a Live webhook (same URL, same three events), replace the three secrets with the Live values.

**Deploy (PM, after CI is green and 0673 is applied):** `dpdp-pay` with `verify_jwt: false` (Razorpay cannot send a Supabase JWT; the create endpoint checks the caller's own JWT in the database), files `index.ts`, `logic.ts`, `../_shared/mail-outbound.ts`, `../_shared/mail-taxonomy.ts`, `../_shared/billing-mail.ts`. Same for `dpdp-lifecycle-email` (verify_jwt false, cron bearer).

**What to look at when something is wrong.**

| Symptom | Where |
|---|---|
| Money arrived but the org is not active | `select * from dpdp.razorpay_event order by created_at desc;` outcomes: `amount_mismatch`, `currency_mismatch`, `unknown_order`, `attempt_already_paid` mean it was NOT booked on purpose; the org's event log also gets a `payment_review_needed` line. Confirm by hand (the owner screen) after checking the Razorpay dashboard. |
| Razorpay shows webhook failures | Edge Function logs for `dpdp-pay`; 401 = wrong `RAZORPAY_WEBHOOK_SECRET`, 503 = a secret is missing. Razorpay retries for about 24 hours. |
| Same payment sent twice | Booked once; the repeat is logged `duplicate`. |

**Trial and renewal reminders.** Job `dpdp-sales-lifecycle` (04:00 UTC daily) posts to `dpdp-lifecycle-email`: trial ends in 10 days, in 3 days, and the day it ends ("your data is safe, access unchanged"); yearly renewal 30 and 7 days ahead. Owner only, one send per reminder (`dpdp.sales_reminder_sent`), each with a 3-day catch-up window so an organisation whose trial ended long ago gets nothing. An owner who unsubscribed from the weekly email is skipped. With no `RESEND_API_KEY` it only counts what it would send. Preview: `select public.dpdp_sales_due_reminders();` (service role). **Before the first live run, read that list:** it is exactly who would be mailed.

**Cost.** Nothing monthly on our side: the Edge Functions and cron are inside the existing Supabase plan. Razorpay charges a per-transaction fee (about 2% plus GST at the time of writing; check razorpay.com/pricing) and no monthly fee.

**Honest limits.** The yearly price lives in two places that must match (`dpdp_plan_price_paise` in 0673, and what the panel shows); a test fails if they differ. The webhook is verified, but no test here has talked to Razorpay itself: do step 5 before telling anyone it works.

||||||| 0f8cadf0

## Sales Partner programme (2026-10-01)

Migration `drizzle/0674_dpdp_sales_partner_lifecycle.sql`, Edge Function `dpdp-partner-email`, the app screens `SalesPartner` (the partner) and `OwnerPartnerPayouts` (the Owner), the public pages `/partner/` and `/partner/terms/`.

**The partner's path.** Anyone signed in opens *Sales Partner* (top bar of the page, the Share box, or the "Open your organisation" screen), accepts the terms (version recorded in `dpdp.partner_terms_acceptance`) and gives UPI or bank details. Status is `applied` until both are done, then `active` (no manual approval). The Owner can set `paused` or `ended` any time (*Partner payouts* panel, bottom right, VERIDIAN team only). A sign-up through the code of a partner who is not `active` is recorded as blocked (`partner_not_active`); a partner who owns or belongs to the organisation earns nothing, checked at sign-up and again when the payment is confirmed. A person who never opened a partner profile keeps the older behaviour (their Share code still works and a commission still appears in the ledger), but it is held in the payout run until they finish the set-up.

**Defaults, all in the one row `dpdp.partner_setting` (the Owner changes them in the panel, or with `dpdp_admin_partner_set_settings`):** commission payable 30 days after the payment is confirmed (the refund window); payout once a month on the 10th for everything payable before the end of the previous month; minimum payout Rs 500 on the net amount, smaller balances carry forward; terms version `1.0`. These are the current terms, marked on the public page as changeable with 30 days' notice.

**Tax (TDS).** The ledger keeps gross, TDS and net on every commission. No tax rate is written anywhere in the code, the pages or the emails. `tds_percent` starts unset and **a payout cannot be marked paid until the Owner (with the CA) has set it** (0 is allowed): the panel shows a red line until then. The rate in force on the day the payout is marked is stored on each commission. Pending lines on the partner's dashboard show an estimate marked "est.".

**The monthly payout run (the 10th).**
1. Open *Partner payouts*, check the TDS % and the minimum.
2. Pick the month (the default list starts at the previous month). The list shows each partner's lines, gross, TDS, net, and the full UPI / bank details (the one place they are shown in full, to the Owner only). A red line means the details were changed in the last 7 days: confirm with the partner before sending.
3. *Download payout list (CSV)*, then send the money by UPI or bank transfer, outside this system.
4. Type the UTR next to each partner and press *Mark paid*. That flips their commissions to paid, stores gross/TDS/net, writes one `dpdp.partner_payout` row (append-only; the same UTR twice never pays twice) and emails the partner. Below the minimum is listed but cannot be marked paid. People who cannot be paid yet (paused, terms not accepted, no payout details, never a partner) are listed under *Held*.
5. On the 11th each partner gets a statement email; they can also download any month as a CSV.

**Refunds.** The public terms say a commission is cancelled if its payment is refunded or reversed before the commission is paid. There is no cancel function: do it by hand in the SQL editor while the commission is still `pending` (`delete from dpdp.referral_commission where id = '<id>' and payout_status = 'pending';`) and write a line in `dpdp.partner_event` if you want a record. Decide whether to build a `void` status before there is real volume.

**Privacy.** The payout detail table has row level security on, no policy and no grant: only the `public.dpdp_partner_*` / `dpdp_admin_partner_*` functions reach it. Partners only ever read masked values. No audit row, email, log line or AI link carries a payout detail (`src/lib/services/dpdp-partner-email.test.ts` fails if the AI link, Monday or invoice function code names the table). Visits to the public site are not counted anywhere (the static pages run no counting script), so the dashboard shows signed up / in trial / paying, not visits.

**Proof.** `bun test --isolate src/lib/services/dpdp-partner-lifecycle.pglite.test.ts` applies the migration (twice) on PGlite and runs `scripts/dpdp/partner-lifecycle-scenario.sql` (about 90 checks: the lifecycle, the guards, the 20% / 5% commissions, payable dates, TDS arithmetic, the payout run, privileges, append-only tables). `node scripts/dpdp/partner-lifecycle-live-test.mjs` runs the migration text plus the same scenario (and the real `dpdp_create_my_org` attribution) against the live project in one rolled-back transaction; add `--applied` once the migration is live. `bun test src/lib/referral-chain.test.ts` (in `dpdp-app`) pins the whole share link → `ref.js` → localStorage → `createMyOrg` → RPC chain.

**Go-live order.** (1) CI green. (2) Apply `drizzle/0674` live (the file is idempotent and creates the two cron jobs only where `pg_cron` and `pg_net` exist, with the Vault secrets the other DPDP jobs already use). (3) Deploy `dpdp-partner-email` with `--no-verify-jwt` (files `index.ts`, `flush.ts`, `render.ts`, `../_shared/mail-outbound.ts`, `../_shared/mail-taxonomy.ts`). (4) Set the TDS % in the panel. (5) Run `partner-lifecycle-live-test.mjs --applied`, then deploy the site (`dpdp-app deploy`). The mail function sends only when `RESEND_API_KEY` is set; otherwise it reports a dry run and leaves every notice waiting.

## Where the website lives (since 2026-09-28)

`veridian-aios.com`, `www.veridian-aios.com`, `dpdp.veridian-aios.com` (the signed-in app, since 2026-10-01) and the legacy `app.veridian-aios.com` (kept working for links in emails already sent) are all served by the one Cloudflare Pages project `veridian-dpdp-app` (free plan, no server). The domain's DNS is on Cloudflare (zone `veridian-aios.com`, free plan); the registration (renewal 14 July each year) is still held at Vercel, which only stores the registration and the two Cloudflare nameservers `dina.ns.cloudflare.com` / `toby.ns.cloudflare.com`. Vercel does not serve any page for this domain and is not needed for it. Email-sending records for Resend live in the same Cloudflare zone. The sending identity is `dpdp@veridian-aios.com` (Resend sending domain `veridian-aios.com`, once it shows Verified in Resend; see the go-live list above). Historical note: until 2026-09-29 mail was sent from the subdomain `send.veridian-aios.com`; those records were created under that name and can stay in the zone until nothing sends from it, but nothing new should use `send.`. If a page ever shows a Vercel "DEPLOYMENT_PAUSED" 503 again, the nameservers at the registrar have been changed back: set them to the two above.

## Sign-in emails through Resend (owner-run, one command)

Until this is done the sign-in link goes out through Supabase's built-in mailer, which delivers only to addresses on the project's own team and is capped at a few an hour -- a customer who is not on that list never receives it. Everything else about mail is already on Resend (send + receive verified, DMARC published).

`scripts/dpdp/set-auth-smtp.mjs` moves the sign-in mail to Resend. It changes only the Auth SMTP fields of Supabase project `pcrjmlpuqsbocqfwoxod` (host `smtp.resend.com`, port 465, user `resend`, sender `dpdp@veridian-aios.com` / "VERIDIAN DPDP", password = a Resend API key with sending access, plus the hourly cap). Dry run is the default and changes nothing:

```
SUPABASE_ACCESS_TOKEN=<Supabase personal access token> node scripts/dpdp/set-auth-smtp.mjs
RESEND_API_KEY=re_...  SUPABASE_ACCESS_TOKEN=... node scripts/dpdp/set-auth-smtp.mjs --apply
node scripts/dpdp/set-auth-smtp.mjs --revert-note      # how to go back
```

Two things to know before running it. (1) That Supabase project is shared: the compliance-tracker web app signs people in with it too, so from then on its sign-in emails also come from `dpdp@veridian-aios.com`. (2) Resend has its own daily send cap on the plan in use; a Monday send to many people can reach it -- check the plan before a large customer list goes live. The script never prints a key; after `--apply`, send yourself one from the sign-in page to confirm it arrives.

## Lawyer review pack

The 59 library jobs, the guidance shown for each (`supabase/functions/dpdp-ai-link/playbook-data.ts`) and the law each one cites (`law.ts`) were written and checked by AI. **No lawyer has reviewed them, and the pages say so.** `dpdp-app/docs/LAWYER-REVIEW-PACK.md` gathers everything counsel needs in one place -- the 44 law codes with their plain meaning and the product's own open `verify` notes first (21 today), then every job with its guidance and boxes to tick -- and `lawyer-review-checklist.csv` is the same list as a spreadsheet for comments. Both are generated (`bun scripts/dpdp/gen-lawyer-review-pack.ts`) and a test fails if they fall out of date; every box is left empty on purpose. A reviewer's corrections are made in `law.ts` / `playbook-data.ts` through an ordinary reviewed change, and a `verify` note is removed only when the reviewer has confirmed that point.

## The original landing page, `/original/` (since 2026-09-30)

`veridian-aios.com/original/` is a frozen static copy of the original VERIDIAN COGNITIVE AI OS landing page (the research-lab home page that `src/app/page.tsx` renders on the Next.js app; it is not the PROJEXA page and not the DPDP home page). It lives in `public/original/` (`index.html`, `original.css`, `logo-mark.svg`, `fonts/*.woff2`), which Vite copies into `dist/` untouched, so it is not one of the registered pages in `src/lib/public-surface.mjs` and the fact-block rules for registered pages do not apply to it. The tracker-host scan and the brand-spelling scan cover it; the banned-word, hidden-text, no-script and fact-block checks apply only to registered pages. It also carries `<!--email_off-->` around the body so Cloudflare's email obfuscation does not rewrite its mailto links or inject a script.

How it differs from the Next.js original, and why: no JavaScript at all (the visitor-analytics component was left out on purpose); `noindex, nofollow` and absent from the sitemap and `llms*.txt`, so it is an archive page, not a second front door (delete the `robots` meta tag in `index.html` if that should change); the product, Join Us and Contact links open an email to `dpdp@veridian-aios.com` with a subject, because the product pages live in the Next.js app and are not on this host; the four legal links (Terms, Privacy, Data Policy, Disclaimer) in its footer were dropped for the same reason. The copy is otherwise unchanged, including the "Live" badges and the "50+ modules" line, which describe the products as they were on the Next.js app.

To refresh it from a newer `src/app/page.tsx`: run that app, save the rendered HTML and its one CSS file, strip the `<script>` tags, point the CSS font `url()`s at `fonts/`, copy the referenced `.woff2` files, drop the source-map comment, and re-apply the link changes above. Then `bun run build` here must stay green.

## Remaining fixes (2026-10-02)

- **Unknown addresses are a real 404.** `public/404.html` ships at the site root; Cloudflare Pages then stops answering unknown paths with the home page and a 200. It is noindex, has no script and no canonical. `scripts/check-public-surface.mjs` fails the build if it is missing or wrong, and `src/lib/not-found-page.test.ts` pins it. Nothing under `/app/`, `/act/`, `/p/`, `/copy/`, `/unsubscribe/` depended on the fallback.
- **A reminder is not sent twice.** `dpdp-lifecycle-email` sends with an `Idempotency-Key` (organisation + reminder key) and only a failed *send* marks a reminder `failed`; a log-write or "mark sent" failure after Resend accepted the mail is ignored or retried (3 tries). A run summary line `sent_unrecorded` means the mail went but the mark could not be saved. Needs the function redeployed.
- **Migration `0676`** (not applied yet; the PM applies it): a rejected renewal claim keeps an active organisation active; approving a claim for an organisation with no edition gives a plain message; `dpdp_ai_link_billing_notice(token)` lets the AI link say "Payment pending" once a free trial has ended. The notice never locks anything. Until `0676` is applied the AI link simply shows no notice.
- **AI link:** `GET <link>/manual.md?brief=1` is the short manual (about a third of the size); the full one is unchanged and points to it. The 410 says where to make a new link. The page tells the AI to answer in the person's language and not to translate the law text (Hindi legal text is still pending a human review).

## Search, speed and monitoring for veridian-aios.com (2026-10-02)

All of this is free: no paid service, no new account, nothing a visitor has to accept.

### What measures the site, and where the numbers are

| What | Where it lives | What it tells you |
|---|---|---|
| **First-party monitoring** | `public/rum.js` (loaded by every public page and the 7 legal pages) → `POST /api/telemetry` (`functions/api/telemetry.ts`, logic in `_telemetry.ts`) → free Cloudflare D1 database `dpdp-telemetry` (binding `DB` in `wrangler.toml`, tables in `data/telemetry.sql`) | page views per day and per page, where visitors come from (referrer site name only), country, phone/tablet/computer, Core Web Vitals (LCP, CLS, INP, FCP, TTFB) overall and per page, JavaScript errors (crash reports), files that failed to load or answered 404/500, slow or failed API calls |
| **Outside-in uptime and response time** | GitHub workflow `DPDP site health` (hourly) → `scripts/site-health.mjs` | is every page up, how long the first byte and the whole page took, timeouts (15 s, after one retry), a real 404 for unknown addresses, `www` → apex redirect, TLS certificate days left. A problem turns the run red and GitHub emails the repository's watchers: that email is the crash / timeout alarm. The response-time table is in each run's summary. Measured from a GitHub data centre, so it catches outages and regressions, not a visitor's phone in India |
| **What the pages say** | GitHub workflow `DPDP live smoke` (daily and after every deploy) → `scripts/live-smoke.mjs` | the pages, links, sitemap, `/rum.js`, the beacon endpoint, the company line, the AI work link's refusals |
| **Build-time proof** | `bun run build` → `check-public-surface.mjs`, `check-claims.mjs`, `check-two-doors.mjs` | titles, descriptions, canonicals, Open Graph, JSON-LD, sitemap (public + legal pages), robots, headers, the two scripts, the company line, the IndexNow key file, `rum.js` rules |

### Read the monitoring report

```
curl -s -H "Authorization: Bearer <REPORT_KEY>" "https://veridian-aios.com/api/telemetry?days=7"
```

`days` is 1 to 90 (default 7). The answer is plain text: page views per day, top pages, referrers, countries, devices, speed overall and per page with a GOOD / NEEDS WORK / POOR verdict at Google's limits, JavaScript errors, files that failed to load, API problems, problems per day, and how much of the day's row budget is used. Without the key (or with a wrong one) the endpoint answers a bare 404, so it does not advertise itself.

The key is the Pages secret `REPORT_KEY` of project `veridian-dpdp-app` (the same value as the Corporate Tambola report; the owner's copy is `telemetry-report-key.txt` in the local Tambola config folder). To rotate it: `wrangler pages secret put REPORT_KEY --project-name veridian-dpdp-app`, then redeploy (a secret applies from the next deployment).

Straight on the database (needs a D1 token): `wrangler d1 execute dpdp-telemetry --remote --command "select kind, count(*) from telemetry group by kind"`. To erase everything recorded: `... --command "delete from telemetry"`.

### What it never records (and what pins it)

No cookie, no browser storage, no IP address (the table has no such column; only the two-letter country Cloudflare works out at the edge), no user agent, **no query string or fragment** (the site carries `?ref=` partner codes and private links with tokens), no personal data. `rum.js` is not loaded on `/app/`, `/act/`, `/unsubscribe/`, `/p/`, `/copy/`, `/ai/` or the 404 page, refuses to run on those paths even if it were loaded, and does nothing when the browser sends Do Not Track or Global Privacy Control. The endpoint repeats each rule on its side: it drops an event for a private path, cuts everything after a `?` or `#` from every field, replaces token-looking runs, ignores a request from another origin, caps the batch and the day's rows (20,000), and keeps rows 90 days. Pinned by `src/lib/telemetry.test.ts`, `src/lib/rum-script.test.ts` (the real `rum.js` run against a fake browser) and the build-time checks. The Privacy Notice (v1.1, 2 October 2026) says all this in its section 2 table and section 8; a lawyer should read that change when the rest of the notice is reviewed.

Free-plan limits (D1): 5 GB, 100,000 rows written and 5,000,000 rows read per day. One page view is about 7 rows, so the 20,000-row day budget (about 2,800 page views a day) sits well inside the write limit; raise `DAILY_ROW_CAP` in `_telemetry.ts` if the site outgrows it.

### Search engines

- **Sitemap**: `/sitemap.xml` lists the 7 public pages and the 7 legal pages (terms, privacy, disclaimer, pricing, refund, shipping, contact), each with the last git commit date of its own file as `lastmod`. `robots.txt` names it, allows every public page and disallows the private prefixes and `/api/`. `llms.txt` and `llms-full.txt` list the public pages.
- **IndexNow (Bing, Yandex, Seznam, Naver; no login)**: the key file `public/3f1e06105f19410fb43008b85ecdfcaa.txt` proves ownership. After every deploy the workflow runs `scripts/indexnow-ping.mjs`, which submits every sitemap URL to `api.indexnow.org` (best effort: a failure never fails the deploy). By hand: `node scripts/indexnow-ping.mjs` after `bun run build`. To change the key: rename the file and change its body to match (the script reads the key from that one file's name). Google does not use IndexNow.

### Owner-only steps (they need your logins or clicks; none was attempted)

1. **Google Search Console** (https://search.google.com/search-console): Add property → **Domain** → `veridian-aios.com` → copy the TXT record → Cloudflare dashboard → DNS → add it (TXT, name `@`) → Verify. Then Sitemaps → submit `https://veridian-aios.com/sitemap.xml`; URL Inspection → paste `https://veridian-aios.com/`, `/dpdp-firm/`, `/dpdp-institution/`, `/about/` → Request indexing. Reports to read later: Pages (what is indexed and why not), Core Web Vitals (real Chrome users), Enhancements (FAQ, breadcrumbs), Crawl stats.
2. **Bing Webmaster Tools** (https://www.bing.com/webmasters): sign in → Import from Google Search Console (no second DNS record), or Add site `https://veridian-aios.com/` and use the DNS TXT route. Submit the same sitemap.
3. **Cloudflare Web Analytics is ALREADY ON** (found 2 Oct 2026: Cloudflare injects `static.cloudflareinsights.com/beacon.min.js` into every page at the edge, including `/app/`; it is not in `dist/`, so the build's scans cannot see it). View it in the Cloudflare dashboard → Analytics & Logs → Web Analytics. Privacy Notice v1.2 now names it. Decide whether you want it on the private `/app/` pages (the sign-in link's token travels in the URL fragment; Cloudflare's beacon is documented to collect timing metrics, but if you want it off there, switch the Pages automatic setup off, or use a manual snippet on public pages only). The site has no Content-Security-Policy, so nothing else needs changing.
4. A free external uptime check, if you want one that does not depend on GitHub: UptimeRobot (free, 5-minute checks, email alerts) or the Better Stack free tier, on `https://veridian-aios.com/`.

### Free tools to analyse the site (run them whenever)

| Question | Tool |
|---|---|
| Real-visitor speed and the lab score | https://pagespeed.web.dev/ with `https://veridian-aios.com/` (mobile and desktop); the same data by API: `curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://veridian-aios.com/&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices"` |
| The same, locally and repeatable | `npx lighthouse https://veridian-aios.com/ --only-categories=performance,accessibility,best-practices,seo --form-factor=mobile --output=html --output-path=./lighthouse-home.html` (Node 22; once per page) |
| Is the structured data valid and eligible? | https://search.google.com/test/rich-results (FAQ and breadcrumbs on the landings) and https://validator.schema.org/ |
| What does Google see on a page? | Search Console → URL Inspection → View crawled page |
| Real Chrome-user speed history | the PageSpeed Insights "field data" block, and the free CrUX API / CrUX Dashboard once the site has enough traffic |
| Headers and security | `curl -sI https://veridian-aios.com/` ; https://securityheaders.com/ ; https://www.ssllabs.com/ssltest/ |
| Link preview | https://www.opengraph.xyz/ or paste a link into WhatsApp / LinkedIn |
| Function errors and logs (`/ai/*`, `/api/telemetry`) | Cloudflare dashboard → Workers & Pages → `veridian-dpdp-app` → Functions (requests, errors, CPU time); live: `wrangler pages deployment tail --project-name veridian-dpdp-app` |
| Is it up right now, and how fast? | the `DPDP site health` run summary, or `node dpdp-app/scripts/site-health.mjs` |

### What was audited on 2 October 2026, and what is left alone on purpose

Every public page already had one `<h1>`, ordered headings, `lang="en-IN"`, a unique title and description, a canonical on the apex, Open Graph and Twitter cards with the 1200x630 image, Organization + WebSite JSON-LD (plus SoftwareApplication, BreadcrumbList and FAQPage where the page really has them), self-hosted preloaded fonts with `font-display: swap`, no image without dimensions (there are none), no third-party request, and hashed assets cached for a year. Changed: the 7 legal pages gained a sitemap entry with a real `lastmod`, Open Graph and Twitter cards, a favicon link (browsers were requesting `/favicon.ico` and getting a 404), `/rum.js`, and the company line; the Disclaimer's 246-character description was shortened to 154; `robots.txt` and `_headers` fence `/api/`. Left alone on purpose: the page titles (the brand rule fixes the "VERIDIAN · VERy INDIAN — " prefix, which pushes the institution page to 90 characters, so Google may cut it in results; shortening it is an owner decision about the brand line), the home page's 174-character description (facts-file wording), and `hreflang` (one language and one region, so there is nothing to alternate).

### The home page and its three colour themes (2 October 2026)

`/` is the redesigned landing (promoted from the `/new/` preview; `/new` and `/new/` now answer 301 to `/`). It is still the Vite entry `index.html`: the head, JSON-LD, brand line, fact block, AI-assistant block and footer links stay generated from `data/veridian-facts.yaml` (`bun run generate:facts`); the design is `src/home.css`. Three dots at the top centre (built by `public/theme.js`, loaded by the home page only, in the head, so the saved theme is applied before first paint) switch the theme: **violet** (the default), **studio blue**, **emerald**. The choice is kept in this browser's `localStorage` (`veridian-theme`): a display preference, no cookie, nothing sent anywhere (Privacy Notice v1.3 says so). `src/lib/home-themes.test.ts` pins WCAG AA contrast for every text pair in all three themes, the script's behaviour, and the dots' placement. The hero's sample file ("Sample school", 8 of 13 jobs, 62%) and sample chat are illustrations, labelled as sample data on the page.
