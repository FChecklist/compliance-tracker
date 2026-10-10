# DNS records for Resend inbound email (prepared by the PM, applied only by the owner)

Register rows: BR-411 (this list is recorded), BR-412 (owner applied the records; checked by a read-only DNS lookup script that is created when the values are known). Decision: PMD-06, DNS stays owner-only, the PM makes no DNS change and no change in the Resend account.

## What was read (2026-09-25, read-only Resend API and Resend documentation)

- Resend holds one domain: `send.veridian-aios.com` (verified, region ap-northeast-1, sending enabled, **receiving disabled**). Its three sending records (DKIM TXT, SPF MX and SPF TXT on the `send` subdomain) are already in place. There is **no Resend domain for projexa-ai.com**.
- Resend documentation (custom domains for receiving): the MX record is copied from the Resend dashboard, Resend generates it per domain; when the root domain already has MX records Resend recommends a subdomain, because mail is delivered only to the MX record with the lowest priority value, so a Resend MX at the root would either not receive or would break the existing mail service.
- The existing root MX of veridian-aios.com belongs to Google Workspace and stays exactly as it is (PMD-06).

## Records to add (host names are proposals; the values come from the Resend dashboard)

| # | domain | type | host | value | priority | note | applied |
|---|---|---|---|---|---|---|---|
| 1 | projexa-ai.com | MX | `inbound` (that is inbound.projexa-ai.com) | COPY-FROM-RESEND | COPY-FROM-RESEND | Receiving on a subdomain leaves every existing record of the root untouched. The domain must first be added in Resend with receiving on. | no |
| 2 | veridian-aios.com | MX | `inbound` (that is inbound.veridian-aios.com) | COPY-FROM-RESEND | COPY-FROM-RESEND | Never at the root: the root MX is Google Workspace. Receiving must first be switched on in Resend for the domain. | no |

UNVERIFIED: the exact MX host names and priorities. Resend generates them per domain and no file in this package holds them. Until the two `COPY-FROM-RESEND` cells are filled, BR-412 cannot be checked.

## What the owner does (action A-2 in OWNER_QUESTIONS.md)

1. In Resend, add or open the domain for each of the two sending domains above, switch receiving on, and copy the MX record Resend shows.
2. Add that record at the DNS host of each domain, on the `inbound` subdomain (not the root).
3. Say `DNS applied for <domain>` in chat. The PM then fills the two cells above from what Resend showed, writes `scripts/verify/resend-inbound-dns.sh` (a read-only lookup of each listed record), runs it, and sets BR-412 and the rows that wait for it (BR-416, BR-417, BR-418).

Until then the email surface is reported blocked on the owner, never complete with 3 of 4 surfaces, and the flag `BUILD001_EMAIL_BRIDGE` stays off.
