#!/usr/bin/env bash
# register: BR-492
# PROJEXA-BUILD-001 phase 4 (U-46b2): the two throttles of the universal AI work link, measured on the real function
# (AWL-H09, H10 and H24 merged; spike S-3):
#   link_121st     121 calls in a row on one link, path /context: the 121st answers 429 (the limit is 120 a minute per link)
#   unknown_31st   31 calls in a row with a fresh, unknown pxa_ token each time: the 31st answers 429 (30 a minute per address)
#   rotated_31st   the same 31 unknown-token calls, each with a DIFFERENT X-Forwarded-For header: the 31st still answers 429, so a
#                  client cannot rotate its way past the throttle by writing that header itself
# A series only proves something if its bucket was clear when it started, so each series is also required to START clean:
#   link      calls 1 and 120 must not be 429 (else the link's minute was already used; wait a minute and run again)
#   unknown   call 1 must not be 429 (an earlier series or another caller filled the address bucket)
#   rotated   call 1 must not be 429 (the script waits AWL_RATE_WAIT seconds after the unknown series so the minute empties)
# A run that meets an already-full bucket exits 1 and says so; it is never counted as a pass.
#
# Live-only: it sends about 183 requests. Use a throwaway link and a quiet minute; the calls are reads and are counted in the call log.
# Environment: AWL_LINK  the pasted link of a throwaway link (path mode).
#              AWL_F     the function base URL, https://<host>/functions/v1/ai-work-link  (unknown tokens are sent to it).
#              AWL_RATE_WAIT  seconds to wait between the unknown and the rotated series, default 65 (the window is 60 s).
#              AWL_CURL_TIMEOUT  seconds per request, default 30.
# Last stdout line: AWL_RATE link_121st=<code> unknown_31st=<code> rotated_31st=<code>
# Exit 0 only when all three are 429 and every series started clean. Exit 1 otherwise. Exit 2 when a variable is missing.
# Self-test: bash scripts/verify/awl-scripts.selftest.sh
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib/awl-common.sh"

awl_need AWL_LINK AWL_F
awl_need_tool curl
LINK="$(awl_strip_slash "$AWL_LINK")"
F="$(awl_strip_slash "$AWL_F")"
WAIT="${AWL_RATE_WAIT:-65}"
case "$WAIT" in *[!0-9]*|"") awl_die2 "AWL_RATE_WAIT must be whole seconds" ;; esac

problems=""
note() { problems="$problems; $1"; awl_say "NOTE $1"; }

# every unknown token of both series, made up front from one read of the random source (so building the requests is fast)
mapfile -t TOKS < <(awl_rand_tokens 62 | tr -d '\r')
[ "${#TOKS[@]}" -eq 62 ] || awl_die2 "cannot make random tokens"

# link series: one curl process, 121 URLs, every body discarded, one status per line
args=()
for _ in $(seq 1 121); do args+=(-o /dev/null "$LINK/context"); done
mapfile -t L < <(curl -s --max-time "$AWL_CURL_TIMEOUT" -H 'Accept: application/json' -w '%{http_code}\n' "${args[@]}" 2>/dev/null | tr -d '\r')
link121="$(awl_norm_code "${L[120]:-}")"
if [ "${L[0]:-000}" = "429" ]; then note "the link's minute was already used before the series (call 1 was 429); wait a minute and run again"; fi
if [ "${L[119]:-000}" = "429" ]; then note "call 120 was already 429, so the limit was hit early and the 121st proves nothing; wait a minute and run again"; fi
if [ "${#L[@]}" -ne 121 ]; then note "only ${#L[@]} of 121 link calls were answered"; fi

# unknown-token series: one process, a fresh token per URL
args=()
for _i in $(seq 1 31); do args+=(-o /dev/null "$F/${TOKS[$((_i - 1))]}"); done
mapfile -t U < <(curl -s --max-time "$AWL_CURL_TIMEOUT" -w '%{http_code}\n' "${args[@]}" 2>/dev/null | tr -d '\r')
unk31="$(awl_norm_code "${U[30]:-}")"
if [ "${U[0]:-000}" = "429" ]; then note "the first unknown-token call was already 429; the address bucket was not clear (wait a minute and run again)"; fi
if [ "${#U[@]}" -ne 31 ]; then note "only ${#U[@]} of 31 unknown-token calls were answered"; fi

# let the minute empty, so the rotated series starts from a clear bucket
if [ "$WAIT" -gt 0 ]; then sleep "$WAIT"; fi

# rotated series: one process, a different X-Forwarded-For (and a fresh token) for every request. --next gives each request its own
# options inside the one curl process, which keeps 31 requests well inside one window even on a slow machine.
args=()
for i in $(seq 1 31); do
  [ "$i" -gt 1 ] && args+=(--next)
  args+=(-s --max-time "$AWL_CURL_TIMEOUT" -o /dev/null -w '%{http_code}\n' -H "X-Forwarded-For: 10.9.$i.7" "$F/${TOKS[$((30 + i))]}")
done
mapfile -t R < <(curl "${args[@]}" 2>/dev/null | tr -d '\r')
rot1="$(awl_norm_code "${R[0]:-}")"
rot31="$(awl_norm_code "${R[30]:-}")"
if [ "${#R[@]}" -ne 31 ]; then note "only ${#R[@]} of 31 rotated calls were answered"; fi
if [ "$rot1" = "429" ]; then note "the first rotated call was already 429; the bucket was not clear, so this series proves nothing (raise AWL_RATE_WAIT)"; fi

printf 'AWL_RATE link_121st=%s unknown_31st=%s rotated_31st=%s\n' "$link121" "$unk31" "$rot31"
if [ "$link121" = "429" ] && [ "$unk31" = "429" ] && [ "$rot31" = "429" ] && [ -z "$problems" ]; then exit 0; fi
exit 1
