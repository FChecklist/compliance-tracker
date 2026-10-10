#!/usr/bin/env bash
# register: AW-511 (owner kit); BR-628 of the earlier plan
# PROJEXA-BUILD-002 WP-09b: the pre-flight of the OWNER's switch-on. It asks the DEPLOYED ai-work-link-exec function whether it is ready to run writes, and
# refuses to say so until the two owner-set settings are in place and the database connection really is the app_runtime role.
#
#   AWL_EXEC_INTERNAL_SECRET=<the shared secret you set> bash scripts/verify/awl-exec-preflight.sh
#
# Reads from the environment (never from an argument, so nothing is left in a process list or a shell history):
#   AWL_EXEC_INTERNAL_SECRET  the same value you set on the functions with `supabase secrets set` (required)
#   SUPABASE_URL              the project URL (default https://pcrjmlpuqsbocqfwoxod.supabase.co)
#   AWL_EXEC_URL              overrides the whole function address (the self-test points it at a local stub; leave it unset)
# The secret is handed to curl through its config on stdin. It is never printed. The script writes nothing and changes nothing: it makes ONE read, GET /health.
#
# Exit 0 = ready. stdout last line: AWL_EXEC_READY db_role=app_runtime
# Exit 1 = not ready; the last stderr line says why: FAIL AW-511: <reason>
#          NOT_CONFIGURED names the missing setting(s); 401 means the secret differs from the function's; DB_UNREACHABLE means APP_RUNTIME_DATABASE_URL is wrong;
#          db_role means the connection string is not the app_runtime role (the business writes must run as app_runtime under row-level security).
# Exit 2 = usage error (no secret, no curl).
set -u

fail() { printf 'FAIL AW-511: %s\n' "$1" >&2; exit 1; }
[ $# -eq 0 ] || { printf 'FAIL AW-511: this script takes no arguments\n' >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { printf 'FAIL AW-511: curl is not available on PATH\n' >&2; exit 2; }
[ -n "${AWL_EXEC_INTERNAL_SECRET:-}" ] || { printf 'FAIL AW-511: set AWL_EXEC_INTERNAL_SECRET in this shell first (the value you set on the functions)\n' >&2; exit 2; }

BASE="${SUPABASE_URL:-https://pcrjmlpuqsbocqfwoxod.supabase.co}"
URL="${AWL_EXEC_URL:-${BASE%/}/functions/v1/ai-work-link-exec/health}"

OUT="$(mktemp)" || exit 2
trap 'rm -f "$OUT"' EXIT
CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$AWL_EXEC_INTERNAL_SECRET" | curl -sS --max-time 30 -K - -o "$OUT" -w '%{http_code}' "$URL" 2>/dev/null)" || fail "the function did not answer (is it deployed?)"

BODY="$(cat "$OUT")"
field() { printf '%s' "$BODY" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -n 1; }

case "$CODE" in
  200)
    ROLE="$(field db_role)"
    case "$BODY" in *'"ok":true'*) ;; *) fail "the function answered 200 without ok:true" ;; esac
    [ "$ROLE" = "app_runtime" ] || fail "db_role is '${ROLE:-unknown}', not app_runtime: APP_RUNTIME_DATABASE_URL must be the app_runtime role's connection string"
    printf 'AWL_EXEC_READY db_role=%s\n' "$ROLE"
    exit 0
    ;;
  401) fail "401: AWL_EXEC_INTERNAL_SECRET here differs from the one set on the function" ;;
  503)
    case "$BODY" in
      *NOT_CONFIGURED*) fail "NOT_CONFIGURED: still missing $(printf '%s' "$BODY" | sed -n 's/.*"missing":\[\([^]]*\)\].*/\1/p' | tr -d '"')" ;;
      *DB_UNREACHABLE*) fail "DB_UNREACHABLE: the function has the setting but cannot reach the database with it" ;;
      *) fail "503 from the function" ;;
    esac
    ;;
  *) fail "the function answered HTTP $CODE" ;;
esac
