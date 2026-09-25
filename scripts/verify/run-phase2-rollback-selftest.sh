#!/usr/bin/env bash
# Self-test for the PROJEXA-BUILD-001 phase 2 rollback tooling (U-17): rollback-rehearsals.sh (BR-206), rollback-replay.sh
# (BR-207), the rehearsal DO-block generator (rollback-tools.mjs do-block), vercel-invocations.sh (BR-205, BR-225), and the
# line counts BR-204 and BR-205 take from schema-hash.sql and the three scripts.
#
# Positive cases run on the committed files (empty migration list) and on toy migrations written to a temporary folder. A
# positive passes only when the script exits 0 and its last stdout line is exactly the line the register row states.
# Negative cases break one thing each (a missing down file, a log row whose h2 differs from h0, a forward file edited after
# its rehearsal, a listed migration with no row, a down file that does not restore, a down file that forgets a REVOKE, ...).
# A negative passes only when the script exits with the stated non-zero code (1 = the check failed, 2 = no data or usage)
# and, where stated, prints the stated last line.
#
# Exit 0 and a final line `PASS run-phase2-rollback-selftest ...` only when every positive passed and every negative failed
# as required. Exit 1 and `FAIL run-phase2-rollback-selftest ...` otherwise. Exit 2 when node or python is missing.
#
# Nothing here reads or writes a database, Vercel or GitHub: the replay cases run in in-memory PGlite (the repo's
# @electric-sql/pglite), and vercel-invocations.sh runs against a stub CLI that prints saved JSON. The rehearsal log rows of
# the positive cases carry the h0/h1/h2 that the PGlite replay's own DO-block run printed for the same toy migration.
# Runtime: about 30 to 60 seconds (seven PGlite runs of 2 to 4 seconds each, the rest is bash and python).
#
# Usage: bash scripts/verify/run-phase2-rollback-selftest.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
V="$ROOT/scripts/verify"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
command -v node >/dev/null 2>&1 || { echo "FAIL run-phase2-rollback-selftest: node is not available" >&2; exit 2; }
PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "FAIL run-phase2-rollback-selftest: python is not available" >&2; exit 2; }

T_START="$(date +%s)"
WORK="$(winpath "$(mktemp -d)")"
trap 'rm -rf "$WORK"' EXIT

N_POS=0; N_NEG=0; N_BAD=0
report_ok()  { printf 'ok   %s\n' "$1"; }
report_bad() { printf 'BAD  %s\n' "$1"; N_BAD=$((N_BAD + 1)); }
last_line()  { printf '%s\n' "$1" | tail -n 1; }

# expect_pos <label> <exact last stdout line> <command...>
expect_pos() {
  local label="$1" want="$2" out rc
  shift 2
  out="$("$@" 2>"$WORK/last.err")"; rc=$?
  N_POS=$((N_POS + 1))
  if [ $rc -eq 0 ] && [ "$(last_line "$out")" = "$want" ]; then report_ok "POS $label"
  else report_bad "POS $label: exit=$rc last='$(last_line "$out")' stderr='$(tail -n 2 "$WORK/last.err" | tr '\n' ' ')'"; fi
}

# expect_neg <label> <exit code> <exact last stdout line, or - for any> <command...>
expect_neg() {
  local label="$1" want="$2" line="$3" out rc
  shift 3
  out="$("$@" 2>"$WORK/last.err")"; rc=$?
  N_NEG=$((N_NEG + 1))
  if [ $rc -eq "$want" ] && { [ "$line" = "-" ] || [ "$(last_line "$out")" = "$line" ]; }; then report_ok "NEG $label (exit $rc)"
  else report_bad "NEG $label: wanted exit $want and '$line', got exit=$rc last='$(last_line "$out")' stderr='$(tail -n 2 "$WORK/last.err" | tr '\n' ' ')'"; fi
}

# expect_check <label> <command...>: a plain assertion inside the harness
expect_check() {
  local label="$1"
  shift
  N_POS=$((N_POS + 1))
  if "$@"; then report_ok "POS $label"; else report_bad "POS $label"; fi
}

sha256() { "$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }

# ---------------------------------------------------------------- toy migrations
# mk_case <dir> <name> <forward sql> <down sql> [nobase]: drizzle/<name>.sql, drizzle/down/<name>.down.sql,
# fixtures/<name>.base.sql, list.txt naming <name>, and log.md with an empty '## Log' table.
BASE_SQL='CREATE SCHEMA IF NOT EXISTS toy;
CREATE TABLE toy.items (id text PRIMARY KEY, name text NOT NULL);
ALTER TABLE toy.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_runtime_read ON toy.items FOR SELECT TO app_runtime USING (true);
GRANT SELECT ON toy.items TO app_runtime;'
mk_case() {
  local d="$1" name="$2"
  rm -rf "$d"
  mkdir -p "$d/drizzle/down" "$d/fixtures"
  printf 'BEGIN;\n%s\nCOMMIT;\n' "$3" > "$d/drizzle/$name.sql"
  printf 'BEGIN;\n%s\nCOMMIT;\n' "$4" > "$d/drizzle/down/$name.down.sql"
  [ "${5:-}" = "nobase" ] || printf '%s\n' "$BASE_SQL" > "$d/fixtures/$name.base.sql"
  printf '# toy list\n%s  # a trailing comment\n' "$name" > "$d/list.txt"
  printf '# toy log\n\n## Log\n\n| migration | result | hashes | forward | time_utc | who |\n|---|---|---|---|---|---|\n' > "$d/log.md"
}
case_env() {
  printf '%s\n' "PHASE2_MIGRATIONS_FILE=$1/list.txt" "ROLLBACK_REHEARSALS_FILE=$1/log.md" "DRIZZLE_DIR=$1/drizzle" "ROLLBACK_FIXTURES_DIR=$1/fixtures"
}
run_in() { local d="$1"; shift; env $(case_env "$d") "$@"; }

FWD_NOTE='ALTER TABLE toy.items ADD COLUMN note text;
CREATE INDEX toy_items_note_idx ON toy.items (note);'
DOWN_NOTE='DROP INDEX IF EXISTS toy.toy_items_note_idx;
ALTER TABLE toy.items DROP COLUMN IF EXISTS note;'
C="$WORK/cases"
mkdir -p "$C"

echo "== BR-204 and BR-205 line counts"
expect_check "schema-hash.sql names role_table_grants on exactly 1 line" test "$(grep -c 'role_table_grants' "$V/schema-hash.sql")" = "1"
expect_check "the three phase 2 scripts carry 3 '# register: BR-2nn' lines" test "$(cat "$V/rollback-rehearsals.sh" "$V/rollback-replay.sh" "$V/vercel-invocations.sh" | grep -c -E '^# register: BR-2[0-9]{2}$')" = "3"

echo "== BR-207 rollback-replay.sh (PGlite)"
expect_pos "committed files: empty list" "SCHEMA_HASH_MISMATCH=0" bash "$V/rollback-replay.sh"
mk_case "$C/note" 9001_toy_note "$FWD_NOTE" "$DOWN_NOTE"
NOTE_OUT="$(run_in "$C/note" bash "$V/rollback-replay.sh" 2>"$WORK/note.err")"; NOTE_RC=$?
N_POS=$((N_POS + 1))
if [ $NOTE_RC -eq 0 ] && [ "$(last_line "$NOTE_OUT")" = "SCHEMA_HASH_MISMATCH=0" ]; then report_ok "POS toy pair (column, index) restores, DO block PASS_ROLLED_BACK"
else report_bad "POS toy pair restores: exit=$NOTE_RC out='$NOTE_OUT' stderr='$(tail -n 2 "$WORK/note.err" | tr '\n' ' ')'"; fi
mk_case "$C/grant" 9002_toy_grant 'GRANT SELECT ON toy.items TO anon;' 'REVOKE SELECT ON toy.items FROM anon;'
expect_pos "grant/revoke pair restores" "SCHEMA_HASH_MISMATCH=0" run_in "$C/grant" bash "$V/rollback-replay.sh"
mk_case "$C/norevoke" 9003_toy_norevoke 'GRANT SELECT ON toy.items TO anon;' 'SELECT 1;'
expect_neg "down forgets the REVOKE (only the grants section sees it)" 1 "SCHEMA_HASH_MISMATCH=1" run_in "$C/norevoke" bash "$V/rollback-replay.sh"
mk_case "$C/leftidx" 9004_toy_leftidx 'ALTER TABLE toy.items ADD COLUMN note text;
CREATE INDEX toy_items_name_idx ON toy.items (name);' 'ALTER TABLE toy.items DROP COLUMN IF EXISTS note;'
expect_neg "down does not restore (index left behind)" 1 "SCHEMA_HASH_MISMATCH=1" run_in "$C/leftidx" bash "$V/rollback-replay.sh"
mk_case "$C/noop" 9005_toy_noop 'SELECT 1;' 'SELECT 1;'
expect_neg "forward changes nothing" 1 "SCHEMA_HASH_MISMATCH=1" run_in "$C/noop" bash "$V/rollback-replay.sh"
mk_case "$C/badfwd" 9006_toy_badfwd 'ALTER TABLE toy.missing ADD COLUMN x int;' 'SELECT 1;'
expect_neg "forward fails to apply" 1 "SCHEMA_HASH_MISMATCH=1" run_in "$C/badfwd" bash "$V/rollback-replay.sh"
mk_case "$C/nobase" 9007_toy_nobase "$FWD_NOTE" "$DOWN_NOTE" nobase
expect_neg "base snapshot missing" 1 "SCHEMA_HASH_MISMATCH=1" run_in "$C/nobase" bash "$V/rollback-replay.sh"
mk_case "$C/midcommit" 9008_toy_midcommit 'ALTER TABLE toy.items ADD COLUMN a int;
COMMIT;
ALTER TABLE toy.items ADD COLUMN b int;' 'ALTER TABLE toy.items DROP COLUMN IF EXISTS a;
ALTER TABLE toy.items DROP COLUMN IF EXISTS b;'
expect_neg "forward holds a COMMIT mid-file (the live block cannot abort it)" 1 "SCHEMA_HASH_MISMATCH=1" run_in "$C/midcommit" bash "$V/rollback-replay.sh"
mk_case "$C/twoline" 9001_toy_note "$FWD_NOTE" "$DOWN_NOTE"
printf '9001_toy_note\n9001_toy_note\n' > "$C/twoline/list.txt"
expect_neg "a name listed twice" 2 - run_in "$C/twoline" bash "$V/rollback-replay.sh"

echo "== rehearsal DO-block generator"
BLOCK="$(run_in "$C/note" node "$(winpath "$V/rollback-tools.mjs")" do-block 9001_toy_note 2>"$WORK/block.err")"; BRC=$?
expect_check "do-block prints a block for the toy pair" test $BRC -eq 0 -a "$(printf '%s\n' "$BLOCK" | head -n 1)" = 'do $rehearsal$'
expect_check "do-block prints the forward file's sha256" grep -q "forward_sha256=$(sha256 "$C/note/drizzle/9001_toy_note.sql")" "$WORK/block.err"
expect_neg "do-block refuses a mid-file COMMIT" 2 - run_in "$C/midcommit" node "$(winpath "$V/rollback-tools.mjs")" do-block 9008_toy_midcommit

echo "== BR-206 rollback-rehearsals.sh"
# h0/h1/h2 of the positive rows: the values the PGlite replay's own DO-block run printed for 9001_toy_note above
HASHES="$(printf '%s\n' "$NOTE_OUT" | sed -n 's/.* restored \(h0=[0-9a-f]\{32\} h1=[0-9a-f]\{32\} h2=[0-9a-f]\{32\}\).*/\1/p' | head -n 1)"
if [ -z "$HASHES" ]; then
  report_bad "could not read h0/h1/h2 from the replay output; the rehearsal cases use fixed values"
  HASHES="h0=11111111111111111111111111111111 h1=22222222222222222222222222222222 h2=11111111111111111111111111111111"
fi
H0="$(printf '%s' "$HASHES" | sed 's/^h0=\([0-9a-f]*\).*/\1/')"
H1="$(printf '%s' "$HASHES" | sed 's/.* h1=\([0-9a-f]*\).*/\1/')"
OTHER="0123456789abcdef0123456789abcdef"
R="$WORK/reh"
mk_reh() {  # mk_reh <dir> [<log rows...>]: toy pair 9001_toy_note plus the given rows under '## Log'
  local d="$1"
  shift
  mk_case "$d" 9001_toy_note "$FWD_NOTE" "$DOWN_NOTE"
  local row
  for row in "$@"; do printf '%s\n' "$row" >> "$d/log.md"; done
}
SHA="$(sha256 "$C/note/drizzle/9001_toy_note.sql")"
row() { printf '| 9001_toy_note | %s | h0=%s h1=%s h2=%s | forward_sha256=%s | 2026-09-25T10:00:00Z | selftest |' "$1" "$2" "$3" "$4" "$5"; }
GOOD="$(row PASS_ROLLED_BACK "$H0" "$H1" "$H0" "$SHA")"

expect_pos "committed files: empty list, real log" "REHEARSAL_MISSING=0" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/ok" "$GOOD"
expect_pos "toy pair with a valid row (hashes from the PGlite DO block)" "REHEARSAL_MISSING=0" run_in "$R/ok" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/newer" "$(row PASS_ROLLED_BACK "$H0" "$H1" "$OTHER" "$SHA")" "$GOOD"
expect_pos "a valid row after an older bad row (last row decides)" "REHEARSAL_MISSING=0" run_in "$R/newer" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/nodown" "$GOOD"; rm "$R/nodown/drizzle/down/9001_toy_note.down.sql"
expect_neg "down file missing" 1 "REHEARSAL_MISSING=1" run_in "$R/nodown" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/nofwd" "$GOOD"; rm "$R/nofwd/drizzle/9001_toy_note.sql"
expect_neg "forward file missing" 1 "REHEARSAL_MISSING=1" run_in "$R/nofwd" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/h2" "$(row PASS_ROLLED_BACK "$H0" "$H1" "$OTHER" "$SHA")"
expect_neg "row with h2 not equal to h0" 1 "REHEARSAL_MISSING=1" run_in "$R/h2" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/h1" "$(row PASS_ROLLED_BACK "$H0" "$H0" "$H0" "$SHA")"
expect_neg "row with h1 equal to h0" 1 "REHEARSAL_MISSING=1" run_in "$R/h1" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/edited" "$GOOD"; printf -- '-- edited after the rehearsal\n' >> "$R/edited/drizzle/9001_toy_note.sql"
expect_neg "forward file changed after its rehearsal (sha256 differs)" 1 "REHEARSAL_MISSING=1" run_in "$R/edited" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/norow"
expect_neg "listed migration with no log row" 1 "REHEARSAL_MISSING=1" run_in "$R/norow" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/result" "$(row FAIL_ROLLED_BACK "$H0" "$H1" "$H0" "$SHA")"
expect_neg "row whose result is not PASS_ROLLED_BACK" 1 "REHEARSAL_MISSING=1" run_in "$R/result" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/shape" "$(printf '%s' "$GOOD" | sed 's/ | selftest |/ |  |/')"
expect_neg "row with an empty who cell" 1 "REHEARSAL_MISSING=1" run_in "$R/shape" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/older" "$GOOD" "$(row PASS_ROLLED_BACK "$H0" "$H1" "$OTHER" "$SHA")"
expect_neg "an older valid row, then a newer bad row" 1 "REHEARSAL_MISSING=1" run_in "$R/older" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/outside" "$GOOD"
"$PY" - "$R/outside/log.md" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
row = [l for l in t.split("\n") if l.startswith("| 9001_toy_note ")][0]
t = t.replace(row + "\n", "")
t = t.replace("## Log\n", "## Notes\n\n" + row + "\n\n## Log\n")
open(p, "w", encoding="utf-8", newline="\n").write(t)
PYEOF
expect_neg "valid row placed above the '## Log' heading" 1 "REHEARSAL_MISSING=1" run_in "$R/outside" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/nolist" "$GOOD"; rm "$R/nolist/list.txt"
expect_neg "migration list missing" 2 - run_in "$R/nolist" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/nohead" "$GOOD"; sed -i 's/^## Log$/## Journal/' "$R/nohead/log.md"
expect_neg "log without a '## Log' heading" 2 - run_in "$R/nohead" bash "$V/rollback-rehearsals.sh"
mk_reh "$R/dotsql" "$GOOD"; printf '9001_toy_note.sql\n' > "$R/dotsql/list.txt"
expect_neg "list names a file with .sql" 2 - run_in "$R/dotsql" bash "$V/rollback-rehearsals.sh"

echo "== BR-225 vercel-invocations.sh (stub CLI)"
cat > "$WORK/stub-vercel" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_LOG:-/dev/null}"
[ "${STUB_FAIL:-}" = "$1" ] && exit 1
case "$1" in
  usage) cat "$STUB_USAGE_JSON"; exit 0 ;;
  logs)  cat "$STUB_LOGS_JSONL"; exit 0 ;;
esac
exit 9
EOF
chmod +x "$WORK/stub-vercel" 2>/dev/null
cat > "$WORK/fx.py" <<'PYEOF'
import datetime
import json
import sys


def usage(out, start, end, project, cost, present):
    services = [{"name": "Function Invocations", "pricingQuantity": cost, "pricingUnit": "USD", "effectiveCost": cost, "billedCost": cost},
                {"name": "Build CPU Minutes", "pricingQuantity": 0.5, "pricingUnit": "USD", "effectiveCost": 0.5, "billedCost": 0.5}]
    data = [{"name": "(unattributed)", "services": [{"name": "Pro", "pricingQuantity": 4.5, "billedCost": 4.5}]}]
    if present:
        data.append({"name": project, "services": services})
    doc = {"period": {"from": start, "to": end}, "context": "veridian-ai-os", "pricingUnit": "USD",
           "groupBy": {"dimension": "project", "data": data}, "services": [], "chargeCount": 3}
    open(out, "w", encoding="utf-8", newline="\n").write(json.dumps(doc))


def logs(out, rows):
    lines = []
    for spec in rows:
        when, path, source = spec.split(",")
        t = datetime.datetime.strptime(when, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        lines.append(json.dumps({"id": "x", "timestamp": str(int(t.timestamp() * 1000)), "deploymentId": "dpl_x", "projectId": "prj_x",
                                 "level": "info", "message": "", "source": source, "domain": "example.vercel.app",
                                 "requestMethod": "GET", "requestPath": path, "responseStatusCode": "200", "environment": "production",
                                 "branch": "main", "cache": "MISS", "traceId": "t", "logs": []}))
    open(out, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + ("\n" if lines else ""))


if sys.argv[1] == "usage":
    usage(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), sys.argv[7] == "yes")
else:
    logs(sys.argv[2], sys.argv[3:])
PYEOF
FX="$(winpath "$WORK/fx.py")"
VI_ROUTE="/api/internal/exchange-rate-refresh/run"
"$PY" "$FX" usage "$WORK/u_ok.json" 2026-09-18T07:00:00.000Z 2026-09-25T07:00:00.000Z veridian-compliance-ai 0.000798 yes
"$PY" "$FX" usage "$WORK/u_absent.json" 2026-09-18T07:00:00.000Z 2026-09-25T07:00:00.000Z veridian-compliance-ai 0.000798 no
"$PY" "$FX" usage "$WORK/u_zero.json" 2026-09-18T07:00:00.000Z 2026-09-25T07:00:00.000Z veridian-compliance-ai 0 yes
"$PY" "$FX" usage "$WORK/u_shift.json" 2026-09-19T07:00:00.000Z 2026-09-26T07:00:00.000Z veridian-compliance-ai 0.000798 yes
"$PY" "$FX" logs "$WORK/l_clean.jsonl" 2026-09-18T09:00:00Z,/api/v1/projexa/attendance,serverless 2026-09-20T10:00:00Z,/api/internal/crr-catchup-worker/run,serverless 2026-09-21T10:00:00Z,$VI_ROUTE,static
"$PY" "$FX" logs "$WORK/l_hits.jsonl" 2026-09-18T09:00:00Z,/api/v1/projexa/attendance,serverless 2026-09-20T10:00:00Z,$VI_ROUTE,serverless "2026-09-21T10:00:00Z,$VI_ROUTE?force=1,serverless-middleware"
"$PY" "$FX" logs "$WORK/l_late.jsonl" 2026-09-20T09:00:00Z,/api/v1/projexa/attendance,serverless 2026-09-21T10:00:00Z,/api/v1/x,serverless
"$PY" "$FX" logs "$WORK/l_empty.jsonl"
VI=(env VERCEL_BIN="$WORK/stub-vercel" STUB_LOG="$WORK/vercel.log")
: > "$WORK/vercel.log"
expect_pos "project ran functions, logs reach day 1, no entry for the route (a static one does not count)" "INVOCATIONS=0" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_check "two CLI calls: usage then logs, --no-branch, no mutating verb" bash -c "[ \"\$(wc -l < '$WORK/vercel.log' | tr -d ' ')\" = 2 ] && head -n 1 '$WORK/vercel.log' | grep -q '^usage .*--group-by project --format json' && tail -n 1 '$WORK/vercel.log' | grep -q '^logs .*--no-branch --since 2026-09-18T07:00:00Z --until 2026-09-25T07:00:00Z --json' && ! grep -Eqi 'deploy|promote|rollback|redeploy|pause|env |remove|rm ' '$WORK/vercel.log'"
expect_neg "two entries for the route (one with a query string, one middleware)" 1 "INVOCATIONS=2" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_hits.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "a wildcard pattern matches the route" 1 "INVOCATIONS=2" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_hits.jsonl" bash "$V/vercel-invocations.sh" "/api/internal/*/run" 7 --end-day 2026-09-24
expect_neg "no usage row for the project (locked)" 2 "INVOCATIONS=unknown" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_absent.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "zero Function Invocations for the project (locked)" 2 "INVOCATIONS=unknown" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_zero.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "request logs start after the first billing day" 2 "INVOCATIONS=unknown" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_late.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "request logs empty while billing shows invocations" 2 "INVOCATIONS=unknown" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_empty.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "log read reached the limit" 2 "INVOCATIONS=unknown" "${VI[@]}" VERCEL_LOG_LIMIT=3 STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "usage response for another window" 2 "INVOCATIONS=unknown" "${VI[@]}" STUB_USAGE_JSON="$WORK/u_shift.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "vercel usage fails" 2 - "${VI[@]}" STUB_FAIL=usage STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "vercel logs fails" 2 "INVOCATIONS=unknown" "${VI[@]}" STUB_FAIL=logs STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2026-09-24
expect_neg "0 days" 2 - "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 0 --end-day 2026-09-24
expect_neg "pattern without a leading /" 2 - "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "api/internal/x" 7 --end-day 2026-09-24
expect_neg "end day not complete" 2 - "${VI[@]}" STUB_USAGE_JSON="$WORK/u_ok.json" STUB_LOGS_JSONL="$WORK/l_clean.jsonl" bash "$V/vercel-invocations.sh" "$VI_ROUTE" 7 --end-day 2099-01-01

echo "----"
ELAPSED=$(( $(date +%s) - T_START ))
if [ "$N_BAD" -eq 0 ]; then
  echo "PASS run-phase2-rollback-selftest: $N_POS positive cases passed, $N_NEG negative cases failed as required (${ELAPSED}s)"
  exit 0
fi
echo "FAIL run-phase2-rollback-selftest: $N_BAD of $((N_POS + N_NEG)) cases behaved wrongly (${ELAPSED}s)"
exit 1
