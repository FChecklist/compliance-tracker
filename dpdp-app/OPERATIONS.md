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
- `DPDP_EMAIL_AI_LINK_ENABLED` (Edge Function secret, default on): `0` takes the AI work link out of the Monday email. `DPDP_EMAIL_AI_LINK_LEVEL` (default `1` = read + small edits + drafts; `0` = read only) and `DPDP_EMAIL_AI_LINK_DAYS` (`1`, `7` or `30`; default `7`) set the emailed link's authority and life. The link is a credential: a new one every Monday, the previous emailed one retired. Details in `supabase/functions/dpdp-monday-email/README.md`.

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
        |   5. every class but auto: email the operator a notice
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
| `grievance` | `grv` | GRIEVANCE | G | **yes** | yes | a grievance or complaint |
| `data_request` | `dsr` | DATA REQUEST | D | **yes** | yes | withdraw consent, erase, access, correct (also an unsubscribe by email) |
| `review` | `rev` | REVIEW | R | **yes** | yes | could not be classified: handled with grievance priority. It is also the default when nothing matched, so it is never "unknown, ignore" |
| `clock` | `clk` | Statutory | K | no (see below) | yes | a reply to a statutory notice WE sent (72-hour leak clock, rights clock) |
| `monday` | `mon` | Monday | M | no | yes | a reply to the Monday digest |
| `sales` | `sal` | Sales | S | no | yes | a new sales enquiry |
| `sales_chain` | `sch` | Sales thread | T | no | yes | a reply inside an outbound sales conversation |
| `invoice` | `inv` | Invoice | I | no | yes | about an invoice we sent, or a payment proof |
| `partner` | `prt` | Partner | P | no | yes | a partnership or reseller enquiry |
| `support` | `sup` | Support | H | no | yes | product help |
| `auto` | `aut` | Auto | A | no | **no, logged only** | a bounce, an out-of-office, a delivery notice |

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

## Where the website lives (since 2026-09-28)

`veridian-aios.com`, `www.veridian-aios.com` and `app.veridian-aios.com` are all served by the one Cloudflare Pages project `veridian-dpdp-app` (free plan, no server). The domain's DNS is on Cloudflare (zone `veridian-aios.com`, free plan); the registration (renewal 14 July each year) is still held at Vercel, which only stores the registration and the two Cloudflare nameservers `dina.ns.cloudflare.com` / `toby.ns.cloudflare.com`. Vercel does not serve any page for this domain and is not needed for it. Email-sending records for Resend live in the same Cloudflare zone. The sending identity is `dpdp@veridian-aios.com` (Resend sending domain `veridian-aios.com`, once it shows Verified in Resend; see the go-live list above). Historical note: until 2026-09-29 mail was sent from the subdomain `send.veridian-aios.com`; those records were created under that name and can stay in the zone until nothing sends from it, but nothing new should use `send.`. If a page ever shows a Vercel "DEPLOYMENT_PAUSED" 503 again, the nameservers at the registrar have been changed back: set them to the two above.
