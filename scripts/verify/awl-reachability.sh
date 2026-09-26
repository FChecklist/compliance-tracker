#!/usr/bin/env bash
# register: BR-491
# PROJEXA-BUILD-001 phase 4 (U-46b2): can a plain AI reach the pasted link? Eight checks against ONE real link, the audit rows
# AWL-H04 to H08, H16, H17 and H19 merged:
#   H04  the pasted link is at most 250 characters (the Anthropic web fetch tool refuses longer URLs)
#   H05  the link does not redirect (no 3xx status and no redirect target)
#   H06  the link host has an IPv4 A record (a fetcher with no IPv6 must still reach it)
#   H07  robots.txt on the link host answers 404 (a robots file that blocks fetchers is the failure this rules out)
#   H08  a request with the ChatGPT fetcher user agent answers 200
#   H16  the manual is served as exactly `text/markdown; charset=utf-8`
#   H17  a CORS preflight (OPTIONS on /actions, with Origin and Access-Control-Request-Method) answers 204
#   H19  the paste card (/card.md) carries no `pxa_` text and is at most 8,000 bytes
# Live-only: it needs a deployed function and a minted link. Nothing in it writes data: GET, HEAD-style reads and one OPTIONS.
#
# Environment: AWL_LINK  the pasted link exactly as a person pastes it (https://<host>/functions/v1/ai-work-link/pxa_<64 hex>).
#              AWL_CURL_TIMEOUT  seconds per request, default 30.
# Output: one PASS or FAIL line per check (the link is printed masked), then the LAST line
#           AWL_REACH passed=<n> failed=<m>
# Exit 0 only when passed=8 and failed=0. Exit 1 when a check failed. Exit 2 when AWL_LINK is missing (nothing is checked).
# Self-test: bash scripts/verify/awl-scripts.selftest.sh (runs this script against a local stub, with each rule broken in turn).
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib/awl-common.sh"

awl_need AWL_LINK
awl_need_tool curl
awl_need_tool node

LINK="$(awl_strip_slash "$AWL_LINK")"
ORIGIN="$(awl_origin "$LINK")"
HOST="$(awl_hostpart "$LINK")"
passed=0
failed=0

ok()  { passed=$((passed + 1)); awl_say "PASS $1 $2"; }
bad() { failed=$((failed + 1)); awl_say "FAIL $1 $2: $3"; }

# H04
if [ "${#LINK}" -le 250 ]; then ok H04 "link is ${#LINK} characters (limit 250)"; else bad H04 "link is at most 250 characters" "${#LINK} characters"; fi

# H05
out="$(curl -s -o /dev/null --max-time "$AWL_CURL_TIMEOUT" -w '%{http_code} %{redirect_url}' "$LINK" 2>/dev/null || true)"
code="$(awl_norm_code "${out%% *}")"
target="${out#* }"; [ "$out" = "$code" ] && target=""
case "$code" in
  3??) bad H05 "the link does not redirect" "status $code" ;;
  000) bad H05 "the link does not redirect" "nothing answered" ;;
  *) if [ -n "$target" ]; then bad H05 "the link does not redirect" "redirect target present"; else ok H05 "no redirect (status $code)"; fi ;;
esac

# H06
if node -e "require('dns').lookup(process.argv[1],{family:4},(e,a)=>process.exit(e||!a?1:0))" "$HOST" >/dev/null 2>&1; then
  ok H06 "the host has an IPv4 address"
else
  bad H06 "the host has an IPv4 A record" "no IPv4 address for the host"
fi

# H07
code="$(awl_norm_code "$(awl_code "$ORIGIN/robots.txt")")"
if [ "$code" = "404" ]; then ok H07 "robots.txt answers 404"; else bad H07 "robots.txt answers 404" "status $code"; fi

# H08
code="$(awl_norm_code "$(awl_code -A 'ChatGPT-User/1.0' "$LINK")")"
if [ "$code" = "200" ]; then ok H08 "the ChatGPT user agent gets 200"; else bad H08 "the ChatGPT user agent gets 200" "status $code"; fi

# H16
ctype="$(curl -s -D - -o /dev/null --max-time "$AWL_CURL_TIMEOUT" "$LINK" 2>/dev/null | tr -d '\r' | grep -i '^content-type:' | head -n 1 | sed -E 's/^[^:]*:[ \t]*//' || true)"
if [ "$ctype" = "text/markdown; charset=utf-8" ]; then ok H16 "content type is exactly text/markdown; charset=utf-8"; else bad H16 "content type is exactly text/markdown; charset=utf-8" "got '${ctype:-none}'"; fi

# H17
code="$(awl_norm_code "$(awl_code -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' "$LINK/actions")")"
if [ "$code" = "204" ]; then ok H17 "the CORS preflight answers 204"; else bad H17 "the CORS preflight answers 204" "status $code"; fi

# H19
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
code="$(awl_norm_code "$(curl -s -o "$TMP/card.md" --max-time "$AWL_CURL_TIMEOUT" -w '%{http_code}' "$LINK/card.md" 2>/dev/null || true)")"
if [ "$code" != "200" ]; then
  bad H19 "the paste card is token-free and at most 8,000 bytes" "/card.md answered $code"
else
  size="$(wc -c < "$TMP/card.md" | tr -d ' ')"
  hits="$(grep -c 'pxa_' "$TMP/card.md" || true)"
  if [ "$hits" = "0" ] && [ "$size" -le 8000 ]; then ok H19 "the paste card is token-free ($size bytes)"; else bad H19 "the paste card is token-free and at most 8,000 bytes" "$size bytes, $hits line(s) with pxa_"; fi
fi

printf 'AWL_REACH passed=%s failed=%s\n' "$passed" "$failed"
if [ "$failed" = "0" ] && [ "$passed" = "8" ]; then exit 0; fi
exit 1
