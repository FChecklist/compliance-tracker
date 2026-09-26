#!/usr/bin/env bash
# register: BR-492
# PROJEXA-BUILD-001 phase 4 (U-46b2): the two throttles of the universal AI work link, measured on the real function
# (AWL-H09, H10 and H24 merged; spike S-3):
#   link_121st     121 calls sent at once on one link, path /context: 120 answer 200 and the 121st answers 429 (the limit is 120 a minute per link)
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

# link series: ONE curl process sends all 121 requests in parallel (--parallel-max 25), so the whole series lands inside one 60-second window
# even when a single call takes seconds (a /context call runs several database calls; from a runner it took about 2.5 s, so 121 in a row took
# five minutes and the limit could never be reached). The status lines come back in completion order, so the series is judged by counts:
# with a clear bucket exactly 120 calls answer 200 and exactly 1 answers 429, which is what "the 121st answers 429" means.
args=()
for _ in $(seq 1 121); do args+=(-o /dev/null "$LINK/context"); done
mapfile -t L < <(curl -s --parallel --parallel-max 25 --max-time "$AWL_CURL_TIMEOUT" -H 'Accept: application/json' -w '%{http_code}\n' "${args[@]}" 2>/dev/null | tr -d '\r')
n200=0; n429=0
for c in "${L[@]}"; do case "$(awl_norm_code "$c")" in 200) n200=$((n200 + 1)) ;; 429) n429=$((n429 + 1)) ;; esac; done
if [ "${#L[@]}" -ne 121 ]; then note "only ${#L[@]} of 121 link calls were answered"; fi
if [ "$n200" -lt 120 ] && [ "$n429" -gt 1 ]; then note "only $n200 link calls answered 200 before the limit, so the link's minute was already used; wait a minute and run again"; fi
if [ "$n200" -eq 120 ] && [ "$n429" -eq 1 ]; then link121="429"; elif [ "$n429" -eq 0 ]; then link121="200"; else link121="$n429-429s"; fi

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
