#!/usr/bin/env bash
# BR-110 (PROJEXA-BUILD-001, phase 1): the regenerated projexa route sitemap carries a five-line provenance header
# (repo, main_sha, generated_utc, route_count, module_count on lines 1-5) and its counts equal the git tree of
# FChecklist/projexa at main_sha. The separate compliance-tracker table (Table 2) equals `git ls-tree` of this repo.
#
# Exit 0 = every comparison holds. stdout is exactly one line (numbers are the measured ones):
#   SITEMAP_OK route_count=310 module_count=109 ct_table_routes=287
# Exit 1 = a comparison failed (reasons on stderr). Exit 2 = usage error or a missing prerequisite (file, python, gh, git ref).
# The last stderr line is `PASS BR-110` or `FAIL BR-110: <reason>`.
#
# What is compared:
#   1. lines 1-5 have the five keys in order, in the expected form.
#   2. Table 1 (projexa): number of module rows = module_count, sum of the routes column = route_count.
#   3. The projexa tree at main_sha: files matching src/app/api/<module>/**/route.ts, counted per module, equal Table 1 row for row.
#   4. Table 2 (compliance-tracker): the title's "(N routes / M modules)" equals the rows, and the rows equal the
#      route.ts files under src/app/api/v1/projexa/ in the git tree of CT_REF, module by module.
#
# Usage: bash scripts/verify/sitemap.sh [--ref <sha-or-branch>] [--tree-json <file>] [--ct-list <file>]
#   --ref        projexa commit whose tree is read (default: main_sha from header line 2; `--ref main` reads the branch tip)
#   --tree-json  saved output of `gh api repos/FChecklist/projexa/git/trees/<sha>?recursive=1` (skips the network call)
#   --ct-list    saved output of `git ls-tree -r --name-only <ref>` for this repo (skips the git call)
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), SITEMAP_FILE
#   (default: $PKG_DIR/PROJEXA_ROUTE_SITEMAP_projexa_main.md), CT_REF (default: origin/main, then main, then HEAD),
#   PX_TREE_JSON and CT_TREE_LIST (same as the two file options).
set -u

ID="BR-110"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
SITEMAP_FILE="${SITEMAP_FILE:-$PKG_DIR/PROJEXA_ROUTE_SITEMAP_projexa_main.md}"

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

REF=""
TREE_JSON="${PX_TREE_JSON:-}"
CT_LIST="${CT_TREE_LIST:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)       [ $# -ge 2 ] || finish_usage "--ref needs a value";       REF="$2";       shift 2 ;;
    --tree-json) [ $# -ge 2 ] || finish_usage "--tree-json needs a value"; TREE_JSON="$2"; shift 2 ;;
    --ct-list)   [ $# -ge 2 ] || finish_usage "--ct-list needs a value";   CT_LIST="$2";   shift 2 ;;
    *) finish_usage "unknown argument: $1" ;;
  esac
done

[ -f "$SITEMAP_FILE" ] || finish_usage "sitemap file not found: $SITEMAP_FILE"
MAIN_SHA="$(sed -n '2p' "$SITEMAP_FILE" | tr -d '\r' | sed -n 's/^main_sha: \([0-9a-f]\{7,40\}\)$/\1/p')"
[ -n "$MAIN_SHA" ] || finish_fail "header line 2 is not 'main_sha: <7 to 40 hex characters>'"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -z "$TREE_JSON" ]; then
  command -v gh >/dev/null 2>&1 || finish_usage "gh is not installed and no --tree-json was given"
  TARGET="${REF:-$MAIN_SHA}"
  FULL_SHA="$(gh api "repos/FChecklist/projexa/commits/$TARGET" --jq .sha 2>/dev/null)"
  [ -n "$FULL_SHA" ] || finish_usage "gh api could not resolve the projexa commit '$TARGET'"
  gh api "repos/FChecklist/projexa/git/trees/$FULL_SHA?recursive=1" > "$TMP/tree.json" 2>/dev/null \
    || finish_usage "gh api could not read the projexa tree at $FULL_SHA"
  TREE_JSON="$TMP/tree.json"
elif [ ! -f "$TREE_JSON" ]; then
  finish_usage "tree json not found: $TREE_JSON"
fi

if [ -z "$CT_LIST" ]; then
  CT_USED=""
  for r in ${CT_REF:-origin/main main HEAD}; do
    if git -C "$ROOT" rev-parse --verify --quiet "$r^{commit}" >/dev/null 2>&1; then CT_USED="$r"; break; fi
  done
  [ -n "$CT_USED" ] || finish_usage "no compliance-tracker git ref found (tried ${CT_REF:-origin/main main HEAD})"
  git -C "$ROOT" ls-tree -r --name-only "$CT_USED" > "$TMP/ct.txt" 2>/dev/null || finish_usage "git ls-tree failed for $CT_USED"
  CT_LIST="$TMP/ct.txt"
elif [ ! -f "$CT_LIST" ]; then
  finish_usage "ct list not found: $CT_LIST"
fi

cat > "$TMP/check.py" <<'PYEOF'
import json
import re
import sys

sitemap, tree_json, ct_list = sys.argv[1], sys.argv[2], sys.argv[3]


def die(msg):
    print("BAD " + msg)
    sys.exit(1)


text = open(sitemap, encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
lines = text.split("\n")
if len(lines) < 6:
    die("the file has fewer than 6 lines")

names = ["repo", "main_sha", "generated_utc", "route_count", "module_count"]
patterns = [
    r"repo: FChecklist/projexa",
    r"main_sha: [0-9a-f]{7,40}",
    r"generated_utc: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z",
    r"route_count: (\d+)",
    r"module_count: (\d+)",
]
for i, pat in enumerate(patterns):
    if not re.fullmatch(pat, lines[i]):
        die("header line %d is not a '%s:' line in the expected form" % (i + 1, names[i]))
route_count = int(re.fullmatch(patterns[3], lines[3]).group(1))
module_count = int(re.fullmatch(patterns[4], lines[4]).group(1))


def section(title_re):
    """First heading matching title_re, and the lines up to the next line that starts with '#'."""
    for idx, line in enumerate(lines):
        if re.match(title_re, line):
            body = []
            for nxt in lines[idx + 1:]:
                if nxt.startswith("#"):
                    break
                body.append(nxt)
            return line, body
    return None, []


def table_rows(body, header_first_cell):
    out = []
    for line in body:
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if re.fullmatch(r":?-{3,}:?", cells[0]) or cells[0] == header_first_cell:
            continue
        out.append(cells)
    return out


def as_counts(rows, label, problems):
    counts = {}
    for cells in rows:
        if len(cells) < 2 or not cells[1].isdigit():
            problems.append("%s: row '%s' has no numeric route count" % (label, cells[0]))
            continue
        if cells[0] in counts:
            problems.append("%s: module '%s' appears twice" % (label, cells[0]))
        counts[cells[0]] = int(cells[1])
    return counts


def diff(a, b):
    keys = sorted(set(a) | set(b))
    return ["%s(sitemap=%s,tree=%s)" % (k, a.get(k), b.get(k)) for k in keys if a.get(k) != b.get(k)]


problems = []

# Table 1 (projexa) against the header and against the git tree.
head1, body1 = section(r"# TABLE 1 ")
if head1 is None:
    die("no '# TABLE 1' heading")
t1 = as_counts(table_rows(body1, "module"), "table 1", problems)
if len(t1) != module_count:
    problems.append("table 1 has %d module rows, header module_count is %d" % (len(t1), module_count))
if sum(t1.values()) != route_count:
    problems.append("table 1 routes add up to %d, header route_count is %d" % (sum(t1.values()), route_count))

tree = json.load(open(tree_json, encoding="utf-8"))
if tree.get("truncated"):
    die("the projexa tree response is truncated")
px = {}
for entry in tree.get("tree", []):
    if entry.get("type") != "blob":
        continue
    m = re.fullmatch(r"src/app/api/([^/]+)/(?:.+/)?route\.ts", entry.get("path", ""))
    if m:
        px[m.group(1)] = px.get(m.group(1), 0) + 1
if sum(px.values()) != route_count:
    problems.append("projexa tree has %d route.ts files, header route_count is %d" % (sum(px.values()), route_count))
if len(px) != module_count:
    problems.append("projexa tree has %d modules, header module_count is %d" % (len(px), module_count))
d1 = diff(t1, px)
if d1:
    problems.append("table 1 differs from the projexa tree in %d modules: %s" % (len(d1), ", ".join(d1[:5])))

# Table 2 (compliance-tracker) against its own title and against git ls-tree.
head2, body2 = section(r"# TABLE 2 ")
if head2 is None:
    die("no '# TABLE 2' heading")
title = re.search(r"\((\d+) routes / (\d+) modules\)", head2)
if not title:
    die("table 2 heading has no '(N routes / M modules)' part")
ct_routes, ct_modules = int(title.group(1)), int(title.group(2))
t2 = as_counts(table_rows(body2, "ct_module"), "table 2", problems)
if sum(t2.values()) != ct_routes:
    problems.append("table 2 routes add up to %d, its title says %d" % (sum(t2.values()), ct_routes))
if len(t2) != ct_modules:
    problems.append("table 2 has %d module rows, its title says %d" % (len(t2), ct_modules))
ct = {}
for line in open(ct_list, encoding="utf-8", errors="replace").read().split("\n"):
    m = re.fullmatch(r"src/app/api/v1/projexa/([^/]+)/(?:.+/)?route\.ts", line.strip())
    if m:
        ct[m.group(1)] = ct.get(m.group(1), 0) + 1
d2 = diff(t2, ct)
if d2:
    problems.append("table 2 differs from the compliance-tracker tree in %d modules: %s" % (len(d2), ", ".join(d2[:5])))

if problems:
    die("; ".join(problems[:6]))
print("OK route_count=%d module_count=%d ct_table_routes=%d" % (route_count, module_count, ct_routes))
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$(winpath "$SITEMAP_FILE")" "$(winpath "$TREE_JSON")" "$(winpath "$CT_LIST")" 2>"$TMP/py.err")"
RC=$?
if [ $RC -eq 0 ] && [ "${RESULT#OK }" != "$RESULT" ]; then
  finish_ok "SITEMAP_OK ${RESULT#OK }"
fi
if [ "${RESULT#BAD }" != "$RESULT" ]; then
  finish_fail "${RESULT#BAD }"
fi
finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
