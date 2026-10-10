# dpdp-inbound-mail

Cloudflare **Email Worker** for the one public DPDP address, `dpdp@veridian-aios.com`.

Everything sent to that address (and to `dpdp+<tag>.<ref>@...`, the Reply-To the platform
stamps on its own outbound mail) reaches this Worker. The Worker parses the mail, POSTs the
fields the classifier needs to the Supabase Edge Function `dpdp-inbound-mail`, and steps
aside. It does **no classification itself** -- that is a pure function in the Edge Function
(see `supabase/functions/_shared/mail-taxonomy.ts` for the shared taxonomy).

```
sender ──> Cloudflare Email Routing ──> THIS WORKER ──POST JSON──> Edge Function dpdp-inbound-mail
           (dpdp@ rule + catch-all)        │                         classify, ticket, notify operator,
                                           │                         acknowledge the sender
                                           └── ANY failure ──> message.forward(FALLBACK_FORWARD_TO)
```

## The one rule: never lose a mail

Some of what arrives here (grievances, data-subject requests) starts a legal response clock,
so a mail must not vanish because a service was down.

| What happens | Result |
|---|---|
| Edge Function answers 2xx | Ticketed. Nothing else happens. |
| Config missing, or URL is not https | Original forwarded to `FALLBACK_FORWARD_TO`. |
| Message stream error, parse error, or a parse that produced no sender/subject/Message-ID | Original forwarded. |
| Network error, timeout (`POST_TIMEOUT_MS`), any non-2xx (4xx, 5xx, 3xx) | Original forwarded. |
| Mail larger than `MAX_RAW_BYTES` (default **131072** = 128 KiB) | The head is parsed and ticketed with `truncated: true`, **and** the full original is forwarded natively (the ticket only holds an excerpt). |
| The forward itself fails (`FALLBACK_FORWARD_TO` unset or not a verified destination) | The handler **throws**, so the mail is not accepted as delivered. Last resort; avoid it by doing the "verify the fallback" step below. |
| Recipient is `postmaster@` or `abuse@` (RFC 2142 role mailboxes) | **Accepted, forwarded natively to `FALLBACK_FORWARD_TO`, not read, not parsed, not ticketed.** Every mail system is entitled to write to these two (bounce diagnostics, spam and abuse reports); refusing them would be a defect of its own. The forward carries `X-Veridian-Fallback-Reason: role_mailbox:postmaster` (or `:abuse`). If that forward fails the handler throws, like any other last resort. Exact names only: `postmaster+x@`, `abuse@send.veridian-aios.com` and the like are refused. |
| Recipient is anything else (not `dpdp@`, `dpdp+*@`, `grievance@`, `partners@`, `postmaster@`, `abuse@`) | Refused at SMTP level (`setReject("Unknown recipient")`). Keeps catch-all spam out of the ticket queue. |

A forwarded original carries two extra headers: `X-Veridian-Fallback-Reason` (why ticketing
was bypassed, e.g. `post_http_500`, `post_timeout`, `config_missing`, `parse_unusable`,
`oversize_full_copy`, or `role_mailbox:postmaster` / `role_mailbox:abuse` for the two RFC 2142
role mailboxes, which are forwarded on purpose rather than because something failed) and
`X-Veridian-Envelope-To` (the address it was really sent to).

Two consequences to know about, both chosen over losing mail:

* **Duplicates are possible.** If the Edge Function did the work but its reply was lost, the
  Worker cannot know, forwards, and the operator sees the mail twice. `message_id` is in the
  payload so the function can de-duplicate the ticket side.
* **Oversized mail is delivered twice** (ticket excerpt + full forward). Rare by design:
  anything over 128 KiB, in practice a mail that carries a scan or a photo.
* **A grievance or data request sent to `postmaster@` / `abuse@` is not ticketed** and gets no
  automatic acknowledgement or clock: it is only forwarded to the operator's inbox. Those two
  addresses are not published for the public, so this is judged acceptable, but it is a real
  gap in the "nothing misses its clock" rule. Someone reading the forwarded copy has to forward
  it to `dpdp@` to start a ticket. (Routing them through the ticketing path as `review` instead
  is a small change in `src/recipient.ts` if the owner prefers it.)

The legacy published addresses keep working: `grievance@` is treated as `dpdp+grv@` and
`partners@` as `dpdp+prt@` (tags come from the shared taxonomy), so the classifier's
highest-confidence rule (the recipient tag) still fires for mail sent to an old address.

## Payload sent to the Edge Function

`POST <DPDP_INBOUND_URL>` with `Authorization: Bearer <DPDP_INBOUND_SECRET>` and
`Content-Type: application/json`. The wire contract is the `InboundMailPayload` type in
[`src/types.ts`](src/types.ts) -- change a field there and the function's parser must change
with it. Header values are raw and clipped; nothing is trusted.

```json
{
  "version": 1,
  "received_at": "2026-09-29T10:00:00.000Z",
  "envelope_from": "asha@example.org",
  "envelope_to": "dpdp+grv@veridian-aios.com",
  "envelope_to_raw": "grievance@veridian-aios.com",
  "header_from": "Asha Rao <asha@example.org>",
  "from_address": "asha@example.org",
  "from_name": "Asha Rao",
  "header_to": "dpdp@veridian-aios.com",
  "reply_to": null,
  "subject": "Please delete my data",
  "message_id": "<abc@example.org>",
  "in_reply_to": "<out-9@veridian-aios.com>",
  "references": "<out-1@veridian-aios.com> <out-9@veridian-aios.com>",
  "auto_submitted": null,
  "precedence": null,
  "x_autoreply": null,
  "x_auto_response_suppress": null,
  "content_type": "text/plain; charset=utf-8",
  "text": "first 4096 UTF-8 bytes of the body (text/plain, else tag-stripped html)",
  "has_attachments": false,
  "raw_size": 243,
  "truncated": false
}
```

`envelope_from` is the empty string for a bounce (null reverse-path). `envelope_to` is what
`parseRecipient()` should read the class tag from.

`auto_submitted`, `precedence`, `x_autoreply` and `x_auto_response_suppress` are `null` when
the header is absent and `""` when it is present but empty -- for auto-mail detection the
presence is the signal, so do not test them for truthiness.

`headers` (omitted from the example above for brevity) is the classifier-shaped header map:
lower-cased name -> raw value for the allowlisted headers the mail carries
(`return-path` -- `<>` when empty --, `auto-submitted`, `x-autoreply`, `x-autorespond`,
`x-auto-reply`, `x-auto-response-suppress`, `precedence`, `x-veridian-origin`,
`x-veridian-class`, `x-veridian-ref`, `list-id`, `list-unsubscribe`, `cc`, `sender`,
`authentication-results`). Only
present headers appear, and a present-but-empty one is `""`. The allowlist is
`FORWARDED_HEADERS` in `src/payload.ts`; it deliberately excludes `Received` and friends.

## Configuration

Set in [`wrangler.toml`](wrangler.toml) (`[vars]`) unless noted. **No secret is ever in the repo.**

| Name | Kind | Required | Meaning |
|---|---|---|---|
| `DPDP_INBOUND_URL` | var | yes | Full https URL of the Edge Function, e.g. `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-inbound-mail`. The bearer is never sent to a non-https URL (plain `http://localhost` is allowed for local runs). |
| `DPDP_INBOUND_SECRET` | **secret** | yes | Shared bearer secret. Must equal the Edge Function's own `DPDP_INBOUND_SECRET` function secret. Set with `wrangler secret put`, never in `wrangler.toml`. The Edge Function must be deployed with `--no-verify-jwt`: this is a shared secret, not a Supabase JWT, and the gateway would otherwise answer 401 before the function runs, so every mail would take the fallback path. |
| `FALLBACK_FORWARD_TO` | var | yes | Where the original goes if anything fails. Set to `raajat.agarwal@gmail.com`. Must be a **verified destination address** in Email Routing. |
| `POST_TIMEOUT_MS` | var | no | How long to wait for the Edge Function. Default `8000`, max `25000`. |
| `MAX_RAW_BYTES` | var | no | Read at most this much of a mail. Default **`131072`** (128 KiB), range `4096`-`8388608`. `wrangler.toml` sets it explicitly to the same number, and a test keeps that file and the code default equal. Larger mail is still ticketed (truncated) and forwarded in full, never dropped. |

Generate the shared secret once and put the **same value** on both sides:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Deploy

### A. With wrangler (recommended)

The Cloudflare login is interactive and belongs to the account owner; do not paste API tokens
into chat or into files.

```
cd workers/dpdp-inbound-mail
bun install
bun test                          # no network needed
bun run typecheck
bunx wrangler login               # once, opens a browser
bunx wrangler secret put DPDP_INBOUND_SECRET     # paste the shared secret when prompted
bunx wrangler deploy
```

`wrangler deploy` also applies the `[vars]` in `wrangler.toml` (`DPDP_INBOUND_URL`,
`FALLBACK_FORWARD_TO`). Edit them there, not only in the dashboard: a deploy replaces
dashboard-set vars with the file's.

`bun run check:bundle` (`wrangler deploy --dry-run`) validates the config and bundle without
uploading anything or needing a login.

### B. Dashboard paste (no CLI)

1. `bun install && bun run bundle` produces `dist/worker.js` -- one self-contained ES module
   (about 125 KB including postal-mime and the taxonomy).
2. Cloudflare dashboard -> **Workers & Pages** -> **Create** -> **Create Worker** -> name it
   exactly `dpdp-inbound-mail` -> **Deploy** (the hello-world) -> **Edit code**.
3. Select all, paste the contents of `dist/worker.js`, **Deploy**.
4. **Settings** -> **Variables and Secrets** -> add:
   `DPDP_INBOUND_URL` (Text), `FALLBACK_FORWARD_TO` (Text), `DPDP_INBOUND_SECRET` (**Secret**),
   and optionally `POST_TIMEOUT_MS` / `MAX_RAW_BYTES` (Text).

The dashboard copy is not under source control; if you later switch to wrangler, the file's
`[vars]` win.

### Point Email Routing at the Worker

Cloudflare dashboard -> `veridian-aios.com` -> **Email** -> **Email Routing**.

1. **Check the domain's existing MX records first.** Enabling Email Routing puts Cloudflare's
   MX records on the domain; anything already receiving mail there stops doing so. (The
   handover note for WO-DPDP-008 flags a root-MX discrepancy to look at before this.)
   `HANDOFF_FOR_RAJAT.md` (2026-09-16) records the bare domain as Google Workspace for the
   everyday human addresses (`rajat@`, `hello@`, ...): each of those needs its own explicit
   Email Routing rule to a verified destination BEFORE the switch, because this Worker refuses
   every address it does not own (see the table above) and a catch-all pointed at it would
   bounce them. (`postmaster@` and `abuse@` are the exception: the Worker accepts and forwards
   them, see step 3.)
2. **Destination addresses** -> add `raajat.agarwal@gmail.com` and click the verification link
   Cloudflare emails to it. **This is what the fallback forward depends on.**
3. **Routing rules** -> **Create address**: custom address `dpdp`, action **Send to a Worker**,
   destination `dpdp-inbound-mail`. Save. Do the same for `postmaster` and `abuse` (RFC 2142
   asks every domain to be reachable there): each is a rule with action **Send to a Worker**,
   destination `dpdp-inbound-mail`. The Worker forwards those two to `FALLBACK_FORWARD_TO`
   without ticketing them. (A `postmaster`/`abuse` rule that forwards straight to a mailbox is
   fine too; only the catch-all decides whether the Worker sees them.)
4. **Catch-all address: leave it OFF unless step 3 of "Verify after deploy" shows it is needed.**
   Email Routing is documented to support plus-addressing (RFC 5233), so `dpdp+<tag>.<ref>@`
   should already match the `dpdp` rule (not verified from here). Only if that test mail does
   not reach the Worker: **Catch-all address** -> action **Send to a Worker**, destination
   `dpdp-inbound-mail`, status **Active**. Be aware this hands EVERY otherwise-unmatched address
   at the domain to the Worker, which refuses it with "Unknown recipient" - so first give every
   live non-DPDP address (see step 1) its own rule. The Worker works either way because it
   reads the envelope recipient.
5. If rules for `grievance` and/or `partners` already exist and forward straight to a mailbox,
   change their action to the Worker too, or delete them and let the catch-all take them. A
   specific rule beats the catch-all, so a leftover rule would bypass ticketing.

Not covered here: the *sending* side (SPF/DKIM/DMARC for `From: dpdp@veridian-aios.com`
through Resend) is a separate task.

### Verify after deploy

1. `bunx wrangler tail dpdp-inbound-mail` (or dashboard -> Worker -> Logs). Logs are
   structured JSON with event names and reason codes only; they never contain a subject, an
   address or a body.
2. From another mailbox, send to `dpdp@veridian-aios.com`. Expect `"event":"ticketed"` and a
   row / operator notification from the Edge Function.
3. Send to `dpdp+grv.k3f9x2ab7q@veridian-aios.com`: the tag must survive to `envelope_to`.
4. Send to `grievance@veridian-aios.com`: must arrive as `envelope_to = dpdp+grv@...`.
5. Send to `sales@veridian-aios.com` (or any random address): the sender must get a bounce
   saying "Unknown recipient" and nothing must be ticketed.
   Send to `postmaster@veridian-aios.com` and `abuse@veridian-aios.com`: both must land in
   `raajat.agarwal@gmail.com` with `X-Veridian-Fallback-Reason: role_mailbox:...`, no bounce, and
   `wrangler tail` must show `role_mailbox` and `forwarded_to_fallback` (no `ticketed`).
6. **Fallback drill (do not skip):** `bunx wrangler secret put DPDP_INBOUND_SECRET` with a
   deliberately wrong value, send a mail, and confirm it lands in `raajat.agarwal@gmail.com`
   (check spam) with `X-Veridian-Fallback-Reason: post_http_401`. Then put the right secret
   back and repeat step 2. This proves the fallback address is verified and forwarding works
   after the message stream has been read, on the real runtime.
7. Dashboard -> Worker -> Metrics: look at CPU time per invocation on real traffic (see the
   CPU note below).
8. **Attachment drill (do not skip):** send a mail with a ~60 KB attachment (under the 128 KiB
   cap), one with a ~300 KB attachment (a scanned ID is what a data-erasure request typically
   carries) and one with a ~2 MB attachment. Expect the first to be ticketed with
   `truncated: false` and no CPU error in `wrangler tail`; expect the second and third to be
   ticketed with `truncated: true` AND a complete copy (attachment included) in
   `raajat.agarwal@gmail.com` with `X-Veridian-Fallback-Reason: oversize_full_copy`. Not verified
   on the real runtime: that `forward()` still delivers the whole message after the read stream
   was cancelled at the cap. If the copy is incomplete, or the free plan reports "exceeded CPU"
   even at 128 KiB, lower `MAX_RAW_BYTES` further (see the CPU note) or move to the paid plan.

### Local run with the real workerd runtime (no Cloudflare account, no live services)

```
# terminal 1: any server that accepts POSTs stands in for the Edge Function
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(q.headers.authorization,b);s.end('{}')})}).listen(8799,'127.0.0.1')"

# terminal 2
bunx wrangler dev --local --port 8787 --ip 127.0.0.1 \
  --var "DPDP_INBOUND_URL:http://127.0.0.1:8799/x" \
  --var "DPDP_INBOUND_SECRET:local-only-not-real" \
  --var "FALLBACK_FORWARD_TO:operator@example.com"

# terminal 3: push a raw .eml through the email handler
curl -X POST --data-binary @mail.eml \
  "http://127.0.0.1:8787/cdn-cgi/handler/email?from=asha@example.org&to=dpdp%2Bgrv.k3f9x2ab7q@veridian-aios.com"
```

Stop the dev server as a process **tree** (on this Windows machine:
`taskkill /PID <wrangler-node-pid> /T /F`); killing only the port owner leaves wrangler
respawning workerd.

## Tests

```
cd workers/dpdp-inbound-mail
bun test              # handler.test.ts + text.test.ts + pipeline.test.ts
bun run typecheck
```

This is a standalone package. The repo root's `bun test` (bunfig `root = "src"`) does not
run these tests; run them from this directory.

`handler.test.ts` uses a hand-built mock of `ForwardableEmailMessage` (real `ReadableStream`,
recorders for `forward()` / `setReject()`) and really parses the MIME with postal-mime; only
`fetch` and the clock are replaced. It covers: the happy path and the exact request made;
plus-tagged and legacy-alias recipients; unknown recipients refused; the RFC 2142 role mailboxes
(`postmaster@`, `abuse@`) forwarded untouched, unread and unticketed, and their lookalikes refused;
Edge Function 5xx / 4xx / 3xx; network error; timeout (with and without an abort-aware `fetch`); missing config and
insecure URL; malformed MIME and a throwing parser; a stream that errors mid-read; a refused
annotated forward retried bare; a failing fallback throwing; oversized mail (read is capped and
cancelled, ticketed as truncated, forwarded in full; the 128 KiB default, its equality with
`wrangler.toml`, and an erasure request carrying a 300 KB scan); and that logs never contain mail
content or the secret. `text.test.ts` covers the html-to-text, whitespace and UTF-8 cap
helpers, including hostile inputs.

`pipeline.test.ts` connects this Worker to the rest: it runs the Worker's real handler, delivers its POST
in-process to the Edge Function's real handler (`supabase/functions/dpdp-inbound-mail`), and lets that call
the real `drizzle/0662` functions on PGlite (real Postgres, no server) by named argument, as service_role.
It is the one test that fails if a payload field, an RPC argument, a returned key or an HTTP status stops
meaning the same thing on both sides. It needs `@electric-sql/pglite`, which Node resolution finds in the
repo root's `node_modules` (so run `bun install` at the root once as well); only the Resend send and the
clock are replaced.

What the tests cannot show is real-runtime behaviour: use the local run above and the
post-deploy checks.

## Known limits (deliberate, not hidden)

* **CPU budget.** Parsing runs inside the Worker's CPU limit, documented as 10 ms on the free
  Workers plan at the time of writing (check the current limit). Ordinary text enquiries should
  be far below it; a large HTML newsletter or a mail with a big attachment may not be. Nothing
  is silently lost -- the invocation fails and the sender's server is told delivery failed --
  but measure real CPU time after launch and, if it gets close, lower `MAX_RAW_BYTES` (only the
  head and the first 4 KB of text are used anyway) or move to the paid plan. Review-time
  measurement, local `bun` wall clock on a warm desktop (NOT workerd CPU time): a 114-byte mail
  parses in ~1 ms; a mail with an attachment read up to the cap takes ~3 ms at 64 KiB, ~5 ms at
  128 KiB, ~9 ms at 256 KiB and ~40 ms at 1 MiB (~16 ms for a 300 KiB attachment read whole).
  Against a 10 ms budget the old 1 MiB default was therefore unlikely to be safe for
  attachment-carrying mail on the free plan, so **the default cap is now 131072 (128 KiB)**, in
  both `src/handler.ts` and `wrangler.toml`. The cost of the small cap is only that a larger mail
  is ticketed from its head (`truncated: true`, the first 4 KB of text) and delivered a second
  time in full; nothing is lost. The free-plan figure has not been measured inside workerd.
* **A failed last-resort forward** makes the handler throw. Cloudflare then reports a failure
  to the sending server instead of success; the exact SMTP code is Cloudflare's and was not
  verified here.
* **The text excerpt is keyword-grade.** html is reduced to text by a small linear scanner
  (drops script/style/head/comments, block tags to line breaks, common entities decoded); it
  does not render layout, links or CSS-hidden text.
* **The Worker trusts nothing in the mail** and interprets nothing in it: forged headers such
  as `Auto-Submitted` are passed on as sent, and deciding what to do about them is the
  classifier's job.
* postal-mime is pinned to `^4.0.0` (bun.lock records the exact version).

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | The `export default { email }` the runtime calls. Nothing else is exported from the Worker module. |
| `src/handler.ts` | `handleInbound`: recipient check, capped read, parse, POST, fallback. Long header comment explains the failure policy. |
| `src/recipient.ts` | Recipient allowlist, legacy-alias rewrite and the `forward_only` RFC 2142 role mailboxes, built on the shared taxonomy. |
| `src/payload.ts` | Builds the JSON payload from the parsed mail. |
| `src/text.ts` | Body -> 4 KB excerpt (linear html stripper, UTF-8-safe cap). |
| `src/types.ts` | Message/Env types and the `InboundMailPayload` wire contract. |
| `wrangler.toml` | Worker name, entry point, non-secret vars (including `MAX_RAW_BYTES = "131072"`), logging. |
| `gmail-filters.xml` | Not part of the Worker: a Gmail "Import filters" file for the operator's inbox (labels `DPDP/...`, stars the legal-clock notices, never archives anything). How to import it, and the Send-mail-as set-up: `dpdp-app/OPERATIONS.md`, section "Single mailbox". Checked against the taxonomy by `src/lib/services/dpdp-mail-edge-functions.test.ts` at the repo root. |
| `package.json`, `bun.lock`, `tsconfig.json` | Standalone package (postal-mime; wrangler, typescript, @types/bun for dev). |
