#!/usr/bin/env bash
# Self-test for the nine PROJEXA-BUILD-001 phase 1 verify scripts (BR-110, BR-115, BR-116, BR-120, BR-121, BR-122, BR-125,
# BR-126, BR-127, BR-140). Each script gets positive cases on a temporary copy of the real package files and negative cases on
# deliberately broken copies. A positive case passes only when the script exits 0 and prints exactly the line the register row
# states. A negative case passes only when the script exits with the expected non-zero code (1 for a failed check, 2 for a usage
# or prerequisite problem) and does not print an OK line.
#
# Exit 0 and a final line `PASS run-phase1-selftest ...` only when every positive passed and every negative failed as required.
# Exit 1 and `FAIL run-phase1-selftest ...` otherwise. Exit 2 when the source files cannot be found.
#
# No positive or negative case writes to GitHub, Vercel, Supabase or Google Drive. The network-free cases use saved fixtures
# built from the package itself: a synthetic projexa tree, a synthetic route list, vercel.json files, a live-id list, stubs for
# vercel, rclone and gitleaks. The stubs prove the scripts' logic; only --live runs the real tools.
#
# Usage: bash scripts/verify/run-phase1-selftest.sh [--src <package folder>] [--live]
#   --src   folder holding PROJEXA_ROUTE_SITEMAP_projexa_main.md, REQUIREMENTS_111_REGISTER.csv, CRON_PLACEMENT.csv,
#           EDGE_CANDIDATES.csv, surface_matrix.json and SHARED_BOUNDARY.md (default: PKG_DIR, else ai-os/projexa-build-001;
#           SHARED_BOUNDARY.md falls back to ai-os/SHARED_BOUNDARY.md)
#   --live  also run the real tools, read-only: gh api for the projexa tree and vercel.json, git ls-tree, `vercel usage`
#           for the day starting 2026-09-24T07:00:00Z (expects 0.645161 of Speed Insights Plus), and the database comparison
#           of requirements-111.sh when VERIFY_DATABASE_URL is set. The gh-based dry run of secret-scan-selftest.sh (pr mode)
#           always runs and needs a gh login token.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
V="$ROOT/scripts/verify"
SRC="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
LIVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --src)  [ $# -ge 2 ] || { echo "FAIL run-phase1-selftest: --src needs a folder" >&2; exit 2; }; SRC="$2"; shift 2 ;;
    --live) LIVE=1; shift ;;
    *) echo "FAIL run-phase1-selftest: unknown argument: $1" >&2; exit 2 ;;
  esac
done

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "FAIL run-phase1-selftest: python is not available" >&2; exit 2; }
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

FILES="PROJEXA_ROUTE_SITEMAP_projexa_main.md REQUIREMENTS_111_REGISTER.csv CRON_PLACEMENT.csv EDGE_CANDIDATES.csv surface_matrix.json"
for f in $FILES; do
  [ -f "$SRC/$f" ] || { echo "FAIL run-phase1-selftest: $SRC/$f not found (use --src)" >&2; exit 2; }
done
SB_SRC="$SRC/SHARED_BOUNDARY.md"
[ -f "$SB_SRC" ] || SB_SRC="$ROOT/ai-os/SHARED_BOUNDARY.md"
[ -f "$SB_SRC" ] || { echo "FAIL run-phase1-selftest: SHARED_BOUNDARY.md not found in $SRC or ai-os/" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
POS="$WORK/pos"
FX="$WORK/fx"
NEG="$WORK/neg"
mkdir -p "$POS" "$FX" "$NEG"

# ---------------------------------------------------------------- helper program (copies, fixtures, mutations)
cat > "$WORK/mutate.py" <<'PYEOF'
import csv
import io
import json
import os
import re
import sys

F_SITEMAP = "PROJEXA_ROUTE_SITEMAP_projexa_main.md"
F_REQ = "REQUIREMENTS_111_REGISTER.csv"
F_CRON = "CRON_PLACEMENT.csv"
F_EDGE = "EDGE_CANDIDATES.csv"
F_SURFACE = "surface_matrix.json"
F_SB = "SHARED_BOUNDARY.md"


def rd(d, name):
    return open(os.path.join(d, name), encoding="utf-8", newline="").read()


def wr(d, name, text):
    open(os.path.join(d, name), "w", encoding="utf-8", newline="\n").write(text)


def read_csv(d, name):
    return list(csv.reader(io.StringIO(rd(d, name))))


def write_csv(d, name, rows):
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    wr(d, name, buf.getvalue())


def table_counts(lines, title_re, first_cell):
    counts = {}
    inside = False
    for line in lines:
        if re.match(title_re, line):
            inside = True
            continue
        if inside and line.startswith("#"):
            break
        if inside and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if re.fullmatch(r":?-{3,}:?", cells[0]) or cells[0] == first_cell:
                continue
            counts[cells[0]] = int(cells[1])
    return counts


def copy_normalised(src, dst, files):
    os.makedirs(dst, exist_ok=True)
    for name in files:
        text = open(os.path.join(src, name), encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
        wr(dst, name, text)


def make_fixtures(pkg, fx):
    os.makedirs(fx, exist_ok=True)
    lines = rd(pkg, F_SITEMAP).split("\n")
    t1 = table_counts(lines, r"# TABLE 1 ", "module")
    t2 = table_counts(lines, r"# TABLE 2 ", "ct_module")
    tree = []
    for mod, n in t1.items():
        tree.append({"type": "blob", "path": "src/app/api/%s/route.ts" % mod})
        for k in range(1, n):
            tree.append({"type": "blob", "path": "src/app/api/%s/sub%d/route.ts" % (mod, k)})
    tree.append({"type": "blob", "path": "src/app/api/other/notaroute.ts"})
    tree.append({"type": "tree", "path": "src/app/api"})
    wr(fx, "px_tree.json", json.dumps({"sha": "0" * 40, "truncated": False, "tree": tree}))
    ct = []
    for mod, n in t2.items():
        ct.append("src/app/api/v1/projexa/%s/route.ts" % mod)
        for k in range(1, n):
            ct.append("src/app/api/v1/projexa/%s/sub%d/route.ts" % (mod, k))
    ct.append("src/app/api/v1/other/route.ts")
    wr(fx, "ct_list.txt", "\n".join(ct) + "\n")
    ids = [r[0] for r in read_csv(pkg, F_REQ)[1:] if r]
    wr(fx, "live_ids.txt", "\n".join(ids) + "\n")
    rows = read_csv(pkg, F_CRON)
    hdr = rows[0]
    ip, ir = hdr.index("path_or_name"), hdr.index("repo")
    per = {"compliance-tracker": [], "projexa": []}
    for r in rows[1:]:
        if r and r[ip].startswith("vercel.json cron "):
            per[r[ir]].append({"path": r[ip][len("vercel.json cron "):].strip(), "schedule": "0 0 * * *"})
    wr(fx, "ct_vercel.json", json.dumps({"crons": per["compliance-tracker"]}))
    wr(fx, "px_vercel.json", json.dumps({"crons": per["projexa"]}))


def make_usage(out, day, cost, from_override, empty):
    import datetime
    y, m, dd = [int(x) for x in day.split("-")]
    d0 = datetime.date(y, m, dd)
    d1 = d0 + datetime.timedelta(days=1)
    start = from_override or "%sT07:00:00.000Z" % d0.isoformat()
    services = [] if empty else [
        {"name": "Pro", "pricingQuantity": 0.6451612903225806, "pricingUnit": "USD", "effectiveCost": 0.6451612903225806, "billedCost": 0.6451612903225806},
        {"name": "Speed Insights Plus Events", "pricingQuantity": 0, "pricingUnit": "USD", "effectiveCost": 0, "billedCost": 0},
    ]
    if cost != "none" and not empty:
        c = json.loads(cost)
        services.insert(0, {"name": "Speed Insights Plus", "pricingQuantity": c, "pricingUnit": "USD", "effectiveCost": c, "billedCost": c})
    doc = {"period": {"from": start, "to": "%sT07:00:00.000Z" % d1.isoformat()}, "context": "veridian-ai-os", "pricingUnit": "USD", "services": services}
    open(out, "w", encoding="utf-8", newline="\n").write(json.dumps(doc))


# ---- mutations: each edits the copy in directory d
def sitemap_route_count(d):
    t = rd(d, F_SITEMAP)
    wr(d, F_SITEMAP, re.sub(r"^route_count: (\d+)$", lambda m: "route_count: %d" % (int(m.group(1)) + 1), t, count=1, flags=re.M))


def sitemap_header_order(d):
    lines = rd(d, F_SITEMAP).split("\n")
    lines[3], lines[4] = lines[4], lines[3]
    wr(d, F_SITEMAP, "\n".join(lines))


def sitemap_ct_title(d):
    t = rd(d, F_SITEMAP)
    wr(d, F_SITEMAP, re.sub(r"\((\d+) routes / (\d+) modules\)", lambda m: "(%d routes / %s modules)" % (int(m.group(1)) + 1, m.group(2)), t, count=1))


def sitemap_table_row(d):
    lines = rd(d, F_SITEMAP).split("\n")
    seen_title = False
    for i, line in enumerate(lines):
        if line.startswith("# TABLE 1 "):
            seen_title = True
            continue
        if seen_title and line.startswith("| ") and not line.startswith("| module") and not line.startswith("|---"):
            cells = line.strip().strip("|").split("|")
            cells[1] = " %d " % (int(cells[1]) + 1)
            lines[i] = "|" + "|".join(cells) + "|"
            break
    wr(d, F_SITEMAP, "\n".join(lines))


def tree_extra(d):
    doc = json.loads(rd(d, "px_tree.json"))
    doc["tree"].append({"type": "blob", "path": "src/app/api/access-review/extra/route.ts"})
    wr(d, "px_tree.json", json.dumps(doc))


def ct_drop(d):
    lines = [l for l in rd(d, "ct_list.txt").split("\n") if l]
    idx = next(i for i, l in enumerate(lines) if l.endswith("/route.ts") and "v1/projexa" in l)
    del lines[idx]
    wr(d, "ct_list.txt", "\n".join(lines) + "\n")


def req_drop_exc31(d):
    rows = read_csv(d, F_REQ)
    write_csv(d, F_REQ, [r for r in rows if not (r and r[0] == "EXC-ITEM-31")])


def req_dup_id(d):
    rows = read_csv(d, F_REQ)
    rows[-1][0] = "R-01"
    write_csv(d, F_REQ, rows)


def req_gap_ref(d):
    rows = read_csv(d, F_REQ)
    rows[1][6] = rows[1][6] + " see platform.sumeet_gap"
    write_csv(d, F_REQ, rows)


def req_meta_off(d):
    rows = read_csv(d, F_REQ)
    for r in rows:
        if r and r[0] == "EXC-ITEM-30":
            r[2] = r[2].replace("(META)", "").rstrip()
    write_csv(d, F_REQ, rows)


def req_bad_id(d):
    rows = read_csv(d, F_REQ)
    rows[1][0] = "r-01"
    write_csv(d, F_REQ, rows)


def live_missing(d):
    ids = [l for l in rd(d, "live_ids.txt").split("\n") if l]
    wr(d, "live_ids.txt", "\n".join(ids[:-1]) + "\n")


def live_extra(d):
    wr(d, "live_ids.txt", rd(d, "live_ids.txt") + "R-999\n")


def cron_bad_value(d):
    rows = read_csv(d, F_CRON)
    ic = rows[0].index("classification")
    rows[1][ic] = "MAYBE"
    write_csv(d, F_CRON, rows)


def cron_suffix(d):
    rows = read_csv(d, F_CRON)
    ic = rows[0].index("classification")
    for r in rows[1:]:
        if r[ic] == "GITHUB_ACTIONS":
            r[ic] = "GITHUB_ACTIONS (existing)"
            break
    write_csv(d, F_CRON, rows)


def cron_drop_row(d):
    rows = read_csv(d, F_CRON)
    ip = rows[0].index("path_or_name")
    idx = next(i for i, r in enumerate(rows) if i > 0 and r[ip].startswith("vercel.json cron "))
    del rows[idx]
    write_csv(d, F_CRON, rows)


def cron_no_placed(d):
    rows = read_csv(d, F_CRON)
    ic = rows[0].index("classification")
    for r in rows[1:]:
        if r[ic] in ("PG_CRON", "EDGE_FN_VIA_PG_CRON"):
            r[ic] = "GITHUB_ACTIONS"
    write_csv(d, F_CRON, rows)


def px_extra_cron(d):
    doc = json.loads(rd(d, "px_vercel.json"))
    doc["crons"].append({"path": "/api/internal/new-cron/run", "schedule": "0 1 * * *"})
    wr(d, "px_vercel.json", json.dumps(doc))


def ct_drop_cron(d):
    doc = json.loads(rd(d, "ct_vercel.json"))
    doc["crons"].pop()
    wr(d, "ct_vercel.json", json.dumps(doc))


def edge_bad_class(d):
    rows = read_csv(d, F_EDGE)
    rows[1][rows[0].index("classification")] = "KEEP"
    write_csv(d, F_EDGE, rows)


def edge_lower(d):
    rows = read_csv(d, F_EDGE)
    ic = rows[0].index("classification")
    rows[2][ic] = rows[2][ic].lower()
    write_csv(d, F_EDGE, rows)


def edge_empty_reason(d):
    rows = read_csv(d, F_EDGE)
    rows[3][rows[0].index("reason")] = "  "
    write_csv(d, F_EDGE, rows)


def edge_header_only(d):
    rows = read_csv(d, F_EDGE)
    write_csv(d, F_EDGE, rows[:1])


def replace_all(d, name, old, new):
    t = rd(d, name)
    assert old in t, "text to replace is not in the file: " + old
    wr(d, name, t.replace(old, new))


def sb_no_cron(d):
    replace_all(d, F_SB, "dpdp-legal-clocks", "dpdp-legal-xxxxxx")


def sb_no_claims(d):
    replace_all(d, F_SB, "ACTIVE-CLAIMS", "ACTIVE-XXXXXX")


def sb_no_dated_count(d):
    replace_all(d, F_SB, " on 2026-09-25 per A09 s5", " per A09 s5")


def sb_drop_line(d, prefix):
    lines = rd(d, F_SB).split("\n")
    kept = [l for l in lines if not l.startswith(prefix)]
    assert len(kept) < len(lines), "no line starts with " + prefix
    wr(d, F_SB, "\n".join(kept))


def sb_no_edge_row(d):
    sb_drop_line(d, "| mint-session-r33 |")


def sb_no_ext_row(d):
    sb_drop_line(d, "| pg_trgm |")


def sb_empty_owner(d):
    lines = rd(d, F_SB).split("\n")
    for i, l in enumerate(lines):
        if l.startswith("| orchestrator |"):
            cells = l.strip().strip("|").split("|")
            cells[8] = " "
            lines[i] = "|" + "|".join(cells) + "|"
            break
    else:
        raise AssertionError("no orchestrator row")
    wr(d, F_SB, "\n".join(lines))


def sb_wrong_project(d):
    lines = rd(d, F_SB).split("\n")
    for i, l in enumerate(lines):
        if l.startswith("| mint-session-r33 |"):
            lines[i] = l.replace("| PROJEXA |", "| verdian-ai |", 1)
            break
    wr(d, F_SB, "\n".join(lines))


def load_matrix(d):
    return json.loads(rd(d, F_SURFACE))


def save_matrix(d, doc):
    wr(d, F_SURFACE, json.dumps(doc, indent=1))


def sm_proven(d):
    doc = load_matrix(d)
    doc["cells"][5]["status"] = "proven"
    save_matrix(d, doc)


def sm_missing_key(d):
    doc = load_matrix(d)
    del doc["cells"][7]["verify_command"]
    save_matrix(d, doc)


def sm_empty_vc(d):
    doc = load_matrix(d)
    doc["cells"][8]["verify_command"] = "  "
    save_matrix(d, doc)


def sm_27_cells(d):
    doc = load_matrix(d)
    doc["cells"].pop()
    save_matrix(d, doc)


def sm_dup_pair(d):
    doc = load_matrix(d)
    doc["cells"][1]["surface"] = doc["cells"][0]["surface"]
    save_matrix(d, doc)


def sm_type_order(d):
    doc = load_matrix(d)
    t = doc["record_types"]
    t[0], t[1] = t[1], t[0]
    save_matrix(d, doc)


def sm_exception_null(d):
    doc = load_matrix(d)
    doc["record_type_tables"]["exception"] = None
    save_matrix(d, doc)


def sm_exception_table(d):
    doc = load_matrix(d)
    doc["record_type_tables"]["exception"] = "compliance.construction_exceptions"
    save_matrix(d, doc)


def sm_type_missing(d):
    doc = load_matrix(d)
    doc["record_types"].remove("punch_list")
    del doc["record_type_tables"]["punch_list"]
    save_matrix(d, doc)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "pos":
        copy_normalised(sys.argv[2], sys.argv[3], [F_SITEMAP, F_REQ, F_CRON, F_EDGE, F_SURFACE])
    elif mode == "fixtures":
        make_fixtures(sys.argv[2], sys.argv[3])
    elif mode == "usage":
        make_usage(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != "-" else "", len(sys.argv) > 6 and sys.argv[6] == "empty")
    else:
        globals()[mode](sys.argv[2])
PYEOF

MUT="$(winpath "$WORK/mutate.py")"
"$PY" "$MUT" pos "$(winpath "$SRC")" "$(winpath "$POS")" || { echo "FAIL run-phase1-selftest: could not copy the package files" >&2; exit 2; }
"$PY" - "$(winpath "$SB_SRC")" "$(winpath "$POS")" <<'PYEOF' || { echo "FAIL run-phase1-selftest: could not copy SHARED_BOUNDARY.md" >&2; exit 2; }
import sys, os
t = open(sys.argv[1], encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
open(os.path.join(sys.argv[2], "SHARED_BOUNDARY.md"), "w", encoding="utf-8", newline="\n").write(t)
PYEOF
"$PY" "$MUT" fixtures "$(winpath "$POS")" "$(winpath "$FX")" || { echo "FAIL run-phase1-selftest: could not build fixtures" >&2; exit 2; }

# ---------------------------------------------------------------- stubs
cat > "$WORK/stub-vercel" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_LOG:-/dev/null}"
if [ "${STUB_FAIL:-0}" = "1" ]; then exit 1; fi
if [ "$1" = "usage" ]; then cat "$STUB_USAGE_JSON"; exit 0; fi
exit 9
EOF
cat > "$WORK/stub-gitleaks" <<'EOF'
#!/usr/bin/env bash
# behaves like a scanner for the two calls the self-test makes: flags AKIA plus 16 letters anywhere in the git history
if [ "$1" = "version" ]; then echo "8.24.3"; exit 0; fi
dir=""
prev=""
for a in "$@"; do if [ "$prev" = "--source" ]; then dir="$a"; fi; prev="$a"; done
[ -n "$dir" ] || dir="${!#}"
if git -C "$dir" log -p --all 2>/dev/null | grep -Eq 'AKIA[A-Z2-7]{16}'; then exit 1; fi
exit 0
EOF
cat > "$WORK/stub-gitleaks-accept-all" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "version" ]; then echo "8.24.3"; exit 0; fi
exit 0
EOF
cat > "$WORK/stub-gitleaks-reject-all" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "version" ]; then echo "8.24.3"; exit 0; fi
exit 1
EOF
cat > "$WORK/stub-rclone" <<'EOF'
#!/usr/bin/env bash
# lists the folder in STUB_KT_DIR the way `rclone lsjson --recursive --files-only` does
[ "$1" = "lsjson" ] || exit 9
[ "${STUB_KT_MODE:-}" = "notfound" ] && exit 3
[ "${STUB_KT_MODE:-}" = "broken" ] && exit 5
python - "$STUB_KT_DIR" <<'PYEOF'
import json, os, sys
root = sys.argv[1]
rows = []
for d, _dirs, files in os.walk(root):
    for f in files:
        p = os.path.join(d, f)
        rows.append({"Path": os.path.relpath(p, root).replace(os.sep, "/"), "Name": f, "Size": os.path.getsize(p), "IsDir": False})
print(json.dumps(rows))
PYEOF
EOF
chmod +x "$WORK"/stub-* 2>/dev/null

# ---------------------------------------------------------------- case runners
N_POS=0; N_NEG=0; N_BAD=0
report_ok()  { printf 'ok   %s\n' "$1"; }
report_bad() { printf 'BAD  %s\n' "$1"; N_BAD=$((N_BAD + 1)); }

# expect_pos <label> <exact stdout> <command...>
expect_pos() {
  local label="$1" want="$2" out rc
  shift 2
  out="$("$@" 2>"$WORK/last.err")"; rc=$?
  N_POS=$((N_POS + 1))
  if [ $rc -eq 0 ] && [ "$out" = "$want" ]; then report_ok "POS $label"
  else report_bad "POS $label: exit=$rc stdout='$out' stderr='$(tail -n 2 "$WORK/last.err" | tr '\n' ' ')'"; fi
}

# expect_neg <label> <expected exit code> <command...>
expect_neg() {
  local label="$1" want="$2" out rc
  shift 2
  out="$("$@" 2>"$WORK/last.err")"; rc=$?
  N_NEG=$((N_NEG + 1))
  if [ $rc -eq "$want" ] && ! printf '%s' "$out" | grep -q '_OK '; then report_ok "NEG $label (exit $rc)"
  else report_bad "NEG $label: wanted exit $want, got exit=$rc stdout='$out' stderr='$(tail -n 2 "$WORK/last.err" | tr '\n' ' ')'"; fi
}

# expect_check <label> <true|false command...>: a plain assertion inside the harness
expect_check() {
  local label="$1"
  shift
  N_POS=$((N_POS + 1))
  if "$@"; then report_ok "POS $label"; else report_bad "POS $label"; fi
}

# broken copy of the package: mkneg <name> <mutation>  -> prints the folder
mkneg() {
  local dir="$NEG/$1"
  rm -rf "$dir"
  cp -R "$POS" "$dir"
  "$PY" "$MUT" "$2" "$(winpath "$dir")" || { echo "FAIL run-phase1-selftest: mutation $2 failed" >&2; exit 2; }
  printf '%s' "$dir"
}
# broken copy of the fixtures: mkfx <name> <mutation>
mkfx() {
  local dir="$NEG/fx_$1"
  rm -rf "$dir"
  cp -R "$FX" "$dir"
  "$PY" "$MUT" "$2" "$(winpath "$dir")" || { echo "FAIL run-phase1-selftest: mutation $2 failed" >&2; exit 2; }
  printf '%s' "$dir"
}

echo "== BR-110 sitemap.sh"
SITEMAP_LINE="SITEMAP_OK route_count=310 module_count=109 ct_table_routes=287"
expect_pos "real sitemap, synthetic trees" "$SITEMAP_LINE" env PKG_DIR="$POS" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$FX/ct_list.txt"
expect_neg "header route_count off by one" 1 env PKG_DIR="$(mkneg sitemap_rc sitemap_route_count)" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$FX/ct_list.txt"
expect_neg "header lines 4 and 5 swapped" 1 env PKG_DIR="$(mkneg sitemap_order sitemap_header_order)" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$FX/ct_list.txt"
expect_neg "table 2 title says one route more" 1 env PKG_DIR="$(mkneg sitemap_title sitemap_ct_title)" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$FX/ct_list.txt"
expect_neg "table 1 row one route more" 1 env PKG_DIR="$(mkneg sitemap_row sitemap_table_row)" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$FX/ct_list.txt"
expect_neg "projexa tree has one extra route" 1 env PKG_DIR="$POS" bash "$V/sitemap.sh" --tree-json "$(mkfx tree_extra tree_extra)/px_tree.json" --ct-list "$FX/ct_list.txt"
expect_neg "compliance-tracker list lacks one route" 1 env PKG_DIR="$POS" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$(mkfx ct_drop ct_drop)/ct_list.txt"
expect_neg "sitemap file missing" 2 env PKG_DIR="$NEG/none" bash "$V/sitemap.sh" --tree-json "$FX/px_tree.json" --ct-list "$FX/ct_list.txt"

echo "== BR-115 requirements-111.sh"
REQ_LINE="REQ111_OK exc=31 meta=3 live_missing=0 live_extra=0 gap_refs=0"
expect_pos "real file, live ids from a saved list" "$REQ_LINE" env PKG_DIR="$POS" bash "$V/requirements-111.sh" --live-ids "$FX/live_ids.txt"
expect_pos "real file, offline" "REQ111_OK exc=31 meta=3 live_missing=skipped live_extra=skipped gap_refs=0" env PKG_DIR="$POS" bash "$V/requirements-111.sh" --offline
expect_neg "EXC-ITEM-31 row removed" 1 env PKG_DIR="$(mkneg req_drop req_drop_exc31)" bash "$V/requirements-111.sh" --live-ids "$FX/live_ids.txt"
expect_neg "duplicate id" 1 env PKG_DIR="$(mkneg req_dup req_dup_id)" bash "$V/requirements-111.sh" --offline
expect_neg "a note names sumeet_gap" 1 env PKG_DIR="$(mkneg req_gap req_gap_ref)" bash "$V/requirements-111.sh" --offline
expect_neg "EXC-ITEM-30 loses its META mark" 1 env PKG_DIR="$(mkneg req_meta req_meta_off)" bash "$V/requirements-111.sh" --offline
expect_neg "id in the wrong form" 1 env PKG_DIR="$(mkneg req_badid req_bad_id)" bash "$V/requirements-111.sh" --offline
expect_neg "live table lacks one id" 1 env PKG_DIR="$POS" bash "$V/requirements-111.sh" --live-ids "$(mkfx live_missing live_missing)/live_ids.txt"
expect_neg "live table has one extra id" 1 env PKG_DIR="$POS" bash "$V/requirements-111.sh" --live-ids "$(mkfx live_extra live_extra)/live_ids.txt"
expect_neg "default mode without a connection string" 2 env -u VERIFY_DATABASE_URL PKG_DIR="$POS" bash "$V/requirements-111.sh"

echo "== BR-116 vercel-billing-day.sh"
mkusage() { "$PY" "$MUT" usage "$(winpath "$WORK/$1.json")" "$2" "$3" "${4:--}" "${5:-}"; }
mkusage u_zero 2026-09-20 none
mkusage u_cost 2026-09-24 0.6451612903225806
mkusage u_from 2026-09-24 0.6451612903225806 2026-09-24T08:00:00.000Z
mkusage u_empty 2026-09-24 none - empty
BILL_ENV=(env VERCEL_BIN="$WORK/stub-vercel" STUB_LOG="$WORK/vercel.log")
: > "$WORK/vercel.log"
expect_pos "day with no Speed Insights Plus row, expectation 0" "0.0000" "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_zero.json" bash "$V/vercel-billing-day.sh" 2026-09-20T07:00:00Z "Speed Insights Plus"
expect_check "one CLI call, no mutating verb" bash -c "[ \"\$(wc -l < '$WORK/vercel.log' | tr -d ' ')\" = 1 ] && grep -q '^usage ' '$WORK/vercel.log' && ! grep -Eqi 'post|put|patch|delete' '$WORK/vercel.log'"
expect_pos "0.645161 with --expect 0.645161 --precision 6" "0.645161" "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_cost.json" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z --expect 0.645161 --precision 6
expect_pos "0.645161 within tolerance 0.000005" "0.645161" "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_cost.json" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z "Speed Insights Plus" --expect 0.645161 --precision 6 --tolerance 0.000005
expect_neg "0.6452 against the default expectation 0" 1 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_cost.json" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z "Speed Insights Plus"
expect_neg "expectation off by 0.00001 at 6 decimals" 1 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_cost.json" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z --expect 0.645171 --precision 6
expect_neg "response window starts at 08:00Z" 1 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_from.json" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z --expect 0.645161 --precision 6
expect_neg "response has no billing rows" 1 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_empty.json" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z
expect_neg "start is not 07:00:00Z" 2 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_zero.json" bash "$V/vercel-billing-day.sh" 2026-09-20T00:00:00Z
expect_neg "multi-day window refused" 2 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_zero.json" bash "$V/vercel-billing-day.sh" 2026-09-20T07:00:00Z --end 2026-09-22T07:00:00Z
expect_neg "day that has not begun refused" 2 "${BILL_ENV[@]}" STUB_USAGE_JSON="$WORK/u_zero.json" bash "$V/vercel-billing-day.sh" 2099-01-01T07:00:00Z
expect_neg "CLI fails" 2 "${BILL_ENV[@]}" STUB_FAIL=1 STUB_USAGE_JSON="$WORK/u_zero.json" bash "$V/vercel-billing-day.sh" 2026-09-20T07:00:00Z

echo "== BR-120 secret-scan-selftest.sh"
expect_pos "local mode, stub scanner that flags AKIA keys" "SECRET_SCAN_SELFTEST_OK planted=rejected clean=accepted" env GITLEAKS_BIN="$WORK/stub-gitleaks" bash "$V/secret-scan-selftest.sh"
expect_pos "local dry run" "SECRET_SCAN_SELFTEST_PREREQS_OK mode=local" env GITLEAKS_BIN="$WORK/stub-gitleaks" bash "$V/secret-scan-selftest.sh" --dry-run
expect_pos "pr mode dry run (real workflow file, gh login)" "SECRET_SCAN_SELFTEST_PREREQS_OK mode=pr" bash "$V/secret-scan-selftest.sh" --mode pr --dry-run
expect_neg "scanner accepts everything (planted key accepted)" 1 env GITLEAKS_BIN="$WORK/stub-gitleaks-accept-all" bash "$V/secret-scan-selftest.sh"
expect_neg "scanner rejects everything (clean commit rejected)" 1 env GITLEAKS_BIN="$WORK/stub-gitleaks-reject-all" bash "$V/secret-scan-selftest.sh"
expect_neg "scanner program not found" 2 env GITLEAKS_BIN="$WORK/no-such-scanner" bash "$V/secret-scan-selftest.sh"
sed 's/^  secret-scan:/  secret-scanning-renamed:/' "$ROOT/.github/workflows/sentinel.yml" > "$WORK/sentinel-nojob.yml"
sed 's/name: Secret Scanning/name: Secret Scan/' "$ROOT/.github/workflows/sentinel.yml" > "$WORK/sentinel-noname.yml"
expect_neg "workflow has no secret-scan job" 1 env WORKFLOW_FILE="$WORK/sentinel-nojob.yml" bash "$V/secret-scan-selftest.sh" --mode pr --dry-run
expect_neg "job is not named Secret Scanning" 1 env WORKFLOW_FILE="$WORK/sentinel-noname.yml" bash "$V/secret-scan-selftest.sh" --mode pr --dry-run
expect_neg "pr mode without --yes writes nothing and stops" 2 bash "$V/secret-scan-selftest.sh" --mode pr

echo "== BR-121 cron-placement.sh"
CRON_LINE="CRON_PLACEMENT_OK vercel_rows=30 bad_enum=0"
CRON_ENV=(env CT_VERCEL_JSON="$FX/ct_vercel.json" PX_VERCEL_JSON="$FX/px_vercel.json")
expect_pos "real file, vercel.json fixtures" "$CRON_LINE" "${CRON_ENV[@]}" PKG_DIR="$POS" bash "$V/cron-placement.sh"
expect_neg "a classification outside the enum" 1 "${CRON_ENV[@]}" PKG_DIR="$(mkneg cron_bad cron_bad_value)" bash "$V/cron-placement.sh"
expect_neg "a suffixed value" 1 "${CRON_ENV[@]}" PKG_DIR="$(mkneg cron_suffix cron_suffix)" bash "$V/cron-placement.sh"
expect_neg "a Vercel cron row removed (29 rows)" 1 "${CRON_ENV[@]}" PKG_DIR="$(mkneg cron_drop cron_drop_row)" bash "$V/cron-placement.sh"
expect_neg "no PG_CRON or EDGE_FN_VIA_PG_CRON row" 1 "${CRON_ENV[@]}" PKG_DIR="$(mkneg cron_none cron_no_placed)" bash "$V/cron-placement.sh"
expect_neg "projexa vercel.json has a cron with no row" 1 env CT_VERCEL_JSON="$FX/ct_vercel.json" PX_VERCEL_JSON="$(mkfx px_extra px_extra_cron)/px_vercel.json" PKG_DIR="$POS" bash "$V/cron-placement.sh"
expect_neg "a row is not a cron in vercel.json" 1 env CT_VERCEL_JSON="$(mkfx ct_dropc ct_drop_cron)/ct_vercel.json" PX_VERCEL_JSON="$FX/px_vercel.json" PKG_DIR="$POS" bash "$V/cron-placement.sh"

echo "== BR-122 edge-candidates.sh"
expect_pos "real file" "EDGE_CANDIDATES_OK rows=35 bad=0" env PKG_DIR="$POS" bash "$V/edge-candidates.sh"
expect_neg "a classification outside the enum" 1 env PKG_DIR="$(mkneg edge_bad edge_bad_class)" bash "$V/edge-candidates.sh"
expect_neg "a lower-case classification" 1 env PKG_DIR="$(mkneg edge_low edge_lower)" bash "$V/edge-candidates.sh"
expect_neg "an empty reason" 1 env PKG_DIR="$(mkneg edge_reason edge_empty_reason)" bash "$V/edge-candidates.sh"
expect_neg "header only, no rows" 1 env PKG_DIR="$(mkneg edge_hdr edge_header_only)" bash "$V/edge-candidates.sh"
expect_neg "file missing" 2 env PKG_DIR="$NEG/none" bash "$V/edge-candidates.sh"

echo "== BR-125 shared-boundary.sh"
SB_ENV() { printf '%s' "$1/SHARED_BOUNDARY.md"; }
expect_pos "real file" "SHARED_BOUNDARY_OK MISSING=0" env SHARED_BOUNDARY_FILE="$POS/SHARED_BOUNDARY.md" bash "$V/shared-boundary.sh"
expect_neg "a cron job name is gone" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_cron sb_no_cron)")" bash "$V/shared-boundary.sh"
expect_neg "an Edge Function row is gone" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_edge sb_no_edge_row)")" bash "$V/shared-boundary.sh"
expect_neg "an extension row is gone" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_ext sb_no_ext_row)")" bash "$V/shared-boundary.sh"
expect_neg "the claim register is not named" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_claims sb_no_claims)")" bash "$V/shared-boundary.sh"
expect_neg "an owner cell is empty" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_owner sb_empty_owner)")" bash "$V/shared-boundary.sh"
expect_neg "an Edge Function names the wrong project" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_proj sb_wrong_project)")" bash "$V/shared-boundary.sh"
expect_neg "no dated table count" 1 env SHARED_BOUNDARY_FILE="$(SB_ENV "$(mkneg sb_count sb_no_dated_count)")" bash "$V/shared-boundary.sh"
expect_neg "file missing" 2 env SHARED_BOUNDARY_FILE="$NEG/none.md" bash "$V/shared-boundary.sh"

echo "== BR-126 and BR-127 surface-matrix.sh"
expect_pos "cells, real file" "SURFACE_CELLS_OK cells=28 unproven=28" env PKG_DIR="$POS" bash "$V/surface-matrix.sh" cells
expect_pos "tables, real file" "SURFACE_TABLES_OK types=7 exception=non-null" env PKG_DIR="$POS" bash "$V/surface-matrix.sh" tables
expect_neg "cells: one cell marked proven" 1 env PKG_DIR="$(mkneg sm_proven sm_proven)" bash "$V/surface-matrix.sh" cells
expect_neg "cells: a cell has no verify_command key" 1 env PKG_DIR="$(mkneg sm_key sm_missing_key)" bash "$V/surface-matrix.sh" cells
expect_neg "cells: a verify_command is blank" 1 env PKG_DIR="$(mkneg sm_vc sm_empty_vc)" bash "$V/surface-matrix.sh" cells
expect_neg "cells: 27 cells" 1 env PKG_DIR="$(mkneg sm_27 sm_27_cells)" bash "$V/surface-matrix.sh" cells
expect_neg "cells: a (record type, surface) pair twice" 1 env PKG_DIR="$(mkneg sm_dup sm_dup_pair)" bash "$V/surface-matrix.sh" cells
expect_neg "tables: record types in another order" 1 env PKG_DIR="$(mkneg sm_order sm_type_order)" bash "$V/surface-matrix.sh" tables
expect_neg "tables: exception maps to null" 1 env PKG_DIR="$(mkneg sm_null sm_exception_null)" bash "$V/surface-matrix.sh" tables
expect_neg "tables: exception maps to a new table" 1 env PKG_DIR="$(mkneg sm_newtable sm_exception_table)" bash "$V/surface-matrix.sh" tables
expect_neg "tables: a record type is missing" 1 env PKG_DIR="$(mkneg sm_gone sm_type_missing)" bash "$V/surface-matrix.sh" tables
expect_neg "no mode given" 2 env PKG_DIR="$POS" bash "$V/surface-matrix.sh"
expect_neg "unknown mode" 2 env PKG_DIR="$POS" bash "$V/surface-matrix.sh" rows

echo "== BR-140 kt-drive-plan.sh"
KT_ENV=(env RCLONE_BIN="$WORK/stub-rclone" PKG_DIR="$POS")
KT_LINE="KT_PLAN_OK missing=0 size_mismatch=0"
rm -rf "$WORK/kt_ok" "$WORK/kt_extra" "$WORK/kt_gone" "$WORK/kt_size" "$WORK/kt_empty"
cp -R "$POS" "$WORK/kt_ok"
cp -R "$POS" "$WORK/kt_extra"; mkdir -p "$WORK/kt_extra/evidence"; printf 'private note\n' > "$WORK/kt_extra/evidence/note.md"
cp -R "$POS" "$WORK/kt_gone"; rm "$WORK/kt_gone/CRON_PLACEMENT.csv"
cp -R "$POS" "$WORK/kt_size"; printf 'x' >> "$WORK/kt_size/EDGE_CANDIDATES.csv"
mkdir -p "$WORK/kt_empty"
expect_pos "Drive folder equals the package" "$KT_LINE" "${KT_ENV[@]}" STUB_KT_DIR="$WORK/kt_ok" bash "$V/kt-drive-plan.sh"
expect_pos "Drive folder has extra files" "$KT_LINE" "${KT_ENV[@]}" STUB_KT_DIR="$WORK/kt_extra" bash "$V/kt-drive-plan.sh"
expect_neg "a file is missing in Drive" 1 "${KT_ENV[@]}" STUB_KT_DIR="$WORK/kt_gone" bash "$V/kt-drive-plan.sh"
expect_neg "a file is one byte larger in Drive" 1 "${KT_ENV[@]}" STUB_KT_DIR="$WORK/kt_size" bash "$V/kt-drive-plan.sh"
expect_neg "Drive folder is empty" 1 "${KT_ENV[@]}" STUB_KT_DIR="$WORK/kt_empty" bash "$V/kt-drive-plan.sh"
expect_neg "Drive folder does not exist" 1 "${KT_ENV[@]}" STUB_KT_MODE=notfound STUB_KT_DIR="$WORK/kt_ok" bash "$V/kt-drive-plan.sh"
expect_neg "rclone fails" 2 "${KT_ENV[@]}" STUB_KT_MODE=broken STUB_KT_DIR="$WORK/kt_ok" bash "$V/kt-drive-plan.sh"
expect_neg "local package folder missing" 2 env RCLONE_BIN="$WORK/stub-rclone" PKG_DIR="$NEG/none" STUB_KT_DIR="$WORK/kt_ok" bash "$V/kt-drive-plan.sh"

if [ "$LIVE" = "1" ]; then
  echo "== live checks (real tools, read-only)"
  expect_pos "LIVE sitemap: gh api projexa tree at main_sha, git ls-tree of this repo" "$SITEMAP_LINE" env PKG_DIR="$POS" bash "$V/sitemap.sh"
  expect_pos "LIVE cron placement: git show vercel.json, gh api projexa vercel.json" "$CRON_LINE" env PKG_DIR="$POS" bash "$V/cron-placement.sh"
  expect_pos "LIVE billing 2026-09-24T07:00:00Z = 0.645161" "0.645161" bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z --expect 0.645161 --precision 6 --tolerance 0.000005
  expect_neg "LIVE billing 2026-09-24T07:00:00Z is not 0" 1 bash "$V/vercel-billing-day.sh" 2026-09-24T07:00:00Z
  if [ -n "${VERIFY_DATABASE_URL:-}" ]; then
    expect_pos "LIVE requirements against platform.sumeet_requirements" "$REQ_LINE" env PKG_DIR="$POS" bash "$V/requirements-111.sh"
  else
    echo "note: VERIFY_DATABASE_URL is not set, so the live requirements comparison was not run"
  fi
fi

echo "----"
if [ "$N_BAD" -eq 0 ]; then
  echo "PASS run-phase1-selftest: $N_POS positive cases passed, $N_NEG negative cases failed as required"
  exit 0
fi
echo "FAIL run-phase1-selftest: $N_BAD of $((N_POS + N_NEG)) cases behaved wrongly"
exit 1
