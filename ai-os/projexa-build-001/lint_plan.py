#!/usr/bin/env python3
"""Deterministic linter for the PROJEXA-BUILD-001 plan package.

Exit 0 = every rule passes. Exit 1 = at least one FAIL line. Usage: python lint_plan.py <package_dir>
Rules implement work order section 8, REGISTER_CONVENTIONS.md and defect tests D-03, D-04, D-05, D-07, D-08,
plus the gap-closure mechanics (every finding, amendment and unified item is accounted for).
"""
import csv, json, os, re, sys

BANNED = re.compile(
    r"\b(improve[sd]?|improving|ensure[sd]?|ensuring|robust(ly|ness)?|appropriate(ly)?|properly|"
    r"handle[sd]?|handling|better|clean up|as needed|where useful|comprehensive(ly)?|seamless(ly)?)\b",
    re.IGNORECASE,
)
HEADER = ["id", "phase", "title", "source", "verify_command", "expected_output", "status", "evidence_ref", "owner_blocked"]
STATUS = {"pending", "pass", "fail", "blocked_owner"}
CMD_PREFIXES = (
    "node scripts/verify/sql-assert.mjs", "bun test --isolate", "bash scripts/verify/", 'test "$(git grep',
    'test "$(gh api', 'test "$(curl -s -o /dev/null -w', "test -f ", "test -s ", "python ai-os/projexa-build-001/lint_plan.py",
)
STRICT_FILES = ("BOOLEAN_REGISTER.csv", "MASTER_PLAN.md", "DEV_TEST_DEPLOY_PLAN.md", "AMENDMENT_LOG_BUILD-001.md",
                "OWNER_QUESTIONS.md", "SHARED_BOUNDARY.md", "PM_DECISIONS.md")
fails = []


def fail(rule, detail):
    fails.append((rule, detail))
    print("FAIL", rule, "-", detail)


def ok(rule, detail=""):
    print("PASS", rule, detail)


def read(p):
    with open(p, "r", encoding="utf-8-sig", newline="") as f:
        return f.read()


def load_csv(p):
    return list(csv.reader(read(p).splitlines()))


def check_register(d):
    p = os.path.join(d, "BOOLEAN_REGISTER.csv")
    if not os.path.isfile(p):
        fail("REG-EXISTS", "BOOLEAN_REGISTER.csv missing")
        return []
    rows = load_csv(p)
    if not rows or rows[0] != HEADER:
        fail("REG-HEADER", "header must be " + ",".join(HEADER))
        return []
    body, ids, out = rows[1:], set(), []
    bad = 0
    for n, r in enumerate(body, 2):
        if len(r) != len(HEADER):
            fail("REG-COLS", "row %d has %d columns" % (n, len(r)))
            bad += 1
            continue
        rec = dict(zip(HEADER, r))
        out.append(rec)
        i = rec["id"]
        if not re.fullmatch(r"BR-[1-5]\d\d", i):
            fail("REG-ID-FORMAT", "%s (want BR-<phase><2 digits>)" % i); bad += 1
        elif i[3] != rec["phase"]:
            fail("REG-ID-PHASE", "%s phase=%s" % (i, rec["phase"])); bad += 1
        if i in ids:
            fail("REG-UNIQUE-ID", i); bad += 1
        ids.add(i)
        if rec["phase"] not in {"1", "2", "3", "4", "5"}:
            fail("REG-PHASE", "%s phase=%r" % (i, rec["phase"])); bad += 1
        if not rec["title"].strip():
            fail("REG-TITLE", i + " empty title"); bad += 1
        if not re.search(r"\bU-\d\d\b", rec["source"]):
            fail("REG-SOURCE-UID", i + " source has no unified id U-nn"); bad += 1
        vc = rec["verify_command"].strip()
        if not vc:
            fail("REG-VERIFY-COMMAND", i + " empty verify_command"); bad += 1
        elif "\n" in rec["verify_command"]:
            fail("REG-VERIFY-ONE-LINE", i); bad += 1
        elif not vc.startswith(CMD_PREFIXES):
            fail("REG-VERIFY-FORM", "%s starts with %r, not an allowed form" % (i, vc[:40])); bad += 1
        if not rec["expected_output"].strip():
            fail("REG-EXPECTED", i + " empty expected_output"); bad += 1
        if rec["status"] not in STATUS:
            fail("REG-STATUS", "%s status=%r" % (i, rec["status"])); bad += 1
        if rec["status"] != "pending" and not rec["evidence_ref"].strip():
            fail("REG-EVIDENCE", i + " non-pending without evidence_ref"); bad += 1
        if rec["owner_blocked"] not in {"yes", "no"}:
            fail("REG-OWNER-BLOCKED", "%s value %r" % (i, rec["owner_blocked"])); bad += 1
        if (rec["status"] == "blocked_owner") != (rec["owner_blocked"] == "yes"):
            fail("REG-BLOCKED-CONSISTENT", i); bad += 1
        if re.search(r"\b(deploy|unpause|apply_migration|create_branch)\b", vc, re.I) and "verify" not in vc:
            fail("REG-FORBIDDEN-ACTION", i + " verify_command mentions a mutating action")
    if not body:
        fail("REG-NONEMPTY", "no rows")
    elif bad == 0:
        ok("D-03 every row has runnable verify_command", "%d rows" % len(body))
    # gates
    for ph in "12345":
        pr = [r for r in out if r["phase"] == ph]
        ent = sum(1 for r in pr if r["title"].startswith("[ENTRY]"))
        ext = sum(1 for r in pr if r["title"].startswith("[EXIT]"))
        if ent >= 1 and ext >= 3:
            ok("D-04 phase %s gates" % ph, "entry=%d exit=%d rows=%d" % (ent, ext, len(pr)))
        else:
            fail("D-04 phase %s gates" % ph, "entry=%d (>=1) exit=%d (>=3)" % (ent, ext))
    return out


def check_coverage(d, reg):
    mm = os.path.join(d, "MERGE_MAP.md")
    src_all = " ".join(r["source"] for r in reg)
    plan = read(os.path.join(d, "MASTER_PLAN.md")) if os.path.isfile(os.path.join(d, "MASTER_PLAN.md")) else ""
    if os.path.isfile(mm):
        uids = sorted(set(re.findall(r"\|\s*(U-\d\d)\s*\|", read(mm))))
        missing = [u for u in uids if u not in src_all]
        if missing:
            fail("U-COVERAGE", "unified items with no register row: " + ",".join(missing))
        else:
            ok("U-COVERAGE", "%d unified items all present in register sources" % len(uids))
    else:
        fail("U-COVERAGE", "MERGE_MAP.md missing")
    gm = os.path.join(d, "gaps_master.json")
    if os.path.isfile(gm):
        g = json.load(open(gm, encoding="utf-8"))
        miss = [f["id"] for f in g["findings"] if f["id"] not in src_all and f["id"] not in plan]
        if miss:
            fail("GAP-COVERAGE", "%d findings unaccounted for (not in register sources or MASTER_PLAN): %s" % (len(miss), ",".join(miss[:12]) + ("..." if len(miss) > 12 else "")))
        else:
            ok("GAP-COVERAGE", "%d of %d findings accounted for" % (len(g["findings"]), len(g["findings"])))
        al = os.path.join(d, "AMENDMENT_LOG_BUILD-001.md")
        altxt = read(al) if os.path.isfile(al) else ""
        missm = [a["id"] for a in g["amendments"] if a["id"] not in altxt]
        if missm:
            fail("AMEND-COVERAGE", "%d amendments not in AMENDMENT_LOG: %s" % (len(missm), ",".join(missm[:12]) + ("..." if len(missm) > 12 else "")))
        else:
            ok("AMEND-COVERAGE", "%d of %d agent amendments accounted for" % (len(g["amendments"]), len(g["amendments"])))
    else:
        fail("GAP-COVERAGE", "gaps_master.json missing")


def check_amendment_log(d):
    p = os.path.join(d, "AMENDMENT_LOG_BUILD-001.md")
    if not os.path.isfile(p):
        fail("AMEND-EXISTS", "AMENDMENT_LOG_BUILD-001.md missing"); return
    rows = [l for l in read(p).splitlines() if re.match(r"\|\s*AM-\d+", l)]
    bad = 0
    for l in rows:
        cells = [c.strip() for c in l.strip().strip("|").split("|")]
        if len(cells) < 7:
            fail("AMEND-COLS", l[:60]); bad += 1; continue
        _id, action, target, reason, evidence, btest, srcs = cells[:7]
        if action not in {"ADD", "DELETE", "EDIT", "REJECT"}:
            fail("AMEND-ACTION", "%s action=%r" % (_id, action)); bad += 1
        if not evidence or evidence in {"-", "n/a", "none"}:
            fail("AMEND-EVIDENCE", _id + " empty evidence"); bad += 1
        if action in {"ADD", "EDIT"} and not btest:
            fail("AMEND-BOOLEAN-TEST", _id + " ADD/EDIT without boolean_test"); bad += 1
    if not rows:
        fail("AMEND-ROWS", ">=1 row required")
    elif bad == 0:
        ok("S1 amendment log", "%d rows, every row has evidence" % len(rows))


def check_master_plan(d):
    p = os.path.join(d, "MASTER_PLAN.md")
    if not os.path.isfile(p):
        fail("PLAN-EXISTS", "MASTER_PLAN.md missing"); return
    t = read(p)
    for ph in range(1, 6):
        if not re.search(r"^##\s+Phase %d\b" % ph, t, re.M):
            fail("PLAN-PHASES", "missing heading '## Phase %d'" % ph)
    for h in ("Dependency graph", "Gap closure matrix", "Owner"):
        if not re.search(r"^##\s+.*%s" % h, t, re.M | re.I):
            fail("PLAN-SECTION", "missing section containing '%s'" % h)
    m = re.search(r"##\s+Dependency graph.*?```(.*?)```", t, re.S | re.I)
    if not m:
        fail("PLAN-DAG", "no fenced graph under Dependency graph"); return
    g = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"\s*(U-\d\d)\s*:\s*(.*)$", line)
        if mm:
            g[mm.group(1)] = [x for x in re.findall(r"U-\d\d", mm.group(2))]
    state = {}

    def dfs(n, stack):
        if state.get(n) == 2:
            return True
        if state.get(n) == 1:
            fail("PLAN-DAG-CYCLE", " -> ".join(stack + [n])); return False
        state[n] = 1
        for q in g.get(n, []):
            if not dfs(q, stack + [n]):
                return False
        state[n] = 2
        return True

    good = all(dfs(n, []) for n in list(g))
    undefined = sorted({q for v in g.values() for q in v} - set(g))
    if undefined:
        fail("PLAN-DAG-UNDEFINED", "prerequisite ids with no node: " + ",".join(undefined))
    if good and g and not undefined:
        ok("PLAN-DAG acyclic", "%d nodes" % len(g))


def main(d):
    reg = check_register(d)
    check_coverage(d, reg)
    check_amendment_log(d)
    check_master_plan(d)
    for name in STRICT_FILES:
        p = os.path.join(d, name)
        if not os.path.isfile(p):
            continue
        hits = [(i, m.group(0)) for i, l in enumerate(read(p).splitlines(), 1) for m in BANNED.finditer(l)]
        if hits:
            fail("BANNED-WORDS", "%s: %s" % (name, ", ".join("L%d:%s" % h for h in hits[:8]) + (" (+%d more)" % (len(hits) - 8) if len(hits) > 8 else "")))
        else:
            ok("BANNED-WORDS", name)
    sm = os.path.join(d, "surface_matrix.json")
    if os.path.isfile(sm):
        try:
            j = json.loads(read(sm)); cells = j.get("cells", [])
            if len(cells) != 28: fail("D-08 28 cells", "found %d" % len(cells))
            elif any({"status", "record_id", "verify_command"} - set(c) for c in cells): fail("D-08 cell fields", "missing status/record_id/verify_command")
            elif any(not str(c.get("verify_command", "")).strip() for c in cells): fail("D-08 verify_command", "empty")
            elif len(j.get("record_types", [])) != 7 or len(j.get("surfaces", [])) != 4: fail("D-08 7x4", "record_types/surfaces count")
            elif any(c.get("status") != "unproven" for c in cells): fail("1.8 all unproven", "a cell is not unproven")
            else: ok("D-08 surface_matrix 7x4=28 cells, all unproven")
        except Exception as e:
            fail("D-08 json", str(e))
    else:
        fail("D-08 exists", "surface_matrix.json missing")
    cr = os.path.join(d, "CONTRADICTIONS_RESOLVED.md")
    if os.path.isfile(cr):
        ids = set(re.findall(r"^#{2,4}\s*(C-0[1-9])\b", read(cr), re.M))
        need = {"C-0%d" % i for i in range(1, 10)}
        (ok if need <= ids else lambda *a: fail("D-05 nine entries", "found " + ",".join(sorted(ids))))("D-05 entries C-01..C-09")
    else:
        fail("D-05 exists", "CONTRADICTIONS_RESOLVED.md missing")
    cp = os.path.join(d, "CRON_PLACEMENT.csv")
    if os.path.isfile(cp):
        rows = list(csv.DictReader(read(cp).splitlines()))
        allowed = {"PG_CRON", "EDGE_FN_VIA_PG_CRON", "GITHUB_ACTIONS", "VERCEL", "KILL"}
        bad = [r for r in rows if r.get("classification") not in allowed]
        if bad: fail("D-07 classification enum", "%d rows invalid" % len(bad))
        elif len(rows) < 30: fail("D-07 rows", "need >=30 (29+1), found %d" % len(rows))
        elif not any(r.get("classification") in {"PG_CRON", "EDGE_FN_VIA_PG_CRON"} for r in rows): fail("E-01 PG_CRON>0", "none")
        else: ok("D-07/E-01 CRON_PLACEMENT", "%d rows" % len(rows))
    else:
        fail("D-07 exists", "CRON_PLACEMENT.csv missing")
    print("SUMMARY FAILS=%d" % len(fails))
    return 0 if not fails else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: lint_plan.py <package_dir>"); sys.exit(2)
    sys.exit(main(sys.argv[1]))
