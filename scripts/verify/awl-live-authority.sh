#!/usr/bin/env bash
# register: BR-498
# PROJEXA-BUILD-001 phase 4 (U-46b2): authority is checked on every call, not once at mint (AWL-H20 and H22 merged; audit A-03, A-08).
#   1. the throwaway link answers 200 on /context BEFORE anything is done to it (so a later 410 is caused by the revoke, not by a link
#      that was never live);
#   2. the owner revokes it through the app route  POST $AWL_F/links/<id>/revoke  with the owner's session (must answer 200);
#   3. the very next call on the link answers 410;
#   4. its row in platform.user_ai_links reads status = revoked (one read-only SELECT through scripts/verify/sql-assert.mjs);
#   5. a link whose person was DEMOTED after it was minted answers 403 to a level-1 write (POST /actions).
# THIS SCRIPT REVOKES A LINK. Use only a throwaway link made for this test. Step 5 sends one write request that must be REFUSED; it
# writes nothing when the demotion works, and it cannot be undone if the demotion does not work (a level-1 write would run), so use a
# link on a test project only. The minting of the throwaway link and the demotion of the test person are done by a person, in the app,
# before this script runs; the script checks the results, it does not create users or links.
# Until the deployment switches level-1 writes on, every link is level 0 and step 5 answers 403 for every link; then it cannot tell a
# demoted person from anyone else. Run it again after writes are enabled, with a person who really was demoted (README, section BR-498).
#
# Environment (values are never printed):
#   AWL_F             the function base URL, https://<host>/functions/v1/ai-work-link
#   AWL_OWNER_JWT     the owner's signed-in session token, for the revoke route only
#   AWL_LINK_T_ID     the id of the throwaway link (letters, digits, - and _ only)
#   AWL_LINK_T        the pasted link of that same throwaway link (path mode)
#   AWL_LINK_D        the pasted link of the person who was demoted after minting
#   VERIFY_DATABASE_URL (or VERIFY_SQL_MODE=mgmt with SUPABASE_ACCESS_TOKEN): a role that sees platform.user_ai_links rows; checked
#                     BEFORE the revoke so that a missing prerequisite never leaves a link revoked for nothing.
#   AWL_SQL_ASSERT    optional: another sql-assert.mjs to run (used by the local self-test).
#   AWL_CURL_TIMEOUT  seconds per request, default 30.
# Last stdout line: AWL_AUTHORITY revoked_next_call=<code> demoted_write=<code>   (expected: 410 and 403)
# Exit 0 only when: the pre-check was 200, the revoke was 200, the next call was 410, the row reads revoked and the write was 403.
# Exit 1 otherwise. Exit 2 when a variable or a prerequisite is missing (nothing was changed).
# Self-test: bash scripts/verify/awl-scripts.selftest.sh
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib/awl-common.sh"

awl_need AWL_F AWL_OWNER_JWT AWL_LINK_T_ID AWL_LINK_T AWL_LINK_D
awl_need_tool curl
awl_need_tool node
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_ASSERT="${AWL_SQL_ASSERT:-$ROOT/scripts/verify/sql-assert.mjs}"
[ -f "$SQL_ASSERT" ] || awl_die2 "sql-assert script not found"
if [ -z "${AWL_SQL_ASSERT:-}" ] && [ -z "${VERIFY_DATABASE_URL:-}" ] && [ "${VERIFY_SQL_MODE:-}" != "mgmt" ]; then
  awl_die2 "the row check needs VERIFY_DATABASE_URL (or VERIFY_SQL_MODE=mgmt); nothing was changed"
fi
case "$AWL_LINK_T_ID" in *[!A-Za-z0-9_-]*) awl_die2 "AWL_LINK_T_ID may hold letters, digits, - and _ only" ;; esac
F="$(awl_strip_slash "$AWL_F")"
LT="$(awl_strip_slash "$AWL_LINK_T")"
LD="$(awl_strip_slash "$AWL_LINK_D")"

problems=0
fail() { problems=$((problems + 1)); awl_say "FAIL $1"; }

pre="$(awl_norm_code "$(awl_code -H 'Accept: application/json' "$LT/context")")"
if [ "$pre" != "200" ]; then fail "the throwaway link answered $pre before the revoke (want 200); it was never live, so a 410 would prove nothing"; fi

rev="$(awl_norm_code "$(awl_code -X POST -H "Authorization: Bearer $AWL_OWNER_JWT" "$F/links/$AWL_LINK_T_ID/revoke")")"
if [ "$rev" != "200" ]; then fail "the revoke route answered $rev (want 200)"; fi

next="$(awl_norm_code "$(awl_code -H 'Accept: application/json' "$LT/context")")"
if [ "$next" != "410" ]; then fail "the next call on the revoked link answered $next (want 410)"; fi

if node "$SQL_ASSERT" --project ct --sql "select status from platform.user_ai_links where id = '$AWL_LINK_T_ID'" --equals revoked >/dev/null 2>&1; then
  awl_say "the link row reads revoked"
else
  fail "the link row does not read revoked (or the read failed)"
fi

dem="$(awl_norm_code "$(awl_code -X POST -H 'content-type: application/json' -d '{"function":"record_work_progress","params":{"itemCode":"EX-01","percent":10}}' "$LD/actions")")"
if [ "$dem" != "403" ]; then fail "a level-1 write on the demoted person's link answered $dem (want 403)"; fi

printf 'AWL_AUTHORITY revoked_next_call=%s demoted_write=%s\n' "$next" "$dem"
if [ "$problems" = "0" ]; then exit 0; fi
exit 1
