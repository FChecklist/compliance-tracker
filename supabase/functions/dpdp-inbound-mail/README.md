# dpdp-inbound-mail -- the inbound side of dpdp@veridian-aios.com

The public shows ONE address, `dpdp@veridian-aios.com`. Everything the platform
sends carries a machine-readable `Reply-To` (`dpdp+<tag>.<ref>@veridian-aios.com`,
see `../_shared/mail-taxonomy.ts`), and everything that comes back is sorted into a
class here, given a ticket number, and put in front of the operator. Nothing is
silently dropped.

```
person -> dpdp@ / dpdp+<tag>.<ref>@
  -> Cloudflare Email Routing -> Email Worker (workers/dpdp-inbound-mail)
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
| `classify.test.ts`, `handler.test.ts` | Offline proof (see "Tests"). |
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
signals (a MAILER-DAEMON / postmaster sender, an empty Return-Path, a delivery-status /
multipart-report / disposition-notification content type) -> `auto`, before the plus-tag, **never
escalated**; (2) **header-based** auto signals (`Auto-Submitted` other than `no`, `X-Autoreply` /
`X-Autorespond`, `Precedence: bulk | auto_reply | junk`, an "out of office" / "automatic reply"
style subject, and our own `X-Veridian-Origin` **only when a thread match corroborates it**) ->
`auto`, also before the plus-tag, so a vacation reply to the Monday digest stops notifying the
operator every Monday, **unless** the text carries a data request or a grievance (escalation,
below); (a) the recipient's plus-tag; (b) In-Reply-To / References carries a Message-ID we sent
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

**The safety rule** (the owner's core requirement): `auto` is the only class logged without telling
the operator, so it is hard to reach. An `aut` tag in the address is *ignored* (anyone can type it).
The machine-only signals end in `auto` because a bounce is a bounce (but see the limitation below:
they can be forged). The header-based signals are chosen by the *sender*, so they can never hide a
legal request. One deliberate exception in the other direction: when the tag names a legal class
(`grv` / `dsr` / `rev`, which includes the legacy `grievance@` alias the Worker rewrites to
`dpdp+grv@`, or the `List-Unsubscribe` mailto of a digest or notice, `dpdp+dsr.<ref>@`, whose ref
matches a Monday or statutory row) and the message is **not a reply to one of our own
acknowledgements** (an outbound row with a ticket number, or of a legal-clock class), an auto header
does not divert the message to `auto`: it is filed under the tag, the operator is told, and (because
it carries auto headers) no acknowledgement is sent. A header-flagged reply to our own
acknowledgement IS diverted to `auto`: that is the auto-responder loop. `X-Auto-Response-Suppress` is **not** an auto signal: it is a
hint the sender sets about how others should answer them, not proof that the mail is automatic.

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
  **Never** sent when: the message carries auto-mail signals and was *not* escalated (an
  escalated message is acknowledged whatever headers the sender chose, except a header-flagged
  reply to **our own acknowledgement**, which is how two auto-responders loop; the ticket
  already exists); the sender is our own mailbox, a `no-reply` / `postmaster` / `mailer-daemon` /
  `bounce` address, or has no usable address; the sender failed DMARC in `Authentication-Results`;
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
(first 1000 characters, `closed_note`). It is idempotent (the first call sets the time and note,
later calls change nothing and answer `alreadyClosed: true`), answers `{ ok: false }` for an unknown
ticket, and **never reopens**: nothing else in the schema moves a ticket out of `closed`. Nothing
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

## What the PM / owner must do, in this order

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
   `deploy_edge_function`: `verify_jwt: false`, files `index.ts`, `handler.ts`, `classify.ts`
   **and `../_shared/mail-taxonomy.ts`** (both `handler.ts` and `classify.ts` import it).
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

`bunfig.toml` sets the test root to `src/`, so a bare `bun test` does **not** find the two
test files that live beside the function (nor `../_shared/mail-taxonomy.test.ts`). Name them:

```
bun test --isolate ./supabase/functions/dpdp-inbound-mail/classify.test.ts
bun test --isolate ./supabase/functions/dpdp-inbound-mail/handler.test.ts
bun test --isolate ./supabase/functions/_shared/mail-taxonomy.test.ts
bun test --isolate src/lib/services/dpdp-single-mailbox-migration.pglite.test.ts   # PGlite: real Postgres, no database needed (incl. the 30/hour cap and dpdp_mail_close)
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
* **The machine-only signals are forgeable.** A MAILER-DAEMON/postmaster From, an empty
  Return-Path and a `multipart/report` content type are set by whoever sends the message, and
  the design (owner's decision) files such a message as `auto` without escalation, so a hostile
  sender could hide a request that way. It is still recorded with an `A-` ticket, just not
  emailed to the operator; someone should look at the `auto` tickets now and then.
* **A human enquiry that carries a bulk / auto header is `auto`.** Only `data_request` and
  `grievance` keywords rescue a message under a header-based auto signal, so a sales, invoice,
  partner or support enquiry sent with `Precedence: bulk` (some CRMs and mailing systems add it)
  is recorded as `auto` and not emailed to the operator. An "out of office" / "automatic reply" /
  "undeliverable" style subject counts as a signal only at the START of the subject (behind
  `Re:` / `Fwd:` / `AW:`), so "Undelivered invoice" or "support out of office hours" is read like any
  other mail.
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
  Board", the rights-clock notice "erasure"). Only the footers are recognised as ours, so such a
  reply is raised to grievance / data_request: a false ticket, the safe direction.
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
