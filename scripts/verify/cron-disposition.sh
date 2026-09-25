#!/usr/bin/env bash
# BR-519 (PROJEXA-BUILD-001, item U-41): every row of CRON_PLACEMENT.csv has its target disposition in both repositories, and
# one Vercel cron is left across the two vercel.json files. Read-only: the script writes nothing to any repository or database.
#
# Exit 0 = every row is disposed and exactly one cron is declared in the two vercel.json files. The last stdout line is:
#   undisposed=0 vercel_crons_both_repos=1
# Exit 1 = a row is undisposed, or the two vercel.json files do not hold exactly one cron. The last stdout line has the same shape
#   with the measured numbers, and the lines above it name each undisposed row and why.
# Exit 2 = usage error or a source that could not be read (a cron.job read that failed is exit 2, never a silent pass).
# The last stderr line is `PASS BR-519` or `FAIL BR-519: <reason>`.
#
# The rule per row of CRON_PLACEMENT.csv (path_or_name, classification):
#   vercel.json cron <route>  (and the same row renamed `formerly vercel.json cron <route> ...` after the route left vercel.json)
#     KILL                 the route is in neither vercel.json.
#     VERCEL               the route is in the vercel.json of the row's repo.
#     PG_CRON              the route is in neither vercel.json, the job `cost001-<route with / as ->` is active in cron.job (live), and
#                          that job name appears in supabase/prepared/cost001/*.sql or in drizzle/*.sql (the name is not invented).
#     EDGE_FN_VIA_PG_CRON  the route is in neither vercel.json and its pg_cron job is active in cron.job (live). The job name of
#                          a moved route comes from EDGE_JOBS below (exchange-rate-refresh -> projexa-exchange-rate-refresh).
#     GITHUB_ACTIONS       the route is in neither vercel.json and the route name is both an option of the workflow_dispatch input
#                          `cron` and a `cron=<route>` case of the schedule mapping in .github/workflows/cost001-cron-runner.yml.
#   pg_cron job <n> <name>   EDGE_FN_VIA_PG_CRON or PG_CRON: the job is active in cron.job (live). KILL: the job is not active.
#   .github/workflows/<file> ...   GITHUB_ACTIONS: the workflow file exists in the row's repo (compliance-tracker: the working
#                          tree; projexa: main, through the GitHub API). KILL: the file does not exist there.
#   Any other row shape, or a classification outside the five values, is undisposed (the script fails closed).
# Also: a cron declared in either vercel.json that has no row in the file, or that has an every-N-minutes schedule, is undisposed.
#
# --local skips ONLY the live cron.job checks (the ones that need the database) and says so. Every other check still runs. A local
# run can not be mistaken for the register's command: its last line carries a `live_checks_skipped=<n>` suffix. The same holds for
# any run that swaps a source through a test hook: the last line then ends with ` overrides=<n>`. The register's command
# (no arguments, no hook variables) prints the bare line above.
#
# Sources, in order of use:
#   compliance-tracker vercel.json   the working tree file (CT_REF=<git ref> reads that ref instead; CT_VERCEL_JSON=<file> a saved copy)
#   projexa vercel.json              gh api repos/FChecklist/projexa/contents/vercel.json?ref=main (PX_REF; PX_VERCEL_JSON=<file>)
#   projexa workflow file names      gh api .../contents/.github/workflows?ref=main (PX_WORKFLOWS_LIST=<file, one name per line>)
#   workflow runner file             .github/workflows/cost001-cron-runner.yml (RUNNER_FILE=<file>)
#   compliance-tracker workflows     the .github/workflows folder of the working tree (WORKFLOWS_DIR=<folder>)
#   the placement file               ai-os/projexa-build-001/CRON_PLACEMENT.csv (PKG_DIR=<folder>, CRON_FILE=<file>)
#   cron.job                         node scripts/verify/sql-assert.mjs --project ct, one SELECT. It needs a role that sees cron.job,
#                                    so VERIFY_SQL_MODE defaults to mgmt for this read (scripts/verify/lib/mgmt-sql.mjs, the same
#                                    mode verify-all.mjs exports); a value the caller already set is kept.
#                                    CRON_JOBS_FILE=<file, one active job name per line> replaces it; CRON_SQL_ASSERT=<script>
#                                    replaces sql-assert.mjs. Both exist for scripts/verify/cron-disposition.selftest.sh.
#
# Usage: bash scripts/verify/cron-disposition.sh [--local]
set -u

ID="BR-519"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Count the test hooks in use before any default is filled in: every one of them changes what the last line says.
OVERRIDES=0
for v in PKG_DIR CRON_FILE CT_REF CT_VERCEL_JSON PX_VERCEL_JSON PX_WORKFLOWS_LIST RUNNER_FILE WORKFLOWS_DIR CRON_JOBS_FILE CRON_SQL_ASSERT; do
  if [ -n "${!v:-}" ]; then OVERRIDES=$((OVERRIDES + 1)); fi
done

PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
CRON_FILE="${CRON_FILE:-$PKG_DIR/CRON_PLACEMENT.csv}"

finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

LOCAL=0
for a in "$@"; do
  case "$a" in
    --local) LOCAL=1 ;;
    *) finish_usage "unknown argument: $a (the only option is --local)" ;;
  esac
done

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

[ -f "$CRON_FILE" ] || finish_usage "placement file not found: $CRON_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ------------------------------------------------ compliance-tracker vercel.json
if [ -n "${CT_VERCEL_JSON:-}" ]; then
  [ -f "$CT_VERCEL_JSON" ] || finish_usage "CT_VERCEL_JSON not found: $CT_VERCEL_JSON"
  CT_JSON="$CT_VERCEL_JSON"
elif [ -n "${CT_REF:-}" ]; then
  git -C "$ROOT" show "$CT_REF:vercel.json" > "$TMP/ct-vercel.json" 2>/dev/null || finish_usage "git could not read vercel.json at $CT_REF"
  CT_JSON="$TMP/ct-vercel.json"
else
  CT_JSON="$ROOT/vercel.json"
  [ -f "$CT_JSON" ] || finish_usage "vercel.json not found: $CT_JSON"
fi

RUNNER="${RUNNER_FILE:-$ROOT/.github/workflows/cost001-cron-runner.yml}"
[ -f "$RUNNER" ] || finish_usage "runner workflow not found: $RUNNER"
WF_DIR="${WORKFLOWS_DIR:-$ROOT/.github/workflows}"
[ -d "$WF_DIR" ] || finish_usage "workflows folder not found: $WF_DIR"

# ------------------------------------------------ projexa vercel.json and workflow names
# gh api from this laptop times out now and then, so each read is tried up to three times. A read that still fails is exit 2,
# never a pass.
gh_read() {
  local out="$1" n
  shift
  for n in 1 2 3; do
    if gh api "$@" > "$out" 2>/dev/null; then return 0; fi
    [ "$n" = "3" ] || sleep 3
  done
  return 1
}
PX_REF_USED="${PX_REF:-main}"
if [ -n "${PX_VERCEL_JSON:-}" ]; then
  [ -f "$PX_VERCEL_JSON" ] || finish_usage "PX_VERCEL_JSON not found: $PX_VERCEL_JSON"
  PX_JSON="$PX_VERCEL_JSON"
else
  command -v gh >/dev/null 2>&1 || finish_usage "gh is not installed and PX_VERCEL_JSON was not given"
  gh_read "$TMP/px-vercel.json" -H "Accept: application/vnd.github.raw" "repos/FChecklist/projexa/contents/vercel.json?ref=$PX_REF_USED" \
    || finish_usage "gh api could not read the projexa vercel.json (three attempts)"
  PX_JSON="$TMP/px-vercel.json"
fi
if [ -n "${PX_WORKFLOWS_LIST:-}" ]; then
  [ -f "$PX_WORKFLOWS_LIST" ] || finish_usage "PX_WORKFLOWS_LIST not found: $PX_WORKFLOWS_LIST"
  PX_WF="$PX_WORKFLOWS_LIST"
else
  command -v gh >/dev/null 2>&1 || finish_usage "gh is not installed and PX_WORKFLOWS_LIST was not given"
  gh_read "$TMP/px-workflows.txt" "repos/FChecklist/projexa/contents/.github/workflows?ref=$PX_REF_USED" --jq '.[].name' \
    || finish_usage "gh api could not list the projexa workflows folder (three attempts)"
  PX_WF="$TMP/px-workflows.txt"
fi

# ------------------------------------------------ cron.job (live), unless --local
JOBS="-"
if [ "$LOCAL" = "0" ]; then
  if [ -n "${CRON_JOBS_FILE:-}" ]; then
    [ -f "$CRON_JOBS_FILE" ] || finish_usage "CRON_JOBS_FILE not found: $CRON_JOBS_FILE"
    JOBS="$CRON_JOBS_FILE"
  else
    SQL_ASSERT="${CRON_SQL_ASSERT:-$ROOT/scripts/verify/sql-assert.mjs}"
    [ -f "$SQL_ASSERT" ] || finish_usage "sql-assert script not found: $SQL_ASSERT"
    command -v node >/dev/null 2>&1 || finish_usage "node is not available on PATH (needed to read cron.job; --local skips that read)"
    # The default role (app_runtime) cannot see cron.job, so an unset VERIFY_SQL_MODE becomes mgmt for this one read. A mode the
    # caller set is left alone. Exit 4 is a connection or query error (the Management API answers HTTP 544 now and then), so only
    # that exit is tried again, up to three times, CRON_READ_RETRY_WAIT seconds apart (default 5). Any other exit stops at once.
    RC=4
    for n in 1 2 3; do
      VERIFY_SQL_MODE="${VERIFY_SQL_MODE:-mgmt}" node "$(winpath "$SQL_ASSERT")" --project ct \
        --sql "select coalesce(string_agg(jobname, ',' order by jobname), '-') from cron.job where active" \
        --not-equals "@none@" > "$TMP/jobs.raw" 2> "$TMP/jobs.err"
      RC=$?
      [ "$RC" = "4" ] || break
      [ "$n" = "3" ] || sleep "${CRON_READ_RETRY_WAIT:-5}"
    done
    if [ "$RC" != "0" ] && [ "$RC" != "1" ]; then
      finish_usage "cannot read cron.job (sql-assert exit $RC: $(head -n 1 "$TMP/jobs.err" | head -c 300)). The read runs with VERIFY_SQL_MODE=mgmt unless you set another mode, and that path needs SUPABASE_ACCESS_TOKEN. Use --local to skip the live cron.job checks"
    fi
    tr -d '\r' < "$TMP/jobs.raw" | tail -n 1 | tr ',' '\n' | grep -v '^-$' | grep -v '^$' > "$TMP/jobs.txt" || true
    JOBS="$TMP/jobs.txt"
  fi
fi

cat > "$TMP/check.py" <<'PYEOF'
import csv
import glob
import io
import json
import os
import re
import sys

(cron_csv, ct_json, px_json, runner_file, wf_dir, px_wf_file, jobs_file, local_flag, root) = sys.argv[1:10]
LOCAL = local_flag == "1"
ENUM = ("PG_CRON", "EDGE_FN_VIA_PG_CRON", "GITHUB_ACTIONS", "VERCEL", "KILL")
ROUTE_PREFIX = "/api/internal/"
ROUTE_SUFFIX = "/run"
# A route whose target is an Edge Function called from pg_cron: the pg_cron job name (SHARED_BOUNDARY.md job table).
EDGE_JOBS = {"exchange-rate-refresh": "projexa-exchange-rate-refresh"}

RE_VERCEL = re.compile(r"^(formerly )?vercel\.json cron (/api/internal/[a-z0-9/-]+/run)(?:\s|$)")
RE_JOB = re.compile(r"^pg_cron job \d+ ([A-Za-z0-9_-]+)(?:\s|$)")
RE_WORKFLOW = re.compile(r"^\.github/workflows/([A-Za-z0-9._-]+\.ya?ml)(?:\s|$)")


def bad(msg):
    print("BAD " + msg)
    sys.exit(2)


def read_text(path, label):
    try:
        return open(path, encoding="utf-8-sig").read()
    except OSError:
        bad("cannot read %s" % label)


def load_crons(path, label):
    try:
        doc = json.loads(read_text(path, label + " vercel.json"))
    except ValueError:
        bad("%s vercel.json is not valid JSON" % label)
    if not isinstance(doc, dict):
        bad("%s vercel.json is not a JSON object" % label)
    out = []
    for c in doc.get("crons", []):
        if not isinstance(c, dict) or not isinstance(c.get("path"), str) or not isinstance(c.get("schedule"), str):
            bad("%s vercel.json has a cron entry without a string path and schedule" % label)
        out.append((c["path"], c["schedule"]))
    return out


ct_crons = load_crons(ct_json, "compliance-tracker")
px_crons = load_crons(px_json, "projexa")
ct_paths = {p for p, _ in ct_crons}
px_paths = {p for p, _ in px_crons}

runner = read_text(runner_file, "the runner workflow")
m_opts = re.search(r"^[ \t]+options:[ \t]*\n((?:[ \t]+-[ \t]+[A-Za-z0-9/_-]+[ \t]*\n)+)", runner, re.M)
if not m_opts:
    bad("the runner workflow has no options list under the cron input")
runner_options = set(re.findall(r"-[ \t]+([A-Za-z0-9/_-]+)", m_opts.group(1)))
runner_cases = set(re.findall(r'^[ \t]*"[^"\n]+"\)[ \t]+cron=([A-Za-z0-9/_-]+)[ \t]*;;', runner, re.M))

try:
    ct_workflows = set(os.listdir(wf_dir))
except OSError:
    bad("cannot list the workflows folder")
px_workflows = {ln.strip() for ln in read_text(px_wf_file, "the projexa workflow list").splitlines() if ln.strip()}

live_jobs = set()
if not LOCAL:
    live_jobs = {ln.strip() for ln in read_text(jobs_file, "the cron.job list").splitlines() if ln.strip()}

blob_parts = []
for d in (os.path.join(root, "supabase", "prepared", "cost001"), os.path.join(root, "drizzle")):
    for f in sorted(glob.glob(os.path.join(d, "*.sql"))):
        try:
            t = open(f, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if "cron.schedule" in t:
            blob_parts.append(t)
job_sources = "\n".join(blob_parts)

raw = read_text(cron_csv, "the placement file").replace("\r\n", "\n")
rows = list(csv.reader(io.StringIO(raw)))
if not rows:
    bad("the placement file is empty")
header = [h.strip() for h in rows[0]]
for col in ("repo", "path_or_name", "classification"):
    if col not in header:
        bad("the header has no '%s' column" % col)
i_repo, i_path, i_class = header.index("repo"), header.index("path_or_name"), header.index("classification")

problems = []
counts = {k: 0 for k in ENUM}
skipped = 0
rowed_paths = set()


class Row:
    def __init__(self, number, label, cls):
        self.number, self.label, self.cls, self.reasons = number, label, cls, []


def live_present(row, job):
    global skipped
    if LOCAL:
        skipped += 1
        return
    if job not in live_jobs:
        row.reasons.append("cron.job has no active job named '%s'" % job)


def live_absent(row, job):
    global skipped
    if LOCAL:
        skipped += 1
        return
    if job in live_jobs:
        row.reasons.append("cron.job still has an active job named '%s'" % job)


for number, r in enumerate(rows[1:], start=2):
    if not r:
        continue
    if len(r) != len(header):
        problems.append(Row(number, "(row shape)", "?"))
        problems[-1].reasons.append("the row has %d cells, the header has %d" % (len(r), len(header)))
        continue
    repo, name, cls = r[i_repo].strip(), r[i_path].strip(), r[i_class].strip()
    row = Row(number, name[:90], cls)
    if RE_VERCEL.match(name):
        m0 = RE_VERCEL.match(name)
        row.label = ("formerly " if m0.group(1) else "") + "vercel.json cron " + m0.group(2)
    if cls not in ENUM:
        row.reasons.append("classification '%s' is not one of the five values" % cls)
        problems.append(row)
        continue
    counts[cls] += 1
    mv, mj, mw = RE_VERCEL.match(name), RE_JOB.match(name), RE_WORKFLOW.match(name)
    if mv:
        path = mv.group(2)
        slug = path[len(ROUTE_PREFIX):-len(ROUTE_SUFFIX)]
        rowed_paths.add(path)
        in_ct, in_px = path in ct_paths, path in px_paths
        if cls == "KILL":
            if in_ct:
                row.reasons.append("KILL route is still in the compliance-tracker vercel.json")
            if in_px:
                row.reasons.append("KILL route is still in the projexa vercel.json")
        elif cls == "VERCEL":
            home = {"compliance-tracker": ct_paths, "projexa": px_paths}.get(repo)
            if home is None:
                row.reasons.append("unknown repo '%s'" % repo)
            elif path not in home:
                row.reasons.append("VERCEL route is missing from the %s vercel.json" % repo)
        else:
            if in_ct or in_px:
                row.reasons.append("moved to %s but still declared in the %s vercel.json" % (cls, "compliance-tracker" if in_ct else "projexa"))
            if cls == "PG_CRON":
                job = "cost001-" + slug.replace("/", "-")
                if ("'%s'" % job) not in job_sources:
                    row.reasons.append("job name '%s' is not in supabase/prepared/cost001/*.sql or drizzle/*.sql" % job)
                live_present(row, job)
            elif cls == "EDGE_FN_VIA_PG_CRON":
                job = EDGE_JOBS.get(slug)
                if job is None:
                    row.reasons.append("no pg_cron job name is known for route '%s' (add it to EDGE_JOBS)" % slug)
                else:
                    live_present(row, job)
            else:
                if slug not in runner_options:
                    row.reasons.append("'%s' is not an option of the runner workflow's cron input" % slug)
                if slug not in runner_cases:
                    row.reasons.append("'%s' has no cron=%s case in the runner workflow's schedule mapping" % (slug, slug))
    elif mj:
        job = mj.group(1)
        if cls in ("EDGE_FN_VIA_PG_CRON", "PG_CRON"):
            live_present(row, job)
        elif cls == "KILL":
            live_absent(row, job)
        else:
            row.reasons.append("no rule for classification %s on a pg_cron job row" % cls)
    elif mw:
        wf = mw.group(1)
        files = {"compliance-tracker": ct_workflows, "projexa": px_workflows}.get(repo)
        if files is None:
            row.reasons.append("unknown repo '%s'" % repo)
        elif cls == "GITHUB_ACTIONS":
            if wf not in files:
                row.reasons.append("workflow file %s is not in the %s repo" % (wf, repo))
        elif cls == "KILL":
            if wf in files:
                row.reasons.append("KILL workflow file %s still exists in the %s repo" % (wf, repo))
        else:
            row.reasons.append("no rule for classification %s on a workflow row" % cls)
    else:
        row.reasons.append("row shape not recognised (expected a vercel.json cron, pg_cron job or .github/workflows row)")
    if row.reasons:
        problems.append(row)

for repo_label, crons in (("compliance-tracker", ct_crons), ("projexa", px_crons)):
    for path, schedule in crons:
        if path not in rowed_paths:
            p = Row(0, "declared cron %s (%s)" % (path, repo_label), "-")
            p.reasons.append("declared in the %s vercel.json but no row in the placement file names it" % repo_label)
            problems.append(p)
        if schedule.startswith("*/"):
            p = Row(0, "declared cron %s (%s)" % (path, repo_label), "-")
            p.reasons.append("schedule '%s' is an every-N-minutes schedule" % schedule)
            problems.append(p)

print("rows checked: %s" % ", ".join("%s %d" % (k, counts[k]) for k in ENUM))
print("declared crons: compliance-tracker %d, projexa %d" % (len(ct_crons), len(px_crons)))
for p in problems:
    where = "row %d" % p.number if p.number else "vercel.json"
    print("UNDISPOSED %s [%s] %s: %s" % (where, p.cls, p.label, "; ".join(p.reasons)))
print("SUMMARY %d %d %d" % (len(problems), len(ct_crons) + len(px_crons), skipped))
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$(winpath "$CRON_FILE")" "$(winpath "$CT_JSON")" "$(winpath "$PX_JSON")" "$(winpath "$RUNNER")" \
  "$(winpath "$WF_DIR")" "$(winpath "$PX_WF")" "$([ "$JOBS" = "-" ] && printf '%s' "-" || winpath "$JOBS")" "$LOCAL" "$(winpath "$ROOT")" 2>"$TMP/py.err")"
PYRC=$?
if [ "$PYRC" != "0" ]; then
  case "$RESULT" in
    "BAD "*) finish_usage "${RESULT#BAD }" ;;
  esac
  finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
fi

printf '%s\n' "$RESULT" | grep -v '^SUMMARY '
SUMMARY="$(printf '%s\n' "$RESULT" | grep '^SUMMARY ' | tail -n 1)"
[ -n "$SUMMARY" ] || finish_usage "the check program printed no summary"
set -- $SUMMARY
UNDISPOSED="$2"; VERCEL_COUNT="$3"; SKIPPED="$4"

if [ "$LOCAL" = "1" ]; then
  echo "LOCAL MODE: the live cron.job checks were skipped ($SKIPPED row check(s)); every other check ran"
fi

LAST="undisposed=$UNDISPOSED vercel_crons_both_repos=$VERCEL_COUNT"
if [ "$LOCAL" = "1" ]; then LAST="$LAST live_checks_skipped=$SKIPPED"; fi
if [ "$OVERRIDES" != "0" ]; then LAST="$LAST overrides=$OVERRIDES"; fi
printf '%s\n' "$LAST"

if [ "$UNDISPOSED" = "0" ] && [ "$VERCEL_COUNT" = "1" ]; then
  if [ "$LOCAL" = "1" ]; then
    printf 'PASS %s (local mode: the live cron.job checks were skipped, so this is not the register result)\n' "$ID" >&2
  else
    printf 'PASS %s\n' "$ID" >&2
  fi
  exit 0
fi
if [ "$UNDISPOSED" != "0" ]; then
  printf 'FAIL %s: %s row(s) or declared cron(s) are undisposed\n' "$ID" "$UNDISPOSED" >&2
else
  printf 'FAIL %s: the two vercel.json files declare %s crons, expected exactly 1\n' "$ID" "$VERCEL_COUNT" >&2
fi
exit 1
