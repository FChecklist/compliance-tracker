#!/usr/bin/env bash
# register: BR-499
# PROJEXA-BUILD-001 phase 4 (U-46b2): the biggest page the link can serve. One request for the BOQ lines of the LARGEST project
# (limit 200, the keyset maximum; JSON asked for explicitly because the default answer is Markdown) must answer 200, take under 2
# seconds and weigh under 1,000,000 bytes (AWL-H21, decision D-11). The body must also be a JSON object with an items list holding at
# least one row: a 200 with an empty page, or a body that is not the list, proves nothing about size.
#
# Live-only: it needs the deployed function and a link on the project with the most BOQ lines. Read-only: one GET.
# Environment: AWL_LINK_BIG  the pasted link of a user on the largest project (path mode).
#              AWL_CURL_TIMEOUT  seconds, default 30.
# Last stdout line: AWL_PAGE status=<code> under_2s=<yes|no> under_1mb=<yes|no>     (expected: status=200 under_2s=yes under_1mb=yes)
# Exit 0 only when the line is exactly that AND the page held rows. Exit 1 otherwise. Exit 2 when AWL_LINK_BIG is missing.
# Self-test: bash scripts/verify/awl-scripts.selftest.sh
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib/awl-common.sh"

awl_need AWL_LINK_BIG
awl_need_tool curl
awl_need_tool node
LINK="$(awl_strip_slash "$AWL_LINK_BIG")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

meta="$(curl -s -o "$TMP/page.json" --max-time "$AWL_CURL_TIMEOUT" -H 'Accept: application/json' -w '%{http_code} %{time_total} %{size_download}' "$LINK/records/boq_lines?limit=200" 2>/dev/null || true)"
code="$(awl_norm_code "${meta%% *}")"
rest="${meta#* }"; secs="${rest%% *}"; bytes="${rest#* }"
case "$secs" in ''|*[!0-9.]*) secs="999" ;; esac
case "$bytes" in ''|*[!0-9]*) bytes="999999999" ;; esac

fast=no; light=no
if awk -v s="$secs" 'BEGIN { exit !(s < 2.0) }'; then fast=yes; fi
if [ "$bytes" -lt 1000000 ]; then light=yes; fi

rows="$(node -e '
try { const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(Array.isArray(d.items) ? d.items.length : -1); } catch { console.log(-1); }
' "$TMP/page.json" 2>/dev/null)"
awl_say "page: $rows row(s), $bytes bytes, $secs s"

printf 'AWL_PAGE status=%s under_2s=%s under_1mb=%s\n' "$code" "$fast" "$light"
if [ "$code" = "200" ] && [ "$fast" = "yes" ] && [ "$light" = "yes" ] && [ "${rows:--1}" -ge 1 ]; then exit 0; fi
exit 1
