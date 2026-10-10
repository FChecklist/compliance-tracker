# PROJEXA-BUILD-001 U-46b2: helpers shared by the scripts/verify/awl-*.sh scripts (the universal AI work link, live checks).
# Sourced, never run. Rules every script keeps:
#   * settings come from environment variables only; a missing one is exit 2 with the variable NAMES listed, never exit 0;
#   * a link or token is never printed: everything that prints goes through awl_mask, which turns pxa_<64 hex> into pxa_[masked];
#   * nothing is written to disk except a temporary directory that is removed on exit.
# Exit codes: 0 every check held, 1 a check failed, 2 usage error or a missing prerequisite.

awl_mask() { sed -E 's/pxa_[0-9a-fA-F]{64}/pxa_[masked]/g'; }

awl_say() { printf '%s\n' "$*" | awl_mask; }

awl_die2() {
  printf '%s\n' "$*" | awl_mask >&2
  exit 2
}

# awl_need NAME...: every named environment variable must be set and non-empty (the values are never printed).
awl_need() {
  local missing="" name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then missing="$missing $name"; fi
  done
  if [ -n "$missing" ]; then
    awl_die2 "missing environment variable(s):$missing (see scripts/verify/awl-README.md). Nothing was checked."
  fi
}

awl_need_tool() {
  command -v "$1" >/dev/null 2>&1 || awl_die2 "the tool '$1' is not on PATH (needed by $(basename "$0"))"
}

AWL_CURL_TIMEOUT="${AWL_CURL_TIMEOUT:-30}"

# awl_code [curl args...] URL: the HTTP status only ("000" when nothing answered). Never follows a redirect.
awl_code() {
  curl -s -o /dev/null --max-time "$AWL_CURL_TIMEOUT" -w '%{http_code}' "$@" 2>/dev/null || true
}

# awl_stat_line: the three-digit code only, "000" when curl printed nothing.
awl_norm_code() {
  case "$1" in [0-9][0-9][0-9]) printf '%s' "$1" ;; *) printf '000' ;; esac
}

# awl_origin URL: scheme://host[:port] of a URL.
awl_origin() { printf '%s' "$1" | sed -E 's#^([a-zA-Z][a-zA-Z0-9+.-]*://[^/?\#]+).*#\1#'; }

# awl_hostpart URL: host (no port) of a URL.
awl_hostpart() { printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#[/?\#].*$##; s#:[0-9]+$##; s#^\[(.*)\]$#\1#'; }

# awl_rand_token: a fresh, valid-shaped, unknown token (pxa_ and 64 hex characters).
awl_rand_token() {
  local hex
  hex="$(od -An -N32 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
  if [ "${#hex}" -ne 64 ]; then
    hex="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null)"
  fi
  [ "${#hex}" -eq 64 ] || awl_die2 "cannot make random bytes (no /dev/urandom and no node)"
  printf 'pxa_%s' "$hex"
}

# awl_strip_slash URL: the URL without one trailing slash.
awl_strip_slash() { local u="$1"; printf '%s' "${u%/}"; }

# awl_rand_tokens N: N fresh unknown tokens, one per line, from ONE read of the random source (fast: no process per token).
awl_rand_tokens() {
  local n="$1" out
  out="$(od -An -v -N$((32 * n)) -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | fold -w 64 | sed 's/^/pxa_/')"
  if [ "$(printf '%s\n' "$out" | grep -Ec '^pxa_[0-9a-f]{64}$')" -ne "$n" ]; then
    out="$(node -e "const c=require('crypto');for(let i=0;i<+process.argv[1];i++)console.log('pxa_'+c.randomBytes(32).toString('hex'))" "$n" 2>/dev/null)"
  fi
  printf '%s\n' "$out"
}
