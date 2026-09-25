#!/usr/bin/env bash
# BR-125 (PROJEXA-BUILD-001, phase 1): ai-os/SHARED_BOUNDARY.md names the owning product of every shared resource, both
# cron.job entries, the seven Edge Functions of the two Supabase projects, the installed extensions of both projects, the
# rule that four kinds of change are recorded in ai-os/boss/ACTIVE-CLAIMS.yaml before they are made, and dated table counts.
#
# Exit 0 = nothing is missing. stdout is exactly one line:
#   SHARED_BOUNDARY_OK MISSING=0
# Exit 1 = at least one item is missing; every missing item is listed on stderr and the count is in the FAIL line.
# Exit 2 = usage error or the file cannot be read.
# The last stderr line is `PASS BR-125` or `FAIL BR-125: MISSING=<n> ...`.
#
# Items (each one that is absent or empty adds 1 to MISSING; the expected lists are the ones recorded on 2026-09-25 and are
# a minimum: rows added later do not fail the check, rows removed do):
#   - the text `ACTIVE-CLAIMS` and the ten resource words compliance-tracker, verdian-ai, evpckeuxgvahguwsaeul, pg_cron,
#     pg_net, pgaudit, supabase_vault, Edge Function, Vercel, laptop.
#   - section 3 (shared resources): a table whose every row has a non-empty "Owner product" cell.
#   - section 4a (13 verdian-ai extensions) and 4b (6 PROJEXA extensions): one row per extension with a non-empty owner cell.
#   - section 5: one row each for dpdp-legal-clocks and dpdp-monday-digest with a non-empty owner cell.
#   - section 6: one row each for dpdp-ai-link, dpdp-monday-email, mcp-dev, orchestrator, mint-session-r39ct (verdian-ai),
#     mint-session-r33 and rotate-demo-password-r38 (PROJEXA), each naming its project and a non-empty owner cell.
#   - rule R1: the line names ai-os/boss/ACTIVE-CLAIMS.yaml and says the claim comes before the action, and its bullets cover the four actions (install or drop
#     an extension, SECURITY DEFINER function, cron.job, Edge Function).
#   - a dated table count: a statement such as `523 tables ... on 2026-09-25` on the verdian-ai database row.
#
# Usage: bash scripts/verify/shared-boundary.sh
# Environment: SHARED_BOUNDARY_FILE (default: ai-os/SHARED_BOUNDARY.md under the repo root).
set -u

ID="BR-125"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHARED_BOUNDARY_FILE="${SHARED_BOUNDARY_FILE:-$ROOT/ai-os/SHARED_BOUNDARY.md}"

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

[ $# -eq 0 ] || finish_usage "this script takes no arguments"
[ -f "$SHARED_BOUNDARY_FILE" ] || finish_usage "file not found: $SHARED_BOUNDARY_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.py" <<'PYEOF'
import re
import sys

text = open(sys.argv[1], encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
lines = text.split("\n")
missing = []

WORDS = ["compliance-tracker", "verdian-ai", "evpckeuxgvahguwsaeul", "pg_cron", "pg_net", "pgaudit",
         "supabase_vault", "Edge Function", "Vercel", "laptop"]
CRON_JOBS = ["dpdp-legal-clocks", "dpdp-monday-digest"]
EDGE_FUNCTIONS = [
    ("dpdp-ai-link", "verdian-ai"), ("dpdp-monday-email", "verdian-ai"), ("mcp-dev", "verdian-ai"),
    ("orchestrator", "verdian-ai"), ("mint-session-r39ct", "verdian-ai"),
    ("mint-session-r33", "PROJEXA"), ("rotate-demo-password-r38", "PROJEXA"),
]
EXT_VERDIAN = ["pg_cron", "pg_net", "supabase_vault", "vector", "pgaudit", "hstore", "pg_stat_statements", "pgcrypto",
               "uuid-ossp", "pg_trgm", "hypopg", "index_advisor", "plpgsql"]
EXT_PROJEXA = ["supabase_vault", "pgaudit", "pg_stat_statements", "pgcrypto", "uuid-ossp", "plpgsql"]

# Tables, each with the heading text that precedes it.
tables = []
heading = ""
i = 0
while i < len(lines):
    line = lines[i]
    if line.startswith("#"):
        heading = line
    if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|\s*:?-{3,}", lines[i + 1]):
        header = [c.strip() for c in line.strip().strip("|").split("|")]
        rows = []
        j = i + 2
        while j < len(lines) and lines[j].startswith("|"):
            rows.append([c.strip() for c in lines[j].strip().strip("|").split("|")])
            j += 1
        tables.append({"heading": heading, "header": header, "rows": rows})
        i = j
        continue
    i += 1


def table_under(prefix_re):
    for t in tables:
        if re.match(prefix_re, t["heading"]):
            return t
    return None


def owner_index(t):
    for n, h in enumerate(t["header"]):
        if h.lower().startswith("owner product"):
            return n
    return None


# The public repository copy of SHARED_BOUNDARY.md has the name cell of one row replaced by this marker
# (PMD-25: the row names an edge function that holds a credential). The private KT copy keeps the name.
# A redacted name cell counts as the row for a name listed in REDACTABLE_NAMES.
REDACT_MARK = "removed from the public copy"
REDACTABLE_NAMES = {"mcp-dev"}


def find_row(t, name, name_col):
    ni = t["header"].index(name_col) if name_col in t["header"] else 0
    for r in t["rows"]:
        if len(r) > ni and r[ni].strip("`").strip() == name:
            return r
    if name in REDACTABLE_NAMES:
        for r in t["rows"]:
            if len(r) > ni and REDACT_MARK in r[ni]:
                return r
    return None


def check_named_rows(prefix_re, label, names, name_col, project_col=None):
    t = table_under(prefix_re)
    if t is None:
        missing.append("%s: table not found" % label)
        return
    oi = owner_index(t)
    if oi is None:
        missing.append("%s: no 'owner product' column" % label)
        return
    for item in names:
        name, project = item if isinstance(item, tuple) else (item, None)
        row = find_row(t, name, name_col)
        if row is None:
            missing.append("%s: no row for %s" % (label, name))
            continue
        if len(row) != len(t["header"]):
            missing.append("%s: row for %s has %d cells, expected %d" % (label, name, len(row), len(t["header"])))
            continue
        if not row[oi].strip():
            missing.append("%s: owner product of %s is empty" % (label, name))
        if project is not None:
            pi = t["header"].index(project_col) if project_col in t["header"] else None
            if pi is None or row[pi].strip() != project:
                missing.append("%s: row for %s does not name project %s" % (label, name, project))


if "ACTIVE-CLAIMS" not in text:
    missing.append("the text ACTIVE-CLAIMS")
for w in WORDS:
    if w.lower() not in text.lower():
        missing.append("resource word '%s'" % w)

# Section 3: every shared resource row has an owner product.
t3 = table_under(r"^## 3\.")
if t3 is None or owner_index(t3) is None or not t3["rows"]:
    missing.append("section 3: shared resources table with an 'Owner product' column")
else:
    oi = owner_index(t3)
    for r in t3["rows"]:
        if len(r) != len(t3["header"]) or not r[oi].strip():
            missing.append("section 3: row '%s' has no owner product" % (r[1] if len(r) > 1 else r[0] if r else "?"))

check_named_rows(r"^### 4a", "section 4a", EXT_VERDIAN, "extension")
check_named_rows(r"^### 4b", "section 4b", EXT_PROJEXA, "extension")
check_named_rows(r"^## 5\.", "section 5", CRON_JOBS, "jobname")
check_named_rows(r"^## 6\.", "section 6", EDGE_FUNCTIONS, "slug", project_col="project")

# Rule R1: four actions recorded in ACTIVE-CLAIMS before they are made.
r1 = None
for n, line in enumerate(lines):
    if re.match(r"^R1\.", line):
        r1 = n
        break
if r1 is None:
    missing.append("rule R1")
else:
    block = [lines[r1]]
    for nxt in lines[r1 + 1:]:
        if not nxt.startswith("- "):
            if nxt.strip() == "" and len(block) == 1:
                continue
            break
        block.append(nxt)
    joined = "\n".join(block)
    if "ai-os/boss/ACTIVE-CLAIMS.yaml" not in lines[r1]:
        missing.append("rule R1 does not name ai-os/boss/ACTIVE-CLAIMS.yaml")
    if not re.search(r"\bbefore\b", lines[r1], re.IGNORECASE):
        missing.append("rule R1 does not say the claim comes before the action")
    for label, pat in (("extension install or drop", r"extension"), ("SECURITY DEFINER function", r"SECURITY DEFINER"),
                       ("cron.job entry", r"cron\.job"), ("Edge Function deploy", r"Edge Function")):
        if not re.search(pat, "\n".join(block[1:])):
            missing.append("rule R1 has no bullet for: %s" % label)

# Dated table counts on the verdian-ai database row.
dated = False
for line in lines:
    if "pcrjmlpuqsbocqfwoxod" in line and re.search(r"\d[\d,]* tables\b[^|]*?\bon 20\d\d-\d\d-\d\d", line):
        dated = True
        break
if not dated:
    missing.append("a dated table count (for example '523 tables ... on 2026-09-25') on the verdian-ai database row")

if missing:
    print("BAD MISSING=%d" % len(missing))
    for item in missing:
        print("  missing: " + item)
    sys.exit(1)
print("OK MISSING=0")
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$(winpath "$SHARED_BOUNDARY_FILE")" 2>"$TMP/py.err")"
if [ "${RESULT#OK }" != "$RESULT" ]; then finish_ok "SHARED_BOUNDARY_OK ${RESULT#OK }"; fi
if [ "${RESULT#BAD }" != "$RESULT" ]; then
  FIRST="$(printf '%s\n' "$RESULT" | head -n 1)"
  printf '%s\n' "$RESULT" | tail -n +2 >&2
  finish_fail "${FIRST#BAD } (items listed above)"
fi
finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
