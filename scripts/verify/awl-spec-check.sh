#!/usr/bin/env bash
# register: BR-283
# PROJEXA-BUILD-001 phase 2 (U-44; audit UNIVERSAL_AI_WORK_LINK_SPEC_AUDIT.md defects A-01 to A-23; PMD-26): the Universal AI
# Work Link spec, ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC.md, still carries every one of the 23 audit fixes.
#
# What is checked (each failed item is one line on stderr, `MISSING <what>`, and adds 1 to `missing`):
#   1. Fix log. The section titled "Audit S02 fix log" holds one table row for each of A-01 to A-23, each id exactly once in the
#      whole file (so 23 rows in all, none outside the section). Every row has the five cells Defect, Sev (HIGH, MEDIUM or
#      LOW), What changed, Where, Test, all non-empty. `fix_rows` counts the ids whose row is present once and well formed.
#   2. OD-13 and OD-13b. Both decision-table rows exist once. OD-13's decision cell says option (a) (a product column, the live
#      VERIDIAN link untouched); OD-13b's says option (b) and names EXC-DUP-1 (audit A-05, A-06).
#   3. EXC-DUP-1. The recorded-exception row exists once with its four cells filled: what is duplicated, why it is accepted,
#      when it ends (audit A-06; owner rule 6).
#   4. Exfiltration clause (audit A-17). The warning sentence (a quoted line) says an assistant could "send this information
#      elsewhere"; threat T7 names exfiltration; manual rule 9 forbids sending project data or the address elsewhere.
#   5. Executor values (audit A-18). Finding F-12 and change C-1 both say the enum compliance.pipeline_task_executor holds the
#      three values "software, ai, person".
#   6. Cache residual (audit A-19). Threat T1 says a revoked page "may be served from cache" and that vendor fetch caches outlive
#      revocation; threat T2 says the person's browser history keeps the token URLs.
#   7. No unenforced proposal-age claim (audit A-13). The old sentence "refuse any older than 24 h" appears nowhere, and the
#      spec states that W-C proposals carry no age field and no signature.
#
# Exit 0 = nothing is missing. stdout ends with exactly:
#   AWL_SPEC fix_rows=23 missing=0
# Exit 1 = something is missing: the same line is printed last with the real numbers and the MISSING lines go to stderr.
# Exit 2 = usage error or a missing prerequisite (no python, no spec file).
# The last stderr line is `PASS BR-283` or `FAIL BR-283: <reason>`.
#
# Usage: bash scripts/verify/awl-spec-check.sh
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), SPEC_FILE (default: $PKG_DIR/UNIVERSAL_AI_WORK_LINK_SPEC.md).
set -u

ID="BR-283"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
SPEC_FILE="${SPEC_FILE:-$PKG_DIR/UNIVERSAL_AI_WORK_LINK_SPEC.md}"

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
[ -f "$SPEC_FILE" ] || finish_usage "spec file not found: $SPEC_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.py" <<'PYEOF'
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")

text = open(sys.argv[1], encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
lines = text.split("\n")
missing = []


def miss(what):
    missing.append(what)


def cells(line):
    """Cells of one markdown table row, without the outer pipes; an escaped pipe stays inside its cell."""
    inner = line.strip()
    inner = inner[1:] if inner.startswith("|") else inner
    inner = inner[:-1] if inner.endswith("|") and not inner.endswith("\\|") else inner
    return [c.strip() for c in re.split(r"(?<!\\)\|", inner)]


def rows(first_cell):
    """Table rows whose first cell is exactly first_cell: (line index, cells)."""
    out = []
    for i, line in enumerate(lines):
        if line.startswith("|"):
            cs = cells(line)
            if cs and cs[0] == first_cell:
                out.append((i, cs))
    return out


def one_row(first_cell, what):
    found = rows(first_cell)
    if not found:
        miss("%s: no table row starts with '| %s |'" % (what, first_cell))
        return None
    if len(found) > 1:
        miss("%s: %d table rows start with '| %s |', expected one" % (what, len(found), first_cell))
        return None
    return found[0][1]


# 1. fix log rows A-01 to A-23
heading = next((i for i, l in enumerate(lines) if re.match(r"#{1,6} .*Audit S02 fix log", l)), None)
if heading is None:
    miss("fix log: no heading contains 'Audit S02 fix log'")
    heading = len(lines)
ids = ["A-%02d" % n for n in range(1, 24)]
fix_rows = 0
for fid in ids:
    found = rows(fid)
    if not found:
        miss("fix log: row %s is absent" % fid)
        continue
    if len(found) > 1:
        miss("fix log: row %s appears %d times" % (fid, len(found)))
        continue
    line_no, cs = found[0]
    if line_no < heading:
        miss("fix log: row %s sits before the 'Audit S02 fix log' heading" % fid)
        continue
    if len(cs) < 5 or cs[1] not in ("HIGH", "MEDIUM", "LOW") or not all(cs[2:5]):
        miss("fix log: row %s is not five filled cells (Defect, Sev HIGH/MEDIUM/LOW, What changed, Where, Test)" % fid)
        continue
    fix_rows += 1

# 2. OD-13 and OD-13b
od13 = one_row("OD-13", "OD-13")
if od13 is not None and (len(od13) < 5 or "(a)" not in od13[-1]):
    miss("OD-13: the decision cell does not choose option (a)")
od13b = one_row("OD-13b", "OD-13b")
if od13b is not None and (len(od13b) < 5 or "(b)" not in od13b[-1] or "EXC-DUP-1" not in od13b[-1]):
    miss("OD-13b: the decision cell does not choose option (b) and name EXC-DUP-1")

# 3. EXC-DUP-1
exc = one_row("EXC-DUP-1", "EXC-DUP-1")
if exc is not None and (len(exc) < 4 or not all(exc[1:4])):
    miss("EXC-DUP-1: the recorded-exception row lacks what is duplicated, why it is accepted, or when it ends")

# 4. exfiltration clause
if not any(re.match(r"\s*>", l) and "send this information elsewhere" in l for l in lines):
    miss("exfiltration: no quoted warning sentence contains 'send this information elsewhere'")
t7 = one_row("T7", "exfiltration (threat T7)")
if t7 is not None and not any("xfiltration" in c for c in t7):
    miss("exfiltration: threat T7 does not name exfiltration")
if not re.search(r"(?m)^\s*9\.\s+.*Never send", text):
    miss("exfiltration: manual rule 9 ('Never send ...') is absent")

# 5. three executor values
for label, first in (("F-12", "F-12"), ("C-1", "C-1")):
    row = one_row(first, "executor values (%s)" % label)
    if row is not None:
        joined = " ".join(row)
        if "software, ai, person" not in joined:
            miss("executor values: row %s does not list 'software, ai, person'" % label)
        if first == "F-12" and "pipeline_task_executor" not in joined:
            miss("executor values: row F-12 does not name compliance.pipeline_task_executor")

# 6. cache residual
t1 = one_row("T1", "cache residual (threat T1)")
if t1 is not None:
    joined = " ".join(t1)
    if "served from cache" not in joined:
        miss("cache residual: threat T1 does not say a revoked page may be 'served from cache'")
    if "outlive revocation" not in joined:
        miss("cache residual: threat T1 does not say vendor fetch caches 'outlive revocation'")
t2 = one_row("T2", "cache residual (threat T2)")
if t2 is not None and "browser history" not in " ".join(t2):
    miss("cache residual: threat T2 does not mention the person's browser history")

# 7. no unenforced proposal-age claim
if "refuse any older than 24 h" in text:
    miss("proposal age: the unenforced sentence 'refuse any older than 24 h' is present")
if "W-C proposals carry no age field" not in text:
    miss("proposal age: the spec does not state that 'W-C proposals carry no age field'")

for item in missing:
    print("MISSING " + item)
print("SUMMARY fix_rows=%d missing=%d" % (fix_rows, len(missing)))
sys.exit(1 if missing else 0)
PYEOF

"$PY" "$(winpath "$TMP/check.py")" "$(winpath "$SPEC_FILE")" >"$TMP/out" 2>"$TMP/py.err"
RC=$?

if [ "$RC" -gt 1 ] || ! grep -q '^SUMMARY ' "$TMP/out"; then
  finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null | tr '\n' ' ')"
fi
grep '^MISSING ' "$TMP/out" | tr -d '\r' | sed 's/^MISSING /  missing: /' >&2
LINE="AWL_SPEC $(grep -m1 '^SUMMARY ' "$TMP/out" | tr -d '\r' | sed 's/^SUMMARY //')"

if [ "$RC" -eq 0 ]; then finish_ok "$LINE"; fi
printf '%s\n' "$LINE"
finish_fail "the spec lacks at least one audit fix (see the missing lines above)"
