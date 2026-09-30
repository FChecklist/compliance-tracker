# dpdp-inbound-mail -- the inbound side of dpdp@veridian-aios.com

The public shows ONE address, `dpdp@veridian-aios.com`. Everything the platform
sends carries a machine-readable `Reply-To` (`dpdp+<tag>.<ref>@veridian-aios.com`,
see `../_shared/mail-taxonomy.ts`), and everything that comes back is sorted into a
class here, given a ticket number, and put in front of the operator. Nothing is
silently dropped.

**Two ways in, one pipeline.** Since 2026-09-29 mail is received by **Resend inbound** (primary, see "Resend inbound"
below); the Cloudflare Email Worker is an optional alternative. Both end in the same `handleInbound`.

```
PRIMARY   person -> root MX -> Resend inbound -> Svix-signed webhook (email.received)
OPTIONAL  person -> Cloudflare Email Routing -> Email Worker (workers/dpdp-inbound-mail) -> bearer POST
  -> POST https://<ref>.supabase.co/functions/v1/dpdp-inbound-mail   (this function)
       auth -> parse -> [look up the outbound message it answers] -> classify
       -> insert dpdp.mail_inbound (ticket)            drizzle/0662
       -> [acknowledge the sender: legal-clock classes only]
       -> [email the operator: every class but auto]
```

| File | What it is |
| --- | --- |
| `classify.ts` | The classifier. Pure and deterministic: no network, no clock, no model. |
| `handler.ts` | The request handler (auth, parse, pipeline, emails). Database and mail provider are injected. |
| `index.ts` | Deno wiring only: `Deno.serve`, the service-role client, Resend. |
| `resend-inbound.ts` | The Resend inbound adapter: Svix signature check, fetch of the received email, recipient policy, mapping to the Worker's payload, the reconcile job, and the routing of the three kinds of caller. |
| `classify.test.ts`, `handler.test.ts`, `resend-inbound.test.ts` | Offline proof (see "Tests"). |
| `../../../drizzle/0662_dpdp_single_mailbox_mail_log.sql` | The mail log: `dpdp.mail_outbound`, `dpdp.mail_inbound`, ticket counter, `public.dpdp_mail_*` incl. `dpdp_mail_close` (service_role only). |

## The classes

| Class | Ticket | Legal clock + acknowledged | Operator emailed | How it is reached |
| --- | --- | --- | --- | --- |
| `grievance` | `G-2026-0042` | yes | yes | tag `grv`, thread, keyword, or **escalation** |
| `data_request` | `D-...` | yes | yes | tag `dsr`, thread, keyword, or **escalation** |
| `review` | `R-...` | yes | yes | tag `rev`, thread, or **the default when nothing matched** |
| `monday` | `M-...` | no | yes | tag `mon` or thread (a reply to the Monday digest) |
| `clock` | `K-...` | no | yes | tag `clk` or thread (a reply to a **statutory notice we sent**: the 72-hour leak clock or the 90-day rights clock, `[VERIDIAN DPDP · Statutory]`) |
| `sales` | `S-...` | no | yes | tag `sal`, or keyword |
| `sales_chain` | `T-...` | no | yes | tag `sch`, or a reply to something we sent as `sales` |
| `invoice` | `I-...` | no | yes | tag `inv`, thread, or keyword |
| `partner` | `P-...` | no | yes | tag `prt`, or keyword |
| `support` | `H-...` | no | yes | tag `sup`, or keyword |
| `auto` | `A-...` | no | **no (logged only)** | our own mailbox as sender, a machine signal, or an auto header with nothing legal in the text |

First match wins, in this order: (0) sender is our own mailbox -> `auto`; (1) **machine-only**
signals -> `auto`, before the plus-tag, **never escalated**: a delivery-status / multipart-report /
disposition-notification content type on its own; a `MAILER-DAEMON` / `postmaster` sender **only
together with a second signal** (such a content type, an empty Return-Path or envelope sender,
`Auto-Submitted`, or an auto-reply / bounce style subject at the start) -- those are mailbox
*names*, `postmaster@` is a real, human-read address at a small firm, and a plain text mail from
it with a legal request is classified (and escalated) like any other mail; an empty Return-Path /
envelope sender only together with a delivery-status content type or such a sender; (2)
**header-based** auto signals (an empty Return-Path / envelope sender **on its own**,
`Auto-Submitted` other than `no`, `X-Autoreply` / `X-Autorespond`, `Precedence: bulk | auto_reply |
junk`, an "out of office" / "automatic reply" / "undeliverable" style subject **at the start of the
subject only** (behind `Re:` / `Fwd:` / a gateway's `[External]`-style tag), and our own
`X-Veridian-Origin` **only when a thread match corroborates it**) -> `auto`, also before the
plus-tag, so a vacation reply to the Monday digest stops notifying the operator every Monday,
**unless** the text carries a data request or a grievance, or the Worker cut the message short and
too little of it is readable (escalation, below); (a) the recipient's plus-tag; (b) In-Reply-To / References carries a Message-ID we sent
(`sales` -> `sales_chain`); (d) keywords on the subject and the first 4096 characters of the text,
quoted lines removed, English and Hindi/Hinglish, in the order data_request, grievance, invoice,
partner, sales, support; (e) `review`.

**Escalation** (the owner's rule: a legal request never misses its clock or its acknowledgement,
whatever tag, thread or headers it arrives with). After a, b or d, if the class is not a legal-clock
class (grievance, data_request, review), and for a header-based auto signal, **only** the
`data_request` and `grievance` keyword rules are run over what the person actually wrote: the body
with quoted lines (`>`), everything after an `On ... wrote:` line (also when wrapped over two
lines), `-----Original Message-----` / forwarded-message lines, Outlook `From: / Sent: / To: /
Subject:` blocks and **our own footer boilerplate** removed, plus the subject unless it carries our
own `[VERIDIAN DPDP` prefix (our subjects contain words such as "escalated to you" and "Data
Protection Board", and a reply echoes them). A hit raises the class and keeps the origin in the
stored reason: `tag:mon; escalated keyword:data_request:"delete my data"`,
`auto:Auto-Submitted=auto-replied; escalated keyword:grievance:"complain"`. So a Monday reply
saying "Please stop sending me these emails. Delete my data." is a `data_request`, an invoice-thread
"I want to file a complaint about misuse of my data" is a `grievance`, "thanks for the invoice"
stays `invoice`, and a vacation reply that merely quotes the digest (whose footer says
"unsubscribe") stays `auto`. A raised message gets a due date, an acknowledgement and the operator
notice like any other legal-clock ticket.

The escalation also has three `review` outcomes, all legal-clock (ticket `R-`, due date, acknowledgement, starred
notice), for a message that cannot be read safely: nothing of the person's own above the quote
(`nothingAboveTheQuote`); a reply in a script the rules have no words for; and **a message the Worker
cut short** (`truncated`) whose own text -- quotes and our boilerplate removed -- has **fewer than 20
readable letters** (`TRUNCATED_MIN_LETTERS`, `truncatedUnreadable`): what was cut off may be the
request. That last rule also applies under a header-based auto signal (so a large message cannot hide a
request behind a sender-chosen header); a machine-only signal or our own mailbox still wins.
"Our own boilerplate" is recognised by the wording of the templates in `dpdp-monday-email/render.ts`
(the digest's urgency opener and its "escalated to you below" intro, the "ESCALATED TO YOU AS ..."
heading, the "escalates twice as fast" clauses, the leak-clock "Still to do: tell the Data Protection
Board", the rights-clock "A erasure request (RR-7) received on ... has not been answered", the
unsubscribe footer **as a template line**, not the bare words: "Please stop these weekly emails" typed
by a person is a withdrawal and is read); a drift test renders every kind of that email in full (and
again with one sentence per line) and demands that nothing in it raises a data request or a
grievance. Every such pattern is a way to hide a line, so none is listed that no rule needs. A
**negated complaint** ("no complaints", "not a complaint", "nothing to complain about", "without any
complaint") does not raise a grievance; "no complaint redressal mechanism" and "no complaint has been
resolved" still do, and a real complaint elsewhere in the same message still does.

**The safety rule** (the owner's core requirement): `auto` is the only class logged without telling
the operator, so it is hard to reach. An `aut` tag in the address is *ignored* (anyone can type it).
The machine-only signals end in `auto` because a bounce is a bounce (but see the limitation below:
they can be forged). The header-based signals are chosen by the *sender*, so they can never hide a
legal request. One deliberate exception in the other direction: when the tag names a legal class
(`grv` / `dsr` / `rev`, which includes the legacy `grievance@` alias the Worker rewrites to
`dpdp+grv@`, or the `List-Unsubscribe` mailto of a digest or notice, `dpdp+dsr.<ref>@`, whose ref
matches a Monday or statutory row) and the message is **not a reply to one of our own
acknowledgements** (the matched outbound row carries a ticket number: only an acknowledgement has
one), an auto header does not divert the message to `auto`: it is filed under the tag, **ticketed,
the operator is told AND the sender is acknowledged** (`autoHeadersIgnored`; the per-sender 3 / 24 h
and global 30 / h caps still apply), even when the message has auto headers and no words at all. An
earlier outbound message of any *other* kind (a digest, a statutory notice, an invoice, even one of a
legal class without a ticket number) does not stop the tag standing alone. A header-flagged reply to
our own acknowledgement IS diverted to `auto`: that is the auto-responder loop, and the only one.
`X-Auto-Response-Suppress` is **not** an auto signal: it is a hint the sender sets about how others
should answer them, not proof that the mail is automatic.

## Resend inbound (the primary path)

The owner's decision (2026-09-29): mail for `dpdp@veridian-aios.com` is received by **Resend inbound**, not by the
Cloudflare Email Worker. The domain's root MX points at Resend (`inbound-smtp.ap-northeast-1.amazonaws.com`; receiving is
enabled on the Resend domain). Resend stores every message it receives and POSTs a **Svix-signed webhook**
(`email.received`) to this function. The Worker (`workers/dpdp-inbound-mail`) stays in the repository as an optional
alternative and its bearer route below is unchanged; the MX record decides which of the two ever sees a message.

```
person -> dpdp@ / dpdp+<tag>.<ref>@ / anything@veridian-aios.com
  -> root MX -> Resend inbound (stores the message)
  -> POST https://<ref>.supabase.co/functions/v1/dpdp-inbound-mail    svix-id / svix-timestamp / svix-signature
       resend-inbound.ts   verify the signature over the RAW body -> GET /emails/receiving/{email_id}
                           -> recipient policy -> map to the Worker's payload
       handler.ts          the SAME pipeline as the Worker's mail: lookup -> classify -> ticket -> [ack] -> [operator notice]
       -> 2xx only after the ticket is recorded; 502 otherwise, so Svix retries
```

### What the function does with a webhook

1. **Verifies the signature before it reads a byte of the body.** Signed content is `svix-id + "." + svix-timestamp + "." +
   the raw body`; the key is the base64 part of `DPDP_RESEND_WEBHOOK_SECRET` after `whsec_`; the signature is HMAC-SHA256
   in base64, compared in constant time against every `v1,<sig>` in the header (several while a secret is rotated).
   The timestamp must be within **5 minutes of our clock in both directions**. Web Crypto only, no dependency.
   No secret, or one that is not `whsec_` + base64 of at least 16 bytes: **503**, nothing else runs (fail closed).
2. **Ignores every event type except `email.received`** (answers 200, so Svix does not retry it).
3. **Fetches the message**: `GET https://api.resend.com/emails/receiving/{email_id}` with `RESEND_API_KEY`, 10 s timeout,
   no redirects. The webhook itself carries no body and no headers, and the SPF / DKIM / DMARC verdicts are only there.
4. **Maps it to the Worker's snake_case payload** (see "The Worker's request" below) and runs `handleInbound`: the tag is
   read from the address it was received for (`received_for`, then `to`, `cc`, `bcc`), `In-Reply-To` / `References` and the auto-mail
   headers come from the fetched headers, the text is the first 4096 UTF-8 bytes of `text` (or of the html with tags removed; a
   cut adds a line to the operator's notice), `received_at` is Resend's own time, and a message with no Message-ID gets
   `<resend-<email_id>@resend-inbound.invalid>` so it is still deduplicated. **Attachments are never downloaded**; the notice
   names them and says Resend keeps them.
5. **Answers** (Svix retries on anything but 2xx, with backoff):

| Status | Meaning |
| --- | --- |
| `200` | The ticket exists and the operator has been told (or the class is `auto`); or the event type is not `email.received` (`ignored: true`); or this email id was already recorded by this instance (`cached: true`). |
| `400` | Signed, but not an event we can use (not JSON, no usable `email_id`). |
| `401` | Signature missing, wrong, stale or from the future. Nothing was fetched or written. |
| `405` / `413` | Not a POST / body over 256 KB (read only up to that, whatever Content-Length says). A signed event that big is retried by Svix in vain; the message stays in Resend and the reconcile job below ingests it. |
| `502` | Could not fetch the message from Resend (**the operator is emailed an `[UNPROCESSED <id>]` alert**, see "Nothing fails only in the Svix log"); **or** the database could not record it (the handler emails the operator the raw message, but there is no ticket, so this is not a 2xx); **or** the ticket is recorded but the operator could not be told; **or** an acknowledgement that was due could not be sent (on the Worker path nobody retries that; here the retry sends it, and does not tell the operator a second time). Svix retries; the retry is idempotent. |
| `503` | `DPDP_RESEND_WEBHOOK_SECRET`, `RESEND_API_KEY` or `DPDP_INBOUND_SECRET` is missing or malformed. Resend keeps the message, so a later retry (or the reconcile job) still finds it. |

### A retry is harmless

The database refuses a second ticket for the same sender + Message-ID (`dpdp_mail_insert_inbound`), the acknowledgement is only
due while `ack_sent_at` is empty, and the acknowledgement and the notice carry `Idempotency-Key`s derived from the ticket. So a
retry after a failure sends what is still missing (a notice that failed, an acknowledgement that failed) and nothing twice. An
email id that was recorded is also remembered in memory of the running instance, so an immediate duplicate delivery is answered
without a second fetch; that cache is only a shortcut in front of the database's own check, and a failure is never cached.

### Nothing fails only in the Svix log

A webhook that cannot become a ticket (Resend refuses or fails the fetch, answers something that is not a message, the mapping
throws, or the pipeline records nothing) is answered `502`, so Svix retries for about a day, **and the operator is emailed once per
email id**: subject `[UNPROCESSED <email_id>] <subject>`, headers `X-Veridian-Origin: inbound-alert`, body = the sender, the
recipients, the Message-ID and the time **from the webhook itself** (never the message body), the reason, and how to recover. A
`401` / `403` from Resend says the key may be sending-only: reading a received email needs full access, and a key that can only send
would otherwise make every inbound mail fail in silence until Svix gave up. Each retry sends the alert again, but with the same
`Idempotency-Key` (`dpdp-inbound-unprocessed-<email_id>`), so Resend delivers it once. It is best effort (it uses the same mail
provider), never throws, is silent in a dry run or with no `DPDP_OPERATOR_EMAIL`, and is never sent by the reconcile job (whose answer
lists the failures). Recovery: fix the cause; if it is within a day the retry makes the ticket by itself, otherwise run the reconcile
job (a legal clock runs from when the message ARRIVED, not from when it is found).

### Bounded work: a message must not be able to pin the CPU

A message the platform kills for using too much CPU is never recorded and is retried in vain. Everything that reads text a stranger
controls is therefore linear-time and capped (review of 2026-09-30, after a 200 000-character `To:` header took 95 seconds and an
80 000-character HTML body took 14): the address pattern is `{1,64}@...{1,255}` (RFC 5321 limits) over at most 100 000 characters and
500 addresses; `htmlToText` walks the string once (`indexOf`, no backtracking regular expression), stops at 200 000 characters of
output and reads at most 2 000 000 characters of HTML; `bareAddress` trims by hand; To / Cc lists are cut to 200 entries of 4000
characters and the payload fields to 20 000 / 100 x 1000 so the internal hand-off can never exceed `handleInbound`'s 1 000 000
character limit (a `413` there would be a poison message); the webhook body is read as a stream and abandoned at 256 KB, and the mail
route peeks at no more than 2 KB of an unauthenticated body. `resend-inbound.test.ts` times each of these, and the
`hostile input stays linear` tests fail if any is made quadratic again.

### The recipient decides how it is filed: Resend accepts EVERY address at the domain

> **WARNING.** Once the root MX points at Resend, **every** address at `veridian-aios.com` is accepted: `info@`,
> `rajat@`, `sales@`, a guessed `privacy@`, anything. The Worker used to bounce the unknown ones at the SMTP level; Resend
> does not. **Any human mailbox on this domain (Google Workspace, an alias, a forward) stops working the moment the MX
> is swapped**, and what people write to it lands in `dpdp.mail_inbound` as a logged-only `auto` ticket instead of reaching
> them. List every live address at the domain BEFORE swapping the MX and decide for each of them.

Among several recipients the best one wins: `dpdp@` / `dpdp+tag@` (one that names a class first), then the two old aliases, then
`postmaster@` / `abuse@`, then any other address at our domain, then an address at another domain. Ties keep Resend's order.

| Received for | Filed as | Operator emailed | Acknowledged |
| --- | --- | --- | --- |
| `dpdp@`, `dpdp+<tag>[.<ref>]@` | whatever the classifier says (the normal pipeline) | as for that class | as for that class |
| `grievance@` | the tag `grv` (a grievance) | yes | yes |
| `partners@` | the tag `prt` (a partner enquiry) | yes | no |
| `postmaster@`, `abuse@` | `support` (reason `role-mailbox:<name>`) | yes | **never** |
| any other local part at the domain | `auto`, reason **`unknown-recipient`** | **no (logged only)** | no |
| an address at another domain | `auto`, reason `recipient-not-on-our-domain` | no | no |

Two safeguards keep this from losing a legal request. (1) `applyPolicy` (handler.ts) never overrides the loop guard, and never
overrides the class of a message the classifier already treated as a failure. (2) For an unknown address, and for
`postmaster@` / `abuse@`, a **data request or grievance found in the sender's own words keeps its legal class**: it is
ticketed with a due date and the operator is told (an unknown address is acknowledged like any other legal request; `postmaster@`
/ `abuse@` never are), unless the message also carries bulk / auto-mail headers, which is what guessed-address spam looks like.
For an unknown address that includes a `List-Unsubscribe` or `List-Id` header (RFC 2369 / 2919: only mailing-list and marketing mail
has them): "unsubscribe" in the footer of a mailing is not a withdrawal of consent, and without this rule every piece of spam to this
accept-all domain would become a `D-` ticket, an operator email and an acknowledgement to the spammer. The reason stored says
`(bulk: List-Unsubscribe / List-Id header)`. Read the logged-only tickets now and then:

```sql
select ticket_no, received_at, from_addr, to_addr, subject
from dpdp.mail_inbound
where class = 'auto' and classifier_reason like '%unknown-recipient%'
order by received_at desc;
```

### Authentication

Resend's own verdicts (`authentication.spf`, `.dkim`, `.dmarc`: `pass`, `fail`, `gray`, `processing_failed`, `unknown`) are written
into the `authentication-results` header that `ackBlocker` reads. When **DMARC failed, or SPF and DKIM both failed**, the message
is ticketed and the operator is told, but it is **never acknowledged** (the acknowledgement would go to a forged address). A
header of that name inside the message is never copied: the sender writes those. Every Resend-sourced operator notice states the
three verdicts and **the Resend received-email id**, so the raw message and its attachments can be fetched from Resend
(`GET /emails/receiving/{id}`, or the Receiving tab of the dashboard).

### The reconcile job (a safety net; Svix retries are the primary path)

If a webhook was lost (endpoint disabled, the function down for longer than Svix retries), an operator or a cron can ask the
function to look for what it missed. Bearer-protected with `DPDP_INBOUND_SECRET`, one POST to the same URL:

```
curl -sS -X POST "$FUNCTION_URL" -H "Authorization: Bearer $DPDP_INBOUND_SECRET" -H "Content-Type: application/json" \
     -d '{"job":"reconcile","hours":48}'
```

`hours` is a whole number from 1 to 168 (default 48); `limit` (1 to 200, default 100) caps how many messages one run handles.
It pages through `GET /emails/receiving`, skips anything older than the window, and runs every other message through the same
pipeline as the webhook. Nothing new is created for a message the database already has (same sender + Message-ID), so it is
idempotent; it does resend a missing notice or acknowledgement for a message whose earlier attempt failed. The message's own
received time is kept, so a legal clock starts when the message arrived, not when it was repaired. Answer: `{ ok, listed,
ingested, duplicates, failed, partial, rateLimited, failures: [{ emailId, status, error }] }`, `200` when everything worked and
`502` when any message (or the listing) failed. `partial: true` means the run stopped at its cap or its time budget: run it
again. There are no addresses or subjects in the answer. Each listed message costs one read of Resend's API, so keep `hours`
small. The listing endpoint's exact response shape was taken from Resend's documentation (`GET /emails/receiving`,
`limit`, `after`, `has_more`, `data[].id / created_at`), not observed live: run it once with `"hours":1` and read the answer.

### Function secrets for this path

| Secret | Needed for | Notes |
| --- | --- | --- |
| `DPDP_RESEND_WEBHOOK_SECRET` | verifying the webhook | The signing secret of the webhook endpoint in Resend (`whsec_...`). Unset or malformed: every webhook is 503. |
| `RESEND_API_KEY` | fetching the received message, and sending | Must be allowed to read received emails; a key limited to sending may be refused (a fetch that answers 401 / 403 shows in the logs as `Resend GET ... answered 401`). Absent: the webhook is 503. |
| `DPDP_INBOUND_SECRET` | the reconcile job and the Worker; also the internal hand-off to the pipeline | 24+ characters or every request is refused with 503. |
| `DPDP_OPERATOR_EMAIL`, `DPDP_EMAIL_FROM`, `DPDP_LEGAL_RESPONSE_DAYS` | as in the table below | unchanged |

### Go live, in this order (Resend path)

Nothing below was applied, deployed or sent by the session that wrote it.

1. **Apply `drizzle/0662_dpdp_single_mailbox_mail_log.sql`** (additive; `bun run db:migrate`, or the Supabase MCP
   `apply_migration`). Check that `dpdp.mail_inbound` exists.
2. **Set the secrets** (`supabase secrets list` first): `DPDP_RESEND_WEBHOOK_SECRET`, `DPDP_INBOUND_SECRET`,
   `DPDP_OPERATOR_EMAIL` (not `dpdp@` itself), `RESEND_API_KEY`, `DPDP_EMAIL_FROM` (delete a stale one that names `send.`).
3. **Deploy the function with JWT verification off**: `supabase functions deploy dpdp-inbound-mail --no-verify-jwt`. Via the
   Supabase MCP `deploy_edge_function`: `verify_jwt: false`, files `index.ts`, `handler.ts`, `classify.ts`,
   **`resend-inbound.ts`** and **`../_shared/mail-taxonomy.ts`** (`handler.ts` and `classify.ts` import the taxonomy;
   `index.ts` imports `resend-inbound.ts`, which imports the other three).
4. **Register the webhook in Resend** (Webhooks, add endpoint): URL `https://<ref>.supabase.co/functions/v1/dpdp-inbound-mail`,
   event `email.received`. Its signing secret is `DPDP_RESEND_WEBHOOK_SECRET`. Send the dashboard's test event: an answer of `502`
   (the fake email id cannot be fetched) proves the signature is right; `401` means the secret differs, `503` that a secret is unset.
5. **Inventory the addresses at the domain, then swap the root MX to Resend.** See the WARNING above: from this moment every
   address at the domain is accepted by Resend and only `dpdp@`, its tags, `grievance@`, `partners@`, `postmaster@` and
   `abuse@` reach a person. Remove the MX records that pointed at Cloudflare Email Routing (and at anything else that must no
   longer receive); check the DNS change has propagated.
6. **Drills**: mail to `dpdp@` gives a ticket, a notice in the operator's inbox and (for a grievance) an acknowledgement in the
   sender's inbox, not in spam; `dpdp+grv.k3f9x2ab7q@` keeps its tag; `grievance@` arrives as a grievance and `partners@` as a
   partner enquiry; a random address gives an `A-` ticket and **no** notice; `postmaster@` and `abuse@` give a `support` notice and
   no acknowledgement; then run the reconcile job with `"hours":1` and check that it creates nothing new.

## Secrets (function secrets, Supabase dashboard -> Edge Functions -> Secrets)

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform; never set them.

| Secret | Needed for | Notes |
| --- | --- | --- |
| `DPDP_INBOUND_SECRET` | everything | The bearer the Worker presents. 48+ random characters (`openssl rand -hex 32`); the function refuses **every** request with 503 if it is unset or shorter than 24. Set the same value as a Worker secret. |
| `RESEND_API_KEY` | sending | **Absent = dry run** (see below). **Function secrets are per PROJECT, not per function**: this is the same `RESEND_API_KEY` that `dpdp-monday-email` and `dpdp-invoice-email` read, so if it is already set for them this function is NOT in dry run the moment it is deployed. Set it only once Resend has verified `veridian-aios.com` as a sending domain, because the default From is `dpdp@veridian-aios.com`; until then Resend refuses every send (acknowledgements and notices fail, the message is still recorded, the answer is 502 and the Worker forwards it natively). Check with `supabase secrets list` before deploying. |
| `DPDP_OPERATOR_EMAIL` | the operator notice | Where notices go. If unset the message is still recorded but the answer is 502. Must **not** be `dpdp@veridian-aios.com` itself (a notice would arrive as inbound mail; the self-sender rule stops the loop but the operator would see nothing). |
| `DPDP_EMAIL_FROM` | optional | Default `VERIDIAN AI DPDP <dpdp@veridian-aios.com>`. |
| `DPDP_LEGAL_RESPONSE_DAYS` | optional | Whole days, 1-365, default **90**. Becomes `due_at = received_at + N days` on grievance / data_request / review tickets. **The number is the owner's and counsel's to confirm.** The code asserts nothing legal; it only stops a ticket sitting unnoticed. |

## The Worker's request (the contract with `workers/dpdp-inbound-mail`)

`POST` with `Authorization: Bearer <DPDP_INBOUND_SECRET>` and a JSON body. The canonical
definition is `InboundMailPayload` (version 1, snake_case) in
`workers/dpdp-inbound-mail/src/types.ts`; `parseInbound` in `handler.ts` reads it. Fields
this function uses:

```jsonc
{
  "version": 1,
  "received_at": "2026-09-29T15:30:00.000Z",  // Worker clock; used as received_at (and the due date's start) unless > 48 h from ours
  "envelope_from": "sender@example.org",      // SMTP MAIL FROM; "" for a bounce
  "envelope_to": "dpdp+grv.k3f9x2ab7q@veridian-aios.com", // SMTP RCPT TO -- THE PLUS-TAG LIVES HERE (legacy grievance@ / partners@ already rewritten by the Worker)
  "header_from": "Asha M <asha@example.org>", // raw From header
  "from_address": "asha@example.org",         // parsed address of it, or null; an acknowledgement goes here
  "from_name": "Asha M",                      // shown in the operator's notice only
  "header_to": "dpdp@veridian-aios.com",      // raw To header; addresses in it (and in headers.cc) are extra recipients
  "subject": "Complaint about my account",
  "message_id": "<abc@example.org>", "in_reply_to": "<sent-1@...>", "references": "<a@x> <sent-1@...>",
  "auto_submitted": null, "precedence": null, "x_autoreply": null, "x_auto_response_suppress": null,
                                              // null = header absent, "" = present but empty; for several of them PRESENCE is the signal
  "content_type": "text/plain; charset=utf-8", // multipart/report or message/delivery-status => a bounce
  "headers": { "return-path": "<>", "auto-submitted": "auto-replied", "cc": "x@y.example" },
                                              // the Worker's allowlist; lower-cased name -> first raw value; wins over the top-level fields above
  "text": "first 4096 bytes of the text body",
  "has_attachments": false,                   // attachments are NEVER stored; this only adds a line to the notice
  "truncated": false                          // the Worker did not read the whole message; adds a line to the notice
}
```

Unread fields (`reply_to`, `envelope_to_raw`, `raw_size`) are ignored. camelCase spellings of the main
fields (`envelopeFrom`, `envelopeTo`, `headerFrom`, `messageId`, `inReplyTo`, `contentType`,
`hasAttachments`, plus `from`/`to`/`html`) are also accepted, so a rename cannot lose mail. Text
that ends up in a header of an email we send (subject, Message-ID, References, header values) is
flattened to one line, so a hostile sender cannot start a new header line. The body must be an
object carrying at least one of an address, a subject or text. Total request limit 1,000,000
characters (else 413).

The Worker copies the first `Authentication-Results` header into `headers`, which is what the "sender failed
DMARC" acknowledgement guard in `ackBlocker` reads. Not verified from here: whether Cloudflare Email Routing
adds that header to the message the Worker receives. If it does not, the guard never fires.

### Answers, and what the Worker must do with them

| Status | Meaning | Worker |
| --- | --- | --- |
| `200` | Recorded (or, `degraded: true`, forwarded raw because the database was down) and a person has been told, or the class is `auto`. | Done. Do not forward. |
| `400` | Invalid JSON / not an object / nothing in it. | Forward natively. |
| `401` | Wrong or missing bearer. | Forward natively; fix the secret. |
| `405` | Not a POST. | -- |
| `413` | Body too large. | Forward natively. |
| `502` | The message **is recorded** (unless `degraded`) but the operator could not be told (send failed, no `DPDP_OPERATOR_EMAIL`, or dry run), or nothing could be recorded or forwarded. | **Forward the raw message natively** (`message.forward(<operator address>)`). |
| `503` | `DPDP_INBOUND_SECRET` not configured. | Forward natively. |

So any non-2xx means "the Worker must not drop the message". The body never echoes the
message; it carries `{ ok, ticket, class, rule, duplicate, dryRun, ack, notified, degraded }`.

## What gets emailed

* **Acknowledgement to the sender** (grievance, data_request, review only, including a
  message raised to one of them by the escalation). From `DPDP_EMAIL_FROM`, `Reply-To`
  `dpdp+<tag>.<new ref>@`, subject
  `[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0042)`; for a `review`
  message the subject carries **no class label**, so the sender never sees our internal word:
  `[VERIDIAN DPDP] We received your message (ticket R-2026-0001)`. It says the message was
  received, gives the ticket number and the time, and says we will respond. It asserts nothing
  legal (no deadline, no statute) and **repeats nothing the sender wrote, not even their
  subject** (the address it goes to is the unverified From, so an echo would let anyone make us
  send their words to a stranger). It is logged in `dpdp.mail_outbound` with the ticket, so a
  reply to it lands on the same class and is tied to the ticket. Sent with `Auto-Submitted:
  auto-replied`, `X-Auto-Response-Suppress: All`, `X-Veridian-Origin: acknowledgement`.
  **Never** sent when: the message carries auto-mail signals and was neither *escalated* nor a
  legal-clock *tag* that stood alone against them (both are acknowledged whatever headers the
  sender chose, except a header-flagged reply to **our own acknowledgement**, which is how two
  auto-responders loop; the ticket already exists); the sender is our own mailbox, a `no-reply` /
  `bounce` address, or has no usable address (`postmaster@` and `mailer-daemon@` are **not** refused
  here: without a second machine signal the classifier files them as ordinary senders, so a legal
  request from one is acknowledged); the sender failed DMARC in `Authentication-Results`;
  3 acknowledgements already went to that sender in 24 hours; or **30 acknowledgements have gone
  to anyone in the last hour** (a global brake against a flood of forged senders). When a limit
  holds the acknowledgement back the ticket is still created and due-dated and the operator is
  still told; the notice then says which limit it was and to answer by hand.
* **Operator notice** (every class but auto). To `DPDP_OPERATOR_EMAIL`, subject
  `[GRIEVANCE G-2026-0042] original subject`, `Reply-To` the original sender (replying
  answers the sender directly, from the operator's own address), a summary block (class
  and why, ticket, respond-by date, from, to, related ticket, acknowledgement status) and
  the original message quoted. Sent with `Idempotency-Key` so a retried delivery cannot
  send it twice.
* **Raw forward** (database down): the message itself, subject `[CLASS UNRECORDED] ...`.

## Closing a ticket, and retention

`public.dpdp_mail_close(p_ticket_no text, p_note text default null)` (service_role only, SECURITY
DEFINER, like its siblings) sets `status = 'closed'`, `closed_at = now()` and an optional note
(first 1000 characters, `closed_note`). **First call wins**: the first call sets the time; the note
is the first non-blank one and is never replaced, so a later call changes nothing **except** that it
may *add* a note when none was stored (close with no note, then with a note: the note is kept; a
third call with another note changes nothing). Every call after the first answers
`alreadyClosed: true`. It answers `{ ok: false }` for an unknown ticket, and **never reopens**: nothing else in the schema moves a ticket out of `closed`. Nothing
in this function calls it; an operator closes a ticket by hand, for example with the service-role
client: `await client.rpc("dpdp_mail_close", { p_ticket_no: "G-2026-0042", p_note: "Answered by phone" })`.

**Retention is the owner's call, with counsel.** `dpdp.mail_inbound.excerpt` (first 4096
characters of the text), `subject` and `from_addr` hold whatever personal data the sender typed,
and nothing here sets a period or deletes or redacts anything, `dpdp_mail_close` included. Decide
how long a closed ticket's excerpt, subject and sender address are kept (and whether the ticket
row itself is kept as the record that a request was received and answered), then add a job for it.

## Dry run

No `RESEND_API_KEY` in the project's function secrets (shared with the two digest functions, see the table): every message is
recorded and gets its ticket, nothing is sent, nothing is marked sent, and the answer says
`dryRun: true`, `ack: "dry_run"`, `notified: "dry_run"`. **The answer is 502**, not 200: nobody was
told, and the Worker treats any 2xx as "a person has been told" and would not forward, so a real
message arriving before the key is set would sit unread in the table. With a 502 the Worker
forwards it natively (with `X-Veridian-Fallback-Reason: post_http_502`) and the ticket row is
still written, which is what the dry-run check below looks for. If the database is also down in
dry run the answer is 502 as well (nothing could be recorded).

## What the PM / owner must do, in this order (Cloudflare Worker path, optional)

Nothing below was applied, deployed or sent by the session that wrote this.

1. **Apply `drizzle/0662_dpdp_single_mailbox_mail_log.sql`** (journal idx 492) through the
   project's usual path (`bun run db:migrate`, or Supabase MCP `apply_migration`). Additive
   only. Its citation line quotes the owner's instruction; confirm the wording is acceptable.
2. **Set the function secrets** above: `DPDP_INBOUND_SECRET` first (and the same value on the
   Worker), then `DPDP_OPERATOR_EMAIL`. Run `supabase secrets list` first: if `RESEND_API_KEY` is already
   there (the digest functions use it) this function will not be in dry run, so do steps 4-5 in the
   order that suits: verify `veridian-aios.com` in Resend BEFORE pointing mail at the Worker, or accept
   that until you do, acknowledgements are not sent and are not retried. Also delete or update a stale
   `DPDP_EMAIL_FROM` secret that still names `send.veridian-aios.com`; it overrides the default for all three functions.
3. **Deploy with JWT verification off** (the Worker presents the shared secret, not a JWT):
   `supabase functions deploy dpdp-inbound-mail --no-verify-jwt`. Via the Supabase MCP
   `deploy_edge_function`: `verify_jwt: false`, files `index.ts`, `handler.ts`, `classify.ts`,
   **`resend-inbound.ts`** (`index.ts` imports it, also on the Worker path) **and `../_shared/mail-taxonomy.ts`**
   (`handler.ts`, `classify.ts` and `resend-inbound.ts` import it).
4. **Deploy the Worker** and point Cloudflare Email Routing's `dpdp@` rule (with plus-tags /
   catch-all for `dpdp+*`) at it. Check with a dry-run message first: it must appear in
   `dpdp.mail_inbound` with a ticket, no email sent by the function, and the Worker's native
   forward (fallback reason `post_http_502`) delivering it to the fallback address.
5. **Verify `veridian-aios.com` in Resend, then set `RESEND_API_KEY`.** Until then the function
   emails no one; every message is still recorded, and the Worker's native forward is what
   delivers it to a person.
6. Register the function in `scripts/verify/shared-boundary.sh`'s function/project table if that
   register is to stay complete.

## Tests

`bunfig.toml` sets the test root to `src/`, so a bare `bun test` does **not** find the test
files that live beside the function (nor `../_shared/mail-taxonomy.test.ts`); **name them with a `./` prefix**
(without it bun silently skips them). `src/lib/services/dpdp-mail-edge-functions.test.ts` imports all four of them (and
fails if a new one is not imported), which is how CI runs them:

```
bun test --isolate ./supabase/functions/dpdp-inbound-mail/classify.test.ts
bun test --isolate ./supabase/functions/dpdp-inbound-mail/handler.test.ts
bun test --isolate ./supabase/functions/dpdp-inbound-mail/resend-inbound.test.ts   # the Resend adapter: signature, fetch, mapping, recipient policy, authentication, retries, loop safety, reconcile
bun test --isolate ./src/lib/services/dpdp-mail-edge-functions.test.ts   # all of the above, as CI runs them
bun test --isolate ./supabase/functions/_shared/mail-taxonomy.test.ts
bun test --isolate src/lib/services/dpdp-single-mailbox-migration.pglite.test.ts   # PGlite: real Postgres, no database needed (incl. the 30/hour cap and dpdp_mail_close)
bun test --isolate ./src/lib/services/dpdp-resend-inbound-adversarial.pglite.test.ts   # the whole Resend path against the real SQL: forged / replayed / tampered webhooks, hostile fetches, duplicates, loops, header injection, hostile bodies, reconcile
bun test --isolate src/lib/services/dpdp-mail-outbound.test.ts   # the digest / invoice / statutory-notice senders: class, Reply-To, prefix, log rows
(cd workers/dpdp-inbound-mail && bun test)   # incl. pipeline.test.ts: Worker -> this function -> drizzle/0662 on PGlite
```

## Honest limitations

* Attachments are not stored, and the text excerpt (first 4096 characters) still holds any
  personal data the sender typed: a retention rule for `dpdp.mail_inbound.excerpt` is the
  owner's call; nothing here deletes anything.
* The classifier is keyword rules, not understanding. It is deliberately over-inclusive for
  the legal-clock classes and falls back to `review`; expect false positives to the operator
  rather than misses. A message written only in another language is `review`.
* **The machine-only signals are forgeable.** A `multipart/report` content type, and a
  MAILER-DAEMON/postmaster From together with an empty Return-Path / `Auto-Submitted` / a bounce
  subject, are set by whoever sends the message, and the design (owner's decision) files such a
  message as `auto` without escalation, so a hostile sender could hide a request that way. It is
  still recorded with an `A-` ticket, just not emailed to the operator; someone should look at the
  `auto` tickets now and then. The design already narrows it: a daemon *name* alone is no longer a
  signal, so an ordinary mail from `postmaster@smallfirm` is read like any other.
* **A human enquiry that carries a bulk / auto header is `auto`.** Only `data_request` and
  `grievance` keywords rescue a message under a header-based auto signal, so a sales, invoice,
  partner or support enquiry sent with `Precedence: bulk` (some CRMs and mailing systems add it)
  is recorded as `auto` and not emailed to the operator. So is one whose envelope sender is empty
  (`MAIL FROM:<>` / `Return-Path: <>`) without a daemon name or a delivery-status type. An "out of
  office" / "automatic reply" / "undeliverable" style subject counts as a signal only at the START of
  the subject (behind `Re:` / `Fwd:` / `AW:` and an optional gateway `[tag]`), and "Out of office hours"
  does not count, so "Undelivered invoice", "support out of office hours", "Do you support auto-reply
  templates?" or "Auto-replies not working" are read like any other mail.
* **Keyword coverage is finite.** A withdrawal or a grievance worded in a way none of the rules
  knows, sent as a reply to the Monday digest, a statutory notice, an invoice or a sales thread,
  stays under that class: the operator is still emailed (with the class label in the subject), but
  there is no D- / G- ticket, due date or acknowledgement. The lists were widened in two review
  passes (2026-09-29), and a reply in a script the rules cannot read (Tamil, Bengali, Gujarati,
  Urdu ...) becomes `review`; Marathi, other Latin-script languages and anything else are only as
  good as the lists. The structural alternative, if the owner wants a hard guarantee, is to file
  every reply to a broadcast (`monday`, `clock`) that is more than a bare thanks as `review`.
* **An unmarked echo of our own mail is read.** An auto-responder or a mobile client that pastes
  our digest or notice with no `>` and no `On ... wrote:` puts our own words in front of the
  keyword rules (the digest intro says "escalated to you", the leak-clock notice "Data Protection
  Board", the rights-clock notice "erasure"). The footers, the digest intro and headings, the
  "escalates twice as fast" clauses and the two clock notices' body lines are recognised as ours (a
  drift test over the whole rendered emails), but **job titles** are the organisation's own data ("Publish
  the grievance officer's details") and cannot be, so a marker-less echo of a digest whose job titles
  contain a legal word is still raised to grievance / data_request: a false ticket, the safe direction.
* **A reused Message-ID is a new ticket.** The same sender's same Message-ID is one message only if
  the subject and the excerpt (first 4096 characters) are also identical; otherwise it is a different
  message and gets its own ticket, noted `same Message-ID, different content` in the classifier reason
  and in the operator's notice (the id is stored as `<id>#<md5 of subject and excerpt>` so the unique
  index holds and a retry of that second message is a duplicate of it). A retry that arrives through a
  different path with a slightly different rendering of the same text is therefore a second ticket:
  the safe direction.
* **A truncated message is judged by the letters that survived.** With fewer than 20 readable letters of
  the person's own text (quotes and our boilerplate removed) a cut-short message is `review`, and the
  20 is a judgement, not a measurement: a genuine short reply to a very large digest echo is a false `R-`
  ticket. The Worker cuts at 4 KB, so a request that starts after the cut is seen only through this
  rule.
* **Bottom-posting is not read, but it is not filed under the tag either.** Everything after an
  `On ... wrote:` / Original Message / Outlook header-block marker is dropped, so an answer typed
  *below* the quoted original is not searched for keywords (reading the quote would put our own
  words into every reply). When that leaves NOTHING of the person's own above the quote (Thunderbird
  replies below the quote by default), the message becomes `review` (`nothingAboveTheQuote`: ticket,
  due date, acknowledgement, starred notice) instead of the class of its tag. The remaining miss: a
  bottom-posted reply with a line of the person's own above the quote ("Hi,", "Thanks") is still
  filed under its tag, because that line is all the classifier can read. The Worker also sends only
  the first 4 KB of text, so an answer that starts beyond it is never seen.
* Sender identity is only as good as the mail path: SPF/DKIM/DMARC are Cloudflare's and the
  sender's. The Worker forwards `Authentication-Results`, so a `dmarc=fail` message is not
  acknowledged; but if Cloudflare does not add that header (unverified), or the forged message
  passes, it gets an acknowledgement sent to the forged address ("backscatter"). The
  3-per-24-hours limit per address bounds it per address, and the overall 30-per-hour brake
  bounds it in total (at the price that a real request arriving during a flood is ticketed and
  reported but not acknowledged; the operator's notice then says to answer by hand).
* A follow-up from a person on an existing thread is a NEW ticket that names the earlier
  one (`In reply to: ticket ...`) only when the earlier message was an acknowledgement or
  another outbound mail we logged; tickets are not merged.
* Ticket numbers are race-safe by construction (one row lock per class and year) but the
  offline test uses one connection; exercise two simultaneous deliveries once on a real database.
  The hourly acknowledgement cap (30) reads a count without a lock, so two deliveries at the same
  instant can both pass at 29: it is a brake, not an exact meter.
* Nothing in this function closes a ticket; an operator calls `dpdp_mail_close` (see above).
* **Resend inbound: every address at the domain is accepted** (see the WARNING in "Resend inbound"). An address nobody
  publishes is filed as a logged-only `auto` ticket; a data request or grievance in the sender's own words to such an
  address keeps its legal class, but a message that is neither reaches nobody. Read the `unknown-recipient` tickets now and then.
* **Resend inbound: the verdicts are Resend's.** The acknowledgement guard only fires when Resend reports `dmarc: fail` (or
  SPF and DKIM both failing); a message Resend could not check (`processing_failed`, `unknown`, `gray`) is acknowledged like
  any other, because a legal request must not miss its acknowledgement. The bounded backscatter limits (3 per sender per 24 hours,
  30 per hour overall) still apply.
* **Resend inbound: the ticket holds the first 4096 bytes of the text.** The full message and its attachments stay in Resend
  under the email id printed in the operator's notice, for as long as Resend keeps them (its retention is not set here);
  nothing downloads an attachment, and the notice says so. A body over 20 MB is not parsed: the ticket is made from the
  webhook's metadata and the notice says the body was too large.
* **Resend inbound: the reconcile job is a repair tool, not a queue.** It re-reads every listed message in its window (one
  Resend API call each) and relies on the database to refuse duplicates; it stops at its cap (`limit`, default 100) or after
  about 100 seconds and says `partial: true`. The response shape of Resend's list endpoint was taken from its documentation
  and has not been seen live.
* **Resend inbound: a message with no Message-ID gets a synthetic `<resend-<email_id>@resend-inbound.invalid>`**, which also
  ends up in the `In-Reply-To` of an acknowledgement to it. It is harmless and is what keeps a retry from making a second ticket.
* The Svix signature check has no replay memory beyond the 5-minute window and the database's own dedup: a captured delivery
  replayed inside the window is answered from the same idempotent path (no second ticket, no second acknowledgement).
* **Resend inbound: a legal request kept at `postmaster@` / `abuse@` is not acknowledged.** The recipient policy files these as
  `support` and never acknowledges them (they receive bounces and abuse reports, and an acknowledgement there can loop), but a data
  request or grievance in a human's own words KEEPS its legal class (ticket, due date, operator told). The operator's notice says
  `Acknowledgement: NOT sent -- no acknowledgement for this address`: answer it by hand. If the owner would rather acknowledge such a
  ticket, the change is small and local to `handler.ts` (`policy?.noAck` should not apply when `applyPolicy` kept the class); it is
  left as specified because that rule and the owner's core rule (every legal request acknowledged) pull in opposite directions.
* **Resend inbound: mail to a guessed address with a `List-Unsubscribe` / `List-Id` header is `auto` even if it contains a legal
  word.** It is recorded (an `A-` ticket, reason `unknown-recipient (bulk: ...)`) and not announced; that is the price of not turning
  every mailing that reaches this accept-all domain into a `D-` ticket and an acknowledgement. A citizen writing a data request does not
  send those headers; a message to `dpdp@` itself is not affected.
* **Resend inbound: Svix gives a delivery about 15 seconds.** A delivery that needs a slow fetch AND a slow send can take longer; Svix
  then retries, and the retry is idempotent (no second ticket, acknowledgement or notice), so this costs a duplicate attempt, not a
  duplicate mail.
