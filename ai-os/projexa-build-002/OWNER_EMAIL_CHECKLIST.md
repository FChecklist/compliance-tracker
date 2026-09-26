# Owner checklist: way 4, email (PROJEXA-BUILD-002 WP-12)

Status: the code is built and tested locally and is not live. Nothing below has been done. Every step is the owner's. No step uses Vercel to deploy or to change a setting, and no step needs a value to be written into this repository. Names only are listed here; the values come from the Resend dashboard and from your own secret store.

Register rows: AW-604 (way 4 in code, `bash scripts/verify/way4-zoomies.sh`) and AW-904 (live, `bash scripts/verify/way4-zoomies.sh --live`, which only looks up DNS).

## 1. What now happens when the steps are done

- A person writes to their own address, for example `asha.mehta@inbound.veridian-aios.com`, with the ZOOMIES workbook attached.
- The webhook checks the Resend signature, finds the person from the address, and checks that the From address is an active member-or-above person of the same organisation. Anyone else is refused, the refusal is written on the message row, and nothing of the message is downloaded, stored, read or sent to a model.
- A known person's `.xlsx` is read by the deterministic reader and the extraction contract (the same code an upload uses), and becomes a proposal that waits. Nothing is created from an email. A `.pdf` or `.docx` is stored and named as not read; no reader for those exists yet.
- The person sees the proposal in the open list (`GET /api/v1/projexa/projects/from-document?open=1`), answers or acknowledges the questions, and approves by posting the job id and the product. Only that call creates the project and its BOQ.

## 2. Hostnames (names only; the code and `DNS_RESEND_INBOUND_RECORDS.md` now agree)

| Hostname that receives mail | Where it is accepted in the code |
| --- | --- |
| `inbound.veridian-aios.com` | `INBOUND_ALIAS_DOMAINS` in `src/lib/services/email-alias-service.ts` |
| `inbound.projexa-ai.com` | the same list |
| `mail.veridian-aios.com` | `DEFAULT_ALIAS_DOMAIN`, accepted since 2026-09-13, not in the DNS list; keep or drop it when you choose (decision D-6) |

The two root domains are never used for receiving: the MX record of `veridian-aios.com` belongs to Google Workspace and stays as it is. `src/lib/services/email-inbound-hostnames.test.ts` fails if the code and the record list drift apart.

## 3. Your steps, in order

1. In the Resend dashboard, add each receiving hostname as a domain (`inbound.veridian-aios.com`, and `inbound.projexa-ai.com` if you want that brand), switch receiving on, and copy the MX record Resend shows for it.
2. At the DNS host of each root domain, add that MX record on the `inbound` subdomain, not on the root. Tell the PM `DNS applied for <domain>`; the PM fills the two `COPY-FROM-RESEND` cells of `ai-os/projexa-build-001/DNS_RESEND_INBOUND_RECORDS.md` from what Resend showed.
3. In Resend, add a webhook for the event `email.received` that points to the receiver route of the deployed app: `/api/webhooks/resend-inbound`.
4. Set these two environment variable NAMES in the environment that serves the webhook (values only from Resend, never in chat or in a file of this repository): `RESEND_WEBHOOK_SECRET` (the webhook's signing secret) and `RESEND_API_KEY` (a key that may read received email).
5. Set the two names the extraction already needs, if not set for way 1: `PROJEXA_DOCUMENT_EXTRACT_SECRET` (Edge secret and server environment) and the model provider key of the `projexa-document-extract` function (BR-509).
6. Give each person who will send workbooks an address: the code that provisions an alias (`getOrCreateUserEmailAlias`) is written and tested but no screen or first-login step calls it yet. Until a product decision says where it is called, the PM provisions aliases by a reviewed one-off statement that you approve.
7. Run `bash scripts/verify/way4-zoomies.sh --live` (read-only DNS) and send one test email with the ZOOMIES workbook from a person's own address. The PM then records the result against AW-904.

## 4. Decisions and limits stated plainly

- D-6 (hostname and provider): the code accepts the two `inbound.*` hosts and `mail.veridian-aios.com`. PROJEXA's own Postmark address (`reply.projexa-ai.com`) is a different, separate design and is not touched.
- Whether Resend adds an `Authentication-Results` header to received email is not proven (no live delivery has been made). The webhook refuses a message whose header says SPF, DKIM or DMARC failed, and does not refuse one that has no header. A forged From line from a known person's address would therefore reach the proposal step; it still creates nothing until a person approves.
- The webhook runs on the Next.js route. Vercel is paused, so nothing arrives until the app is served somewhere with the two secrets above. Moving the receiver to an Edge function is not done.
- A message with more than 2 workbooks reads the first 2 and names the rest in a note (each read can wait up to 110 s for the model; the route allows 300 s).
- A message with questions leaves a job in `needs_answers`; there is no reply-by-email path yet, the person answers through the open list.
