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
| `../../../drizzle/0662_dpdp_single_mailbox_mail_log.sql` | The mail log: `dpdp.mail_outbound`, `dpdp.mail_inbound`, ticket counter, `public.dpdp_mail_*` (service_role only). |

## The classes

| Class | Ticket | Legal clock + acknowledged | Operator emailed | How it is reached |
| --- | --- | --- | --- | --- |
| `grievance` | `G-2026-0042` | yes | yes | tag `grv`, thread, or keyword |
| `data_request` | `D-...` | yes | yes | tag `dsr`, thread, or keyword |
| `review` | `R-...` | yes | yes | tag `rev`, thread, or **the default when nothing matched** |
| `monday` | `M-...` | no | yes | tag `mon` or thread (a reply to the Monday digest) |
| `sales` | `S-...` | no | yes | tag `sal`, or keyword |
| `sales_chain` | `T-...` | no | yes | tag `sch`, or a reply to something we sent as `sales` |
| `invoice` | `I-...` | no | yes | tag `inv`, thread, or keyword |
| `partner` | `P-...` | no | yes | tag `prt`, or keyword |
| `support` | `H-...` | no | yes | tag `sup`, or keyword |
| `auto` | `A-...` | no | **no (logged only)** | our own mailbox as sender, strong auto-mail signals, or weak ones with nothing to read |

First match wins, in this order: (0) sender is our own mailbox -> `auto`; (a) the
recipient's plus-tag; (b) In-Reply-To / References carries a Message-ID we sent
(`sales` -> `sales_chain`); (c) auto mail; (d) keywords on the subject and the first
4096 characters of the text, quoted lines removed, English and Hindi/Hinglish, in
the order data_request, grievance, invoice, partner, sales, support; (e) `review`.

**The safety rule** (the owner's core requirement): `auto` is the only class logged
without telling the operator, so it is hard to reach. An `aut` tag in the address is
*ignored* (anyone can type it). Strong auto signals (MAILER-DAEMON / postmaster
sender, empty Return-Path, `Auto-Submitted` other than `no`, `X-Autoreply`,
`Precedence: auto_reply`, a delivery-status / multipart-report content type, our own
`X-Veridian-Origin`) always mean auto. Weak ones (`Precedence: bulk|junk`,
`X-Auto-Response-Suppress`, an "out of office" style subject) mean auto only when no
keyword rule matches. Rules (a) and (b) run before (c), as specified, so an
out-of-office answering a Monday email lands as `monday`, with its auto signals listed
in the notice and **no acknowledgement sent to it**.

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

* **Acknowledgement to the sender** (grievance, data_request, review only). From
  `DPDP_EMAIL_FROM`, `Reply-To` `dpdp+<tag>.<new ref>@`, subject
  `[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0042)`. It says
  the message was received, gives the ticket number, and says we will respond. It asserts
  nothing legal (no deadline, no statute). It is logged in `dpdp.mail_outbound` with the
  ticket, so a reply to it lands on the same class and is tied to the ticket. Sent with
  `Auto-Submitted: auto-replied`, `X-Auto-Response-Suppress: All`, `X-Veridian-Origin:
  acknowledgement`. **Never** sent when: the message carries any auto-mail signal; the
  sender is our own mailbox, a `no-reply` / `postmaster` / `mailer-daemon` / `bounce`
  address, or has no usable address; the sender failed DMARC in `Authentication-Results`;
  or 3 acknowledgements already went to that sender in 24 hours.
* **Operator notice** (every class but auto). To `DPDP_OPERATOR_EMAIL`, subject
  `[GRIEVANCE G-2026-0042] original subject`, `Reply-To` the original sender (replying
  answers the sender directly, from the operator's own address), a summary block (class
  and why, ticket, respond-by date, from, to, related ticket, acknowledgement status) and
  the original message quoted. Sent with `Idempotency-Key` so a retried delivery cannot
  send it twice.
* **Raw forward** (database down): the message itself, subject `[CLASS UNRECORDED] ...`.

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
bun test --isolate src/lib/services/dpdp-single-mailbox-migration.pglite.test.ts   # PGlite: real Postgres, no database needed
(cd workers/dpdp-inbound-mail && bun test)   # incl. pipeline.test.ts: Worker -> this function -> drizzle/0662 on PGlite
```

## Honest limitations

* Attachments are not stored, and the text excerpt (first 4096 characters) still holds any
  personal data the sender typed: a retention rule for `dpdp.mail_inbound.excerpt` is the
  owner's call; nothing here deletes anything.
* The classifier is keyword rules, not understanding. It is deliberately over-inclusive for
  the legal-clock classes and falls back to `review`; expect false positives to the operator
  rather than misses. A message written only in another language is `review`.
* Sender identity is only as good as the mail path: SPF/DKIM/DMARC are Cloudflare's and the
  sender's. The Worker forwards `Authentication-Results`, so a `dmarc=fail` message is not
  acknowledged; but if Cloudflare does not add that header (unverified), or the forged message
  passes, it gets an acknowledgement sent to the forged address ("backscatter"). The
  3-per-24-hours limit per address bounds it per address, not overall.
* A follow-up from a person on an existing thread is a NEW ticket that names the earlier
  one (`In reply to: ticket ...`) only when the earlier message was an acknowledgement or
  another outbound mail we logged; tickets are not merged.
* Ticket numbers are race-safe by construction (one row lock per class and year) but the
  offline test uses one connection; exercise two simultaneous deliveries once on a real database.
* `status` can be `closed` but nothing in this function closes a ticket; that is a manual
  update for now.
