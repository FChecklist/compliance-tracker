#!/usr/bin/env bash
# register: AW-604 (way 4 in code); AW-904 (--live, owner steps)
# PROJEXA-BUILD-002 WP-12: an email with the ZOOMIES workbook attached produces a prepared proposal that a person confirms.
#
#   bash scripts/verify/way4-zoomies.sh          AW-604. Runs the way-4 tests, each of which reads its counts back from the database:
#                                                 email-attachment-intake.test.ts        the ZOOMIES email is one job, 0 projects, 0 BOQs; approval creates 53 lines
#                                                                                         adding up to 1,596,280; a planted instruction creates nothing
#                                                 email-sender-check.test.ts             an unknown sender, another organisation, a viewer and a failed DKIM verdict are refused
#                                                 route.attachments.test.ts / route.test.ts  the webhook refuses before it downloads, stores or reads anything
#                                                 route.email-job.test.ts                the open list and the approval by job id, through the route
#                                                 email-inbound-hostnames.test.ts        the code accepts the hosts DNS_RESEND_INBOUND_RECORDS.md names
#   bash scripts/verify/way4-zoomies.sh --live   AW-904. Read-only DNS lookups: the MX record of inbound.veridian-aios.com and of
#                                                 inbound.projexa-ai.com. It changes nothing and calls no Resend or Vercel API. Exit 1 until the owner has added
#                                                 the records; the exact steps are in ai-os/projexa-build-002/OWNER_EMAIL_CHECKLIST.md.
#
# Exit 0 = every check passed. Exit 1 = a check failed (bun's own report or the missing record is above). Exit 2 = a tool is missing.
# The last stderr line is `PASS AW-604` / `FAIL AW-604: <reason>` (or AW-904 with --live).
set -u

cd "$(dirname "$0")/../.." || exit 2

if [ "${1:-}" = "--live" ]; then
  fail() { printf 'FAIL AW-904: %s\n' "$1" >&2; exit 1; }
  lookup() {
    if command -v dig >/dev/null 2>&1; then dig +short MX "$1"
    elif command -v nslookup >/dev/null 2>&1; then nslookup -type=MX "$1" 2>/dev/null | grep -i "mail exchanger"
    else return 2
    fi
  }
  command -v dig >/dev/null 2>&1 || command -v nslookup >/dev/null 2>&1 || { printf 'FAIL AW-904: neither dig nor nslookup is available\n' >&2; exit 2; }
  missing=""
  for host in inbound.veridian-aios.com inbound.projexa-ai.com; do
    answer="$(lookup "$host")"
    if [ -n "$answer" ]; then printf 'MX present for %s\n' "$host"; else printf 'MX missing for %s\n' "$host"; missing="$missing $host"; fi
  done
  [ -z "$missing" ] || fail "no MX record yet for:$missing (owner step: OWNER_EMAIL_CHECKLIST.md)"
  printf 'PASS AW-904\n' >&2
  exit 0
fi

[ $# -eq 0 ] || { printf 'FAIL AW-604: unknown argument (only --live is accepted)\n' >&2; exit 2; }
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-604: bun is not available on PATH\n' >&2; exit 2; }

if bun test --isolate \
  src/lib/services/email-attachment-intake.test.ts \
  src/lib/services/email-sender-check.test.ts \
  src/lib/services/email-inbound-hostnames.test.ts \
  src/lib/services/email-alias-service.test.ts \
  src/app/api/webhooks/resend-inbound \
  src/app/api/v1/projexa/projects/from-document/route.email-job.test.ts; then
  printf 'PASS AW-604\n' >&2
  exit 0
fi
printf 'FAIL AW-604: a way-4 test failed (see above)\n' >&2
exit 1
