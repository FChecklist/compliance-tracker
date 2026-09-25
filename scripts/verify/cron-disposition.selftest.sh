#!/usr/bin/env bash
# register: BR-519
#
# Self-test for scripts/verify/cron-disposition.sh (PROJEXA-BUILD-001, item U-41). A disposition check that says
# `undisposed=0` only means something if it is known to say `undisposed>0` when a defect is planted. This builds throwaway copies of
# vercel.json, the runner workflow, the placement file, the workflow folder names, the projexa files and the cron.job list in a
# temp directory, plants each defect kind in a copy, and checks the script's exit code, its last stdout line and what it names.
#
# It starts from the real files of this checkout (vercel.json, .github/workflows/cost001-cron-runner.yml,
# ai-os/projexa-build-001/CRON_PLACEMENT.csv), so the first case also proves the committed files pass. The cron.job list, the
# projexa files and the workflow names are fixtures (no network, no database).
#
# Cases: the baseline; each defect kind (a KILL cron left in vercel.json, a route missing from the runner options, a route missing
# from the runner schedule mapping, the VERCEL row absent, the VERCEL route swapped for another, a moved cron still declared, an
# every-N schedule, a declared cron with no row, a projexa cron, a second or a projexa VERCEL cron with its own row and a count of zero
# with every row disposed: the three cases where only the count of exactly one fails the run); each live check (a PG_CRON job, the Edge Function job and a DPDP
# job absent from cron.job, an empty list); the name-source check; unknown job names; the workflow rows (projexa KILL file present,
# projexa file absent, compliance-tracker file absent); row shapes and enum values; --local (skips only the live checks, leaves
# every other check in force, reads no cron.job); a failing cron.job read (exit 2; an exit-4 read is tried three times, an exit-3
# read once, and a first read that times out then passes); the comma-list parsing of a real read; the mode the read runs in; the
# read-only guard on the SQL the script sends; usage and missing-file errors; and the overrides suffix.
#
# No real secret is written anywhere and no network call is made.
#
# Exit 0 prints, as the last line:  SELFTEST PASS: <n> cases
# Exit 1 prints, as the last line:  SELFTEST FAIL: <k> of <n> cases failed
# Env DISPOSITION_SCRIPT points the test at a different copy of the script (used to prove this test can fail: plant a defect in a
# copy and the self-test must go red).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DISP="${DISPOSITION_SCRIPT:-$HERE/cron-disposition.sh}"
[ -f "$DISP" ] || { echo "SELFTEST FAIL: script not found: $DISP" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "SELFTEST FAIL: python is not available" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "SELFTEST FAIL: node is not available (the cron.job read stub needs it)" >&2; exit 2; }
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

T="$(mktemp -d)" || { echo "SELFTEST FAIL: no temp directory" >&2; exit 2; }
trap 'rm -rf "$T"' EXIT

NCASE=0
NFAIL=0

# ------------------------------------------------------------------- mutation helpers
# A route is passed without its leading slash: Git Bash turns an argument that starts with / into a Windows path when it starts python.
cat > "$T/jsonmut.py" <<'PYEOF'
import json
import sys

src, dst, op = sys.argv[1:4]
d = json.load(open(src, encoding="utf-8-sig"))
crons = d.get("crons", [])
if op == "empty":
    d["crons"] = []
elif op == "add":
    crons.append({"path": "/" + sys.argv[4], "schedule": sys.argv[5]})
    d["crons"] = crons
elif op == "replace":
    d["crons"] = [{"path": "/" + sys.argv[4], "schedule": sys.argv[5]}]
elif op == "schedule":
    for c in crons:
        if c["path"] == "/" + sys.argv[4]:
            c["schedule"] = sys.argv[5]
else:
    raise SystemExit("unknown op " + op)
json.dump(d, open(dst, "w", encoding="utf-8"), indent=2)
PYEOF

cat > "$T/csvmut.py" <<'PYEOF'
import csv
import io
import sys

src, dst, op = sys.argv[1:4]
rows = list(csv.reader(io.StringIO(open(src, encoding="utf-8").read())))
hdr = rows[0]


def row(repo, name, cls):
    r = [""] * len(hdr)
    r[hdr.index("repo")] = repo
    r[hdr.index("path_or_name")] = name
    r[hdr.index("classification")] = cls
    return r


if op == "bad_class":
    rows[1][hdr.index("classification")] = "MOVE"
elif op == "unknown_kind":
    rows.append(row("compliance-tracker", "some other thing", "KILL"))
elif op == "fake_pg":
    rows.append(row("compliance-tracker", "formerly vercel.json cron /api/internal/no-such-job/run (planted)", "PG_CRON"))
elif op == "edge_unknown":
    rows.append(row("compliance-tracker", "formerly vercel.json cron /api/internal/some-edge/run (planted)", "EDGE_FN_VIA_PG_CRON"))
elif op == "short_row":
    rows.append(["compliance-tracker", "x"])
elif op == "kill_wf_present":
    rows.append(row("compliance-tracker", ".github/workflows/codeql.yml schedule", "KILL"))
elif op == "kill_job_active":
    rows.append(row("compliance-tracker", "pg_cron job 9 dpdp-legal-clocks", "KILL"))
elif op == "vercel_wf":
    rows.append(row("compliance-tracker", ".github/workflows/codeql.yml schedule", "VERCEL"))
elif op == "second_vercel_ct":
    rows.append(row("compliance-tracker", "vercel.json cron /api/internal/second-vercel/run", "VERCEL"))
elif op == "second_vercel_px":
    rows.append(row("projexa", "vercel.json cron /api/internal/px-second-vercel/run", "VERCEL"))
elif op == "vercel_to_kill":
    for r in rows[1:]:
        if r[hdr.index("path_or_name")] == "vercel.json cron /api/internal/secrets-audit/run":
            r[hdr.index("classification")] = "KILL"
else:
    raise SystemExit("unknown op " + op)
csv.writer(open(dst, "w", newline="", encoding="utf-8"), lineterminator="\n").writerows(rows)
PYEOF

# ------------------------------------------------------------------- baseline fixtures
B="$T/base"
mkdir -p "$B/wf"
cp "$ROOT/vercel.json" "$B/ct.json"
cp "$ROOT/.github/workflows/cost001-cron-runner.yml" "$B/runner.yml"
cp "$ROOT/ai-os/projexa-build-001/CRON_PLACEMENT.csv" "$B/placement.csv"
for f in "$ROOT"/.github/workflows/*; do : > "$B/wf/$(basename "$f")"; done
cat > "$B/px.json" <<'EOF'
{
  "regions": ["bom1"],
  "ignoreCommand": "sh -c 'exit 0'"
}
EOF
printf 'ci.yml\nclaude-nightly-maintenance.yml\nclaude.yml\n' > "$B/px_wf.txt"
cat > "$B/jobs.txt" <<'EOF'
cost001-ai-reduction-snapshot
cost001-audit-cadence
cost001-crm-lead-followup-alerts
cost001-fm-ppm-generate-occurrences
cost001-metric-alerts
cost001-orchestra-log-purge
cost001-pipeline-stuck-deal-digest
cost001-report-schedules
cost001-task-nudge-digest
cost001-the-firm-recur-engagements
dpdp-legal-clocks
dpdp-monday-digest
projexa-exchange-rate-refresh
some-unrelated-job
EOF

# the read-only stand-in for scripts/verify/sql-assert.mjs: refuses what the real guard refuses, records the SQL it was given
cat > "$T/stub-sql-assert.mjs" <<'JSEOF'
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const sql = args[args.indexOf("--sql") + 1] || "";
if (process.env.STUB_MARK) writeFileSync(process.env.STUB_MARK, sql + "\n");
if (process.env.STUB_MODE_MARK) writeFileSync(process.env.STUB_MODE_MARK, String(process.env.VERIFY_SQL_MODE) + "\n");
if (args[args.indexOf("--project") + 1] !== "ct") { console.error("stub: --project must be ct"); process.exit(2); }
const { checkReadOnlySql } = await import(pathToFileURL(process.env.STUB_GUARD).href);
const g = checkReadOnlySql(sql);
if (!g.ok) { console.error("refused by the read-only guard: " + g.reason); process.exit(2); }
if (!/from\s+cron\.job/i.test(sql)) { console.error("stub: not a cron.job query"); process.exit(4); }
if (process.env.STUB_CALLS) appendFileSync(process.env.STUB_CALLS, "call\n");
if (process.env.STUB_RC && process.env.STUB_RC !== "0") { console.error("stub failure"); process.exit(Number(process.env.STUB_RC)); }
if (process.env.STUB_FAIL_ONCE && !existsSync(process.env.STUB_FAIL_ONCE)) {
  writeFileSync(process.env.STUB_FAIL_ONCE, "failed once\n");
  console.error("stub: the first read fails");
  process.exit(4);
}
console.log(process.env.STUB_JOBS === undefined ? "-" : process.env.STUB_JOBS);
JSEOF
STUB="$T/stub-sql-assert.mjs"
GUARD="$(winpath "$ROOT/scripts/verify/lib/sql-safety.mjs")"
JOBS_CSV="$(paste -sd, "$B/jobs.txt")"

# env for one run: every source is a fixture. Later assignments win, so a case lists only what it changes.
BASE_ENV=(
  "CRON_FILE=$B/placement.csv" "CT_VERCEL_JSON=$B/ct.json" "PX_VERCEL_JSON=$B/px.json" "PX_WORKFLOWS_LIST=$B/px_wf.txt"
  "RUNNER_FILE=$B/runner.yml" "WORKFLOWS_DIR=$B/wf" "CRON_JOBS_FILE=$B/jobs.txt"
)
# disp NAME=value ... [script arguments]: words with an = go to env (they win over BASE_ENV), the rest go to the script.
disp() {
  local envs=() args=() a
  for a in "$@"; do
    case "$a" in *=*) envs+=("$a") ;; *) args+=("$a") ;; esac
  done
  env "${BASE_ENV[@]}" "${envs[@]+"${envs[@]}"}" bash "$DISP" "${args[@]+"${args[@]}"}"
}

# ------------------------------------------------------------------- harness
# t NAME EXPECT_RC EXPECT_LAST [+needle | -needle ...] -- command...
#   EXPECT_LAST is the exact last stdout line without its ` overrides=<n>` suffix, `~<prefix>` for a prefix match, or "none"
#   (no `undisposed=` line at all).
#   +needle: the text must appear in stdout. -needle: the text must appear in neither stdout nor stderr.
#   @needle: the text must appear in stderr (the script's own PASS/FAIL line goes there).
t() {
  local name="$1" erc="$2" elast="$3" needle why=""
  shift 3
  local needles=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do needles+=("$1"); shift; done
  shift
  local out err rc last
  out="$("$@" 2> "$T/stderr")"; rc=$?
  err="$(cat "$T/stderr")"
  last="$(printf '%s\n' "$out" | tail -n 1)"
  last="${last% overrides=*}"
  NCASE=$((NCASE + 1))
  [ "$rc" = "$erc" ] || why="exit code $rc, expected $erc"
  if [ -z "$why" ]; then
    if [ "$elast" = "none" ]; then
      if printf '%s\n' "$out" | grep -q '^undisposed='; then why="an undisposed= line was printed, expected none"; fi
    elif [ "${elast#\~}" != "$elast" ]; then
      case "$last" in "${elast#\~}"*) ;; *) why="last stdout line is '$last', expected it to start with '${elast#\~}'" ;; esac
    else
      [ "$last" = "$elast" ] || why="last stdout line is '$last', expected '$elast'"
    fi
  fi
  if [ -z "$why" ] && [ "${#needles[@]}" -gt 0 ]; then
    for needle in "${needles[@]}"; do
      case "$needle" in
        +*) printf '%s\n' "$out" | grep -qF -- "${needle#+}" || { why="stdout lacks '${needle#+}'"; break; } ;;
        -*) if printf '%s\n%s\n' "$out" "$err" | grep -qF -- "${needle#-}"; then why="output must not contain '${needle#-}'"; break; fi ;;
        @*) printf '%s\n' "$err" | grep -qF -- "${needle#@}" || { why="stderr lacks '${needle#@}'"; break; } ;;
      esac
    done
  fi
  if [ -z "$why" ]; then
    printf 'ok   %s\n' "$name"
  else
    NFAIL=$((NFAIL + 1))
    printf 'FAIL %s -- %s\n' "$name" "$why"
    printf '     stdout: %s\n' "$(printf '%s' "$out" | head -c 700 | tr '\n' '|')"
    printf '     stderr: %s\n' "$(printf '%s' "$err" | head -c 300 | tr '\n' '|')"
  fi
}

OK1="undisposed=0 vercel_crons_both_repos=1"

# ------------------------------------------------------------------- baseline
t "baseline: the committed files and a complete cron.job list are all disposed" 0 "$OK1" +"rows checked: PG_CRON 10" +"declared crons: compliance-tracker 1, projexa 0" -"UNDISPOSED" -- disp
NCASE=$((NCASE + 1))
RAW_LAST="$(disp 2>/dev/null | tail -n 1)"
if [ "$RAW_LAST" = "$OK1 overrides=7" ]; then
  printf 'ok   baseline: the seven hook variables in use are counted in an overrides= suffix\n'
else
  NFAIL=$((NFAIL + 1)); printf "FAIL baseline suffix: last line is '%s', expected '%s overrides=7'\n" "$RAW_LAST" "$OK1"
fi

# ------------------------------------------------------------------- vercel.json defects
"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_kill.json")" add api/internal/the-firm/deadline-digest/run "0 6 * * *"
t "a KILL cron left in vercel.json" 1 "undisposed=1 vercel_crons_both_repos=2" +"UNDISPOSED" +"the-firm/deadline-digest" +"KILL route is still in the compliance-tracker vercel.json" -- disp CT_VERCEL_JSON="$T/ct_kill.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_empty.json")" empty
t "the VERCEL row is absent: vercel.json has no cron" 1 "undisposed=1 vercel_crons_both_repos=0" +"VERCEL route is missing from the compliance-tracker vercel.json" -- disp CT_VERCEL_JSON="$T/ct_empty.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_swap.json")" replace api/internal/orchestra-log-purge/run "45 9 * * *"
t "the VERCEL route is swapped for a moved one: two problems, still one cron" 1 "undisposed=2 vercel_crons_both_repos=1" +"VERCEL route is missing" +"moved to PG_CRON but still declared" -- disp CT_VERCEL_JSON="$T/ct_swap.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_pg.json")" add api/internal/fm-ppm/generate-occurrences/run "0 2 * * *"
t "a PG_CRON cron still declared in vercel.json (it would run twice)" 1 "undisposed=1 vercel_crons_both_repos=2" +"moved to PG_CRON but still declared" -- disp CT_VERCEL_JSON="$T/ct_pg.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_gha.json")" add api/internal/crr-catchup-worker/run "*/15 * * * *"
t "a GITHUB_ACTIONS cron still declared, with an every-N schedule: two problems" 1 "undisposed=2 vercel_crons_both_repos=2" +"moved to GITHUB_ACTIONS but still declared" +"every-N-minutes" -- disp CT_VERCEL_JSON="$T/ct_gha.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_edge.json")" add api/internal/exchange-rate-refresh/run "30 9 * * *"
t "the Edge Function cron still declared in vercel.json" 1 "undisposed=1 vercel_crons_both_repos=2" +"moved to EDGE_FN_VIA_PG_CRON but still declared" -- disp CT_VERCEL_JSON="$T/ct_edge.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_freq.json")" schedule api/internal/secrets-audit/run "*/5 * * * *"
t "the VERCEL cron given an every-5-minutes schedule" 1 "undisposed=1 vercel_crons_both_repos=1" +"every-N-minutes" -- disp CT_VERCEL_JSON="$T/ct_freq.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_new.json")" add api/internal/brand-new/run "0 1 * * *"
t "a new cron with no row in the placement file" 1 "undisposed=1 vercel_crons_both_repos=2" +"no row in the placement file names it" -- disp CT_VERCEL_JSON="$T/ct_new.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/px.json")" "$(winpath "$T/px_cron.json")" add api/internal/email-digest-cadence/run "0 8 * * *"
t "a cron in the projexa vercel.json (its KILL row comes back)" 1 "undisposed=1 vercel_crons_both_repos=2" +"KILL route is still in the projexa vercel.json" -- disp PX_VERCEL_JSON="$T/px_cron.json"

# The exit condition is a count of exactly one across both repos, and it holds even when every row is disposed: each case below
# gives every declared cron its own VERCEL row (or none), so undisposed stays 0 and only the count can fail the run.
"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/ct.json")" "$(winpath "$T/ct_two.json")" add api/internal/second-vercel/run "0 5 * * *"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_two_ct.csv" second_vercel_ct
t "a second VERCEL cron in compliance-tracker with its own row: every row disposed, two crons, exit 1" 1 "undisposed=0 vercel_crons_both_repos=2" +"declared crons: compliance-tracker 2, projexa 0" -"UNDISPOSED" @"declare 2 crons, expected exactly 1" -- disp CRON_FILE="$T/csv_two_ct.csv" CT_VERCEL_JSON="$T/ct_two.json"

"$PY" "$(winpath "$T/jsonmut.py")" "$(winpath "$B/px.json")" "$(winpath "$T/px_two.json")" add api/internal/px-second-vercel/run "0 5 * * *"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_two_px.csv" second_vercel_px
t "a VERCEL cron in the projexa vercel.json with its own row: the count spans both repos, exit 1" 1 "undisposed=0 vercel_crons_both_repos=2" +"declared crons: compliance-tracker 1, projexa 1" -"UNDISPOSED" @"declare 2 crons, expected exactly 1" -- disp CRON_FILE="$T/csv_two_px.csv" PX_VERCEL_JSON="$T/px_two.json"

"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_none.csv" vercel_to_kill
t "no cron left in either vercel.json and its row reclassified KILL: every row disposed, zero crons, exit 1" 1 "undisposed=0 vercel_crons_both_repos=0" +"declared crons: compliance-tracker 0, projexa 0" -"UNDISPOSED" @"declare 0 crons, expected exactly 1" -- disp CRON_FILE="$T/csv_none.csv" CT_VERCEL_JSON="$T/ct_empty.json"

# ------------------------------------------------------------------- runner defects
sed '/^          - crr-catchup-worker$/d' "$B/runner.yml" > "$T/runner_noopt.yml"
t "a GITHUB_ACTIONS route missing from the runner options" 1 "undisposed=1 vercel_crons_both_repos=1" +"'crr-catchup-worker' is not an option of the runner workflow's cron input" -- disp RUNNER_FILE="$T/runner_noopt.yml"

sed '/cron=crr-catchup-worker ;;/d' "$B/runner.yml" > "$T/runner_nocase.yml"
t "a GITHUB_ACTIONS route missing from the runner schedule mapping" 1 "undisposed=1 vercel_crons_both_repos=1" +"has no cron=crr-catchup-worker case" -- disp RUNNER_FILE="$T/runner_nocase.yml"

sed 's/^          - loops$/          - loops-renamed/' "$B/runner.yml" > "$T/runner_rename.yml"
t "a runner option renamed: the route it named is missing" 1 "undisposed=1 vercel_crons_both_repos=1" +"'loops' is not an option" -- disp RUNNER_FILE="$T/runner_rename.yml"

sed 's/^          - crr-catchup-worker$/          # - crr-catchup-worker/' "$B/runner.yml" > "$T/runner_commented.yml"
t "a runner option commented out counts as missing" 1 "undisposed=1 vercel_crons_both_repos=1" +"'crr-catchup-worker' is not an option" -- disp RUNNER_FILE="$T/runner_commented.yml"

grep -v '^          - ' "$B/runner.yml" > "$T/runner_nolist.yml"
t "a runner file with no options list: exit 2" 2 none -- disp RUNNER_FILE="$T/runner_nolist.yml"

# ------------------------------------------------------------------- live cron.job checks
grep -v '^cost001-audit-cadence$' "$B/jobs.txt" > "$T/jobs_nopg.txt"
t "live: a PG_CRON job is absent from cron.job" 1 "undisposed=1 vercel_crons_both_repos=1" +"cron.job has no active job named 'cost001-audit-cadence'" -- disp CRON_JOBS_FILE="$T/jobs_nopg.txt"

grep -v '^projexa-exchange-rate-refresh$' "$B/jobs.txt" > "$T/jobs_noedge.txt"
t "live: the Edge Function job is absent from cron.job" 1 "undisposed=1 vercel_crons_both_repos=1" +"'projexa-exchange-rate-refresh'" -- disp CRON_JOBS_FILE="$T/jobs_noedge.txt"

grep -v '^dpdp-legal-clocks$' "$B/jobs.txt" > "$T/jobs_nodpdp.txt"
t "live: an existing DPDP job is absent from cron.job" 1 "undisposed=1 vercel_crons_both_repos=1" +"'dpdp-legal-clocks'" -- disp CRON_JOBS_FILE="$T/jobs_nodpdp.txt"

: > "$T/jobs_empty.txt"
t "live: an empty cron.job list leaves the 13 live rows undisposed" 1 "undisposed=13 vercel_crons_both_repos=1" -- disp CRON_JOBS_FILE="$T/jobs_empty.txt"

grep -v '^cost001-' "$B/jobs.txt" > "$T/jobs_none10.txt"
t "live: all ten cost001 jobs absent is 10 undisposed rows (the state before the jobs are applied)" 1 "undisposed=10 vercel_crons_both_repos=1" -- disp CRON_JOBS_FILE="$T/jobs_none10.txt"

# ------------------------------------------------------------------- placement file defects
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_fakepg.csv" fake_pg
t "a PG_CRON row whose job name is in no SQL file (one row, two reasons)" 1 "undisposed=1 vercel_crons_both_repos=1" +"'cost001-no-such-job' is not in supabase/prepared/cost001" +"cron.job has no active job named 'cost001-no-such-job'" -- disp CRON_FILE="$T/csv_fakepg.csv"
t "the same, in --local: the name-source check still runs" 1 "undisposed=1 vercel_crons_both_repos=1 live_checks_skipped=14" +"is not in supabase/prepared/cost001" -"has no active job" -- disp CRON_FILE="$T/csv_fakepg.csv" --local
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_edge.csv" edge_unknown
t "an EDGE_FN_VIA_PG_CRON row with no known job name" 1 "undisposed=1 vercel_crons_both_repos=1" +"no pg_cron job name is known for route 'some-edge'" -- disp CRON_FILE="$T/csv_edge.csv"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_badclass.csv" bad_class
t "a classification outside the five values" 1 "undisposed=1 vercel_crons_both_repos=1" +"is not one of the five values" -- disp CRON_FILE="$T/csv_badclass.csv"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_kind.csv" unknown_kind
t "a row of a shape the script does not know fails closed" 1 "undisposed=1 vercel_crons_both_repos=1" +"row shape not recognised" -- disp CRON_FILE="$T/csv_kind.csv"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_short.csv" short_row
t "a row with fewer cells than the header" 1 "undisposed=1 vercel_crons_both_repos=1" +"the row has 2 cells" -- disp CRON_FILE="$T/csv_short.csv"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_killwf.csv" kill_wf_present
t "a KILL workflow row whose file still exists" 1 "undisposed=1 vercel_crons_both_repos=1" +"KILL workflow file codeql.yml still exists" -- disp CRON_FILE="$T/csv_killwf.csv"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_killjob.csv" kill_job_active
t "a KILL pg_cron job row whose job is still active" 1 "undisposed=1 vercel_crons_both_repos=1" +"still has an active job named 'dpdp-legal-clocks'" -- disp CRON_FILE="$T/csv_killjob.csv"
"$PY" "$(winpath "$T/csvmut.py")" "$B/placement.csv" "$T/csv_vwf.csv" vercel_wf
t "a workflow row classified VERCEL has no rule" 1 "undisposed=1 vercel_crons_both_repos=1" +"no rule for classification VERCEL on a workflow row" -- disp CRON_FILE="$T/csv_vwf.csv"

# ------------------------------------------------------------------- workflow rows
printf 'ci.yml\nclaude-nightly-maintenance.yml\nclaude.yml\nemail-digest-poll.yml\n' > "$T/px_wf_kill.txt"
t "projexa KILL workflow file present (email-digest-poll.yml)" 1 "undisposed=1 vercel_crons_both_repos=1" +"KILL workflow file email-digest-poll.yml still exists in the projexa repo" -- disp PX_WORKFLOWS_LIST="$T/px_wf_kill.txt"
printf 'ci.yml\nclaude.yml\n' > "$T/px_wf_gone.txt"
t "projexa GITHUB_ACTIONS workflow file absent" 1 "undisposed=1 vercel_crons_both_repos=1" +"workflow file claude-nightly-maintenance.yml is not in the projexa repo" -- disp PX_WORKFLOWS_LIST="$T/px_wf_gone.txt"
mkdir -p "$T/wf_nodrift"
for f in "$B"/wf/*; do [ "$(basename "$f")" = "domain-drift-check.yml" ] || : > "$T/wf_nodrift/$(basename "$f")"; done
t "compliance-tracker GITHUB_ACTIONS workflow file absent (domain-drift-check.yml)" 1 "undisposed=1 vercel_crons_both_repos=1" +"workflow file domain-drift-check.yml is not in the compliance-tracker repo" -- disp WORKFLOWS_DIR="$T/wf_nodrift"

# ------------------------------------------------------------------- --local
t "--local: skips only the live checks (an empty cron.job list is not read)" 0 "undisposed=0 vercel_crons_both_repos=1 live_checks_skipped=13" +"LOCAL MODE: the live cron.job checks were skipped (13 row check(s))" -- disp CRON_JOBS_FILE="$T/jobs_empty.txt" --local
t "--local: every other check stays in force (a KILL cron left in vercel.json)" 1 "undisposed=1 vercel_crons_both_repos=2 live_checks_skipped=13" +"KILL route is still in the compliance-tracker vercel.json" -- disp CT_VERCEL_JSON="$T/ct_kill.json" --local
t "--local: a missing runner option still fails" 1 "undisposed=1 vercel_crons_both_repos=1 live_checks_skipped=13" -- disp RUNNER_FILE="$T/runner_noopt.yml" --local
t "--local: the VERCEL row absent still fails" 1 "undisposed=1 vercel_crons_both_repos=0 live_checks_skipped=13" -- disp CT_VERCEL_JSON="$T/ct_empty.json" --local
t "--local last line can not be mistaken for the register's line (suffix present)" 0 "~undisposed=0 vercel_crons_both_repos=1 live_checks_skipped=13" -- disp --local

# ------------------------------------------------------------------- the cron.job read itself
MARK="$(winpath "$T")/sql.mark"
rm -f "$MARK"
t "--local makes no cron.job read at all" 0 "~undisposed=0" -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_MARK="$MARK" STUB_RC=4 --local
NCASE=$((NCASE + 1))
if [ -e "$MARK" ]; then NFAIL=$((NFAIL + 1)); printf 'FAIL --local reached the cron.job stub (marker file exists)\n'; else printf 'ok   --local left the cron.job stub untouched\n'; fi

t "live read through the sql-assert stub: comma list parsed, every row disposed" 0 "$OK1" -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_MARK="$MARK" STUB_JOBS="$JOBS_CSV"
NCASE=$((NCASE + 1))
if grep -qi 'from cron.job' "$MARK" 2>/dev/null && grep -qi 'where active' "$MARK" 2>/dev/null; then printf 'ok   the SQL sent is a cron.job SELECT for active jobs and passed the read-only guard\n'; else NFAIL=$((NFAIL + 1)); printf 'FAIL the stub did not record a cron.job SELECT: %s\n' "$(cat "$MARK" 2>/dev/null)"; fi
MODE_MARK="$(winpath "$T")/mode.mark"
rm -f "$MODE_MARK"
t "live read with VERIFY_SQL_MODE unset: the read still passes" 0 "$OK1" -- env -u VERIFY_SQL_MODE "${BASE_ENV[@]}" CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_MODE_MARK="$MODE_MARK" STUB_JOBS="$JOBS_CSV" bash "$DISP"
NCASE=$((NCASE + 1))
if [ "$(tr -d '\r' < "$MODE_MARK" 2>/dev/null)" = "mgmt" ]; then printf 'ok   an unset VERIFY_SQL_MODE reaches sql-assert as mgmt (app_runtime cannot see cron.job)\n'; else NFAIL=$((NFAIL + 1)); printf "FAIL the mode sql-assert saw with VERIFY_SQL_MODE unset was '%s', expected mgmt\n" "$(cat "$MODE_MARK" 2>/dev/null)"; fi
rm -f "$MODE_MARK"
t "live read with VERIFY_SQL_MODE=direct: the read still passes" 0 "$OK1" -- env "${BASE_ENV[@]}" VERIFY_SQL_MODE=direct CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_MODE_MARK="$MODE_MARK" STUB_JOBS="$JOBS_CSV" bash "$DISP"
NCASE=$((NCASE + 1))
if [ "$(tr -d '\r' < "$MODE_MARK" 2>/dev/null)" = "direct" ]; then printf 'ok   a VERIFY_SQL_MODE the caller set is kept, not overwritten\n'; else NFAIL=$((NFAIL + 1)); printf "FAIL the mode sql-assert saw with VERIFY_SQL_MODE=direct was '%s', expected direct\n" "$(cat "$MODE_MARK" 2>/dev/null)"; fi
t "live read: a list missing one job through the stub is undisposed" 1 "undisposed=1 vercel_crons_both_repos=1" +"'cost001-metric-alerts'" -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_JOBS="${JOBS_CSV//cost001-metric-alerts,/}"
t "live read: the sentinel '-' (no active jobs) is an empty list" 1 "undisposed=13 vercel_crons_both_repos=1" -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_JOBS="-"
CALLS="$(winpath "$T")/sql.calls"
rm -f "$CALLS"
t "live read fails every time (sql-assert exit 4): exit 2, no undisposed= line, never a pass" 2 none -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_CALLS="$CALLS" STUB_RC=4 CRON_READ_RETRY_WAIT=0
NCASE=$((NCASE + 1))
if [ "$(wc -l < "$CALLS" 2>/dev/null | tr -d ' ')" = "3" ]; then printf 'ok   an exit-4 read is tried three times and then given up on\n'; else NFAIL=$((NFAIL + 1)); printf "FAIL an exit-4 read was tried %s times, expected 3\n" "$(wc -l < "$CALLS" 2>/dev/null | tr -d ' ')"; fi
rm -f "$CALLS"
t "live read cannot run (sql-assert exit 3): exit 2" 2 none -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_CALLS="$CALLS" STUB_RC=3 CRON_READ_RETRY_WAIT=0
NCASE=$((NCASE + 1))
if [ "$(wc -l < "$CALLS" 2>/dev/null | tr -d ' ')" = "1" ]; then printf 'ok   an exit-3 read is not tried again\n'; else NFAIL=$((NFAIL + 1)); printf "FAIL an exit-3 read was tried %s times, expected 1\n" "$(wc -l < "$CALLS" 2>/dev/null | tr -d ' ')"; fi
rm -f "$CALLS" "$T/fail.once"
t "live read: a first read that times out (exit 4) is tried again and then passes" 0 "$OK1" -- disp CRON_JOBS_FILE= CRON_SQL_ASSERT="$STUB" STUB_GUARD="$GUARD" STUB_CALLS="$CALLS" STUB_FAIL_ONCE="$(winpath "$T")/fail.once" STUB_JOBS="$JOBS_CSV" CRON_READ_RETRY_WAIT=0
NCASE=$((NCASE + 1))
if [ "$(wc -l < "$CALLS" 2>/dev/null | tr -d ' ')" = "2" ]; then printf 'ok   the retried read took exactly two calls\n'; else NFAIL=$((NFAIL + 1)); printf "FAIL the retried read took %s calls, expected 2\n" "$(wc -l < "$CALLS" 2>/dev/null | tr -d ' ')"; fi

# ------------------------------------------------------------------- usage and missing files
t "an unknown argument: exit 2" 2 none -- disp --live
t "an argument that is not an option: exit 2" 2 none -- disp somewhere
t "the placement file is missing: exit 2" 2 none -- disp CRON_FILE="$T/no-such.csv"
t "the compliance-tracker vercel.json is missing: exit 2" 2 none -- disp CT_VERCEL_JSON="$T/no-such.json"
t "the projexa vercel.json is missing: exit 2" 2 none -- disp PX_VERCEL_JSON="$T/no-such.json"
t "the runner file is missing: exit 2" 2 none -- disp RUNNER_FILE="$T/no-such.yml"
t "the workflows folder is missing: exit 2" 2 none -- disp WORKFLOWS_DIR="$T/no-such-dir"
t "the cron.job list file is missing: exit 2" 2 none -- disp CRON_JOBS_FILE="$T/no-such.txt"
printf '{ not json' > "$T/bad.json"
t "a vercel.json that is not JSON: exit 2" 2 none -- disp CT_VERCEL_JSON="$T/bad.json"
printf '{"crons":[{"path":"/api/internal/x/run"}]}' > "$T/bad_entry.json"
t "a cron entry without a schedule: exit 2" 2 none -- disp CT_VERCEL_JSON="$T/bad_entry.json"
: > "$T/empty.csv"
t "an empty placement file: exit 2" 2 none -- disp CRON_FILE="$T/empty.csv"
printf 'repo,name\nx,y\n' > "$T/nocols.csv"
t "a placement file without the classification column: exit 2" 2 none -- disp CRON_FILE="$T/nocols.csv"

# -------------------------------------------------------------------- summary
if [ "$NFAIL" -eq 0 ]; then
  printf 'SELFTEST PASS: %s cases\n' "$NCASE"
  exit 0
fi
printf 'SELFTEST FAIL: %s of %s cases failed\n' "$NFAIL" "$NCASE"
exit 1
