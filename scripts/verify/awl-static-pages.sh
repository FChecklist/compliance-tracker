#!/usr/bin/env bash
# register: BR-496
# PROJEXA-BUILD-001 phase 4 (U-46b2): the static inbox and confirm pages (decision OD-3: a static host that is not Vercel). Two pages,
# /ai-inbox.html and /ai-confirm.html, are fetched and must each:
#   answer 200,
#   carry no x-vercel-id header (they are not served by Vercel; AWL-H15 replaces an old check that was true by construction),
#   carry the typed confirm-code input, the literal text  id="confirm-code"  (AWL-H25; a confirm link that travelled by email needs a
#   typed 4-character code, audit A-15).
# A page that does not answer 200 counts for none of the three numbers, so a 404 page cannot pass by having no Vercel header.
#
# Live-only: the OD-3 host does not exist until the static pages are published. Read-only: two GETs.
# Environment: AWL_CONFIRM_HOST  the host name of the static pages (for example inbox.example.pages.dev; a host:port is accepted).
#              AWL_STATIC_SCHEME https or http, default https (http exists for the local self-test only).
#              AWL_CURL_TIMEOUT  seconds per request, default 30.
# Last stdout line: AWL_STATIC pages=<n> vercel_headers=<n> confirm_code=<n>     (expected: pages=2 vercel_headers=0 confirm_code=2)
# Exit 0 only when the line is exactly that. Exit 1 otherwise. Exit 2 when AWL_CONFIRM_HOST is missing.
# Self-test: bash scripts/verify/awl-scripts.selftest.sh
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib/awl-common.sh"

awl_need AWL_CONFIRM_HOST
awl_need_tool curl
SCHEME="${AWL_STATIC_SCHEME:-https}"
case "$SCHEME" in http|https) ;; *) awl_die2 "AWL_STATIC_SCHEME must be http or https" ;; esac
case "$AWL_CONFIRM_HOST" in */*|*" "*|*"#"*|*"?"*) awl_die2 "AWL_CONFIRM_HOST must be a host name only (no scheme, path or spaces)" ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pages=0
vercel=0
codes=0

# -L: Cloudflare Pages answers /x.html with a 308 to /x (clean URLs); the page that is served after that one hop is what a person's browser shows.
for page in ai-inbox.html ai-confirm.html; do
  url="$SCHEME://$AWL_CONFIRM_HOST/$page"
  code="$(awl_norm_code "$(curl -s -L --max-redirs 2 -D "$TMP/h" -o "$TMP/b" --max-time "$AWL_CURL_TIMEOUT" -w '%{http_code}' "$url" 2>/dev/null || true)")"
  if [ "$code" != "200" ]; then awl_say "FAIL $page answered $code (want 200)"; continue; fi
  pages=$((pages + 1))
  if tr -d '\r' < "$TMP/h" | grep -qi '^x-vercel-id:'; then vercel=$((vercel + 1)); awl_say "FAIL $page carries an x-vercel-id header (it is served by Vercel)"; fi
  if grep -q 'id="confirm-code"' "$TMP/b"; then codes=$((codes + 1)); else awl_say "FAIL $page has no id=\"confirm-code\" input"; fi
done

printf 'AWL_STATIC pages=%s vercel_headers=%s confirm_code=%s\n' "$pages" "$vercel" "$codes"
if [ "$pages" = "2" ] && [ "$vercel" = "0" ] && [ "$codes" = "2" ]; then exit 0; fi
exit 1
