#!/usr/bin/env python3
"""
Superboss Register -- three searchable trees, server-side, SQLite+FTS5.
Deployed 2026-07-20 per Owner directive: no session starts from zero again.

SCOPE (deliberately distinct from the AI-work cost-control system built
earlier the same night -- that governs dispatched WORKER tasks; this
governs the OWNER<->SUPERBOSS operational dialogue itself, which nothing
else in this codebase tracks. Not a duplicate of `conversations`/`messages`
in schema.ts either -- those are VERI Chat's end-customer product tables,
a different population/purpose entirely, confirmed by direct inspection
before building this.

THREE TREES:
  instructions -- one row per distinct request/instruction (the INPUT side:
                  what was asked, by whom, when, tagged UTM-style).
  work_items   -- one row per unit of work registered in response (the
                  OUTPUT side). software_task_id XOR ai_task_id populated
                  depending on route (§1 triage in
                  AI_CACHE_AND_TRIAGE_ARCHITECTURE.md). Links back to the
                  instruction(s) that spawned it.
  actions      -- finest-grained audit trail: one row per individual action
                  by ANY actor (owner, end_user, org, ai_agent, software).
                  Links to the work_item and/or instruction it serves.

STORAGE FORMAT: structured records (typed columns + a JSON metadata blob),
not narrative text -- per Owner directive, this store is for AI/software
consumption, not human reading. Raw instruction/action text is still
stored (full-text search needs it), but every record is tag-indexed so a
query never requires re-reading raw prose to find what's relevant.

ID SCHEMES (all sortable-by-construction, timestamp-prefixed):
  INS-YYYYMMDD-HHMMSS-<4hex>   instruction_id
  SFT-YYYYMMDD-HHMMSS-<4hex>   software_task_id  (work done with zero AI calls)
  (existing CONTROLLER.yaml task_id reused verbatim as ai_task_id when work
   routes through the existing AI worker fleet -- NOT reissued, avoids a
   second ID for the same real task)
  CCH-<16 hex of the real cache key>   cache_id / ai_cache_id (references
   the existing L1 exact-match cache in glm-response-cache.sqlite by its
   own key, not a new ID space -- avoids yet another duplicate index)
  ACT-YYYYMMDD-HHMMSS-<4hex>   action_id

UTM-STYLE TAGS (literal UTM parameter names, since that's the vocabulary
the Owner specified): utm_source (who: owner|end_user|org|ai_agent|software),
utm_medium (channel: ssh_session|claude_code_cli|chat_ui|api|cron),
utm_campaign (initiative/project grouping, freeform slug),
utm_content (short structured label of what, not a sentence),
utm_term (comma-separated search keywords).
"""
import argparse
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timezone

DB_PATH = os.environ.get("SUPERBOSS_REGISTER_DB", "/opt/veridian/ai-os/memory/superboss-register.sqlite")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix):
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = secrets.token_hex(2)
    return f"{prefix}-{ts}-{rand}"


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = _connect()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS instructions (
        instruction_id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        session_id TEXT,
        utm_source TEXT NOT NULL,
        utm_medium TEXT NOT NULL,
        utm_campaign TEXT,
        utm_content TEXT,
        utm_term TEXT,
        raw_text TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        response_summary TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS instructions_fts USING fts5(
        instruction_id UNINDEXED, raw_text, utm_content, utm_term, response_summary,
        content='instructions', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS instructions_ai AFTER INSERT ON instructions BEGIN
        INSERT INTO instructions_fts(rowid, instruction_id, raw_text, utm_content, utm_term, response_summary)
        VALUES (new.rowid, new.instruction_id, new.raw_text, new.utm_content, new.utm_term, new.response_summary);
    END;

    CREATE TABLE IF NOT EXISTS work_items (
        work_item_id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        instruction_id TEXT,
        software_task_id TEXT,
        ai_task_id TEXT,
        cache_id TEXT,
        ai_cache_id TEXT,
        utm_source TEXT NOT NULL,
        utm_medium TEXT NOT NULL,
        utm_campaign TEXT,
        utm_content TEXT,
        utm_term TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (instruction_id) REFERENCES instructions(instruction_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS work_items_fts USING fts5(
        work_item_id UNINDEXED, utm_content, utm_term,
        content='work_items', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS work_items_ai AFTER INSERT ON work_items BEGIN
        INSERT INTO work_items_fts(rowid, work_item_id, utm_content, utm_term)
        VALUES (new.rowid, new.work_item_id, new.utm_content, new.utm_term);
    END;

    CREATE TABLE IF NOT EXISTS actions (
        action_id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        work_item_id TEXT,
        instruction_id TEXT,
        utm_source TEXT NOT NULL,
        utm_medium TEXT NOT NULL,
        utm_campaign TEXT,
        utm_content TEXT NOT NULL,
        utm_term TEXT,
        result TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
        FOREIGN KEY (instruction_id) REFERENCES instructions(instruction_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS actions_fts USING fts5(
        action_id UNINDEXED, utm_content, utm_term, result,
        content='actions', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS actions_ai AFTER INSERT ON actions BEGIN
        INSERT INTO actions_fts(rowid, action_id, utm_content, utm_term, result)
        VALUES (new.rowid, new.action_id, new.utm_content, new.utm_term, new.result);
    END;

    CREATE INDEX IF NOT EXISTS idx_instructions_campaign ON instructions(utm_campaign);
    CREATE INDEX IF NOT EXISTS idx_work_items_instruction ON work_items(instruction_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_campaign ON work_items(utm_campaign);
    CREATE INDEX IF NOT EXISTS idx_actions_work_item ON actions(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_actions_campaign ON actions(utm_campaign);

    -- 4th tree (2026-07-20, Owner directive: "indexation of everything we
    -- do is missing... that's why wrong files/scripts/tables keep getting
    -- picked"). Catalogs every real mechanism (script/service/table) found
    -- during this session's audits, not the work-event history above --
    -- this answers "does X already exist and where" BEFORE building
    -- anything, which the other 3 trees cannot (they log what happened,
    -- not what exists).
    CREATE TABLE IF NOT EXISTS system_index (
        index_id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        path TEXT NOT NULL,
        category TEXT NOT NULL,
        layer TEXT NOT NULL,
        status TEXT NOT NULL,
        purpose TEXT NOT NULL,
        utm_term TEXT,
        calls TEXT,
        called_by TEXT,
        verified_ts TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS system_index_fts USING fts5(
        index_id UNINDEXED, path, purpose, utm_term, calls, called_by,
        content='system_index', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS system_index_ai AFTER INSERT ON system_index BEGIN
        INSERT INTO system_index_fts(rowid, index_id, path, purpose, utm_term, calls, called_by)
        VALUES (new.rowid, new.index_id, new.path, new.purpose, new.utm_term, new.calls, new.called_by);
    END;
    CREATE INDEX IF NOT EXISTS idx_system_index_category ON system_index(category);
    CREATE INDEX IF NOT EXISTS idx_system_index_status ON system_index(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_system_index_path ON system_index(path);
    """)
    conn.commit()
    conn.close()
    print(json.dumps({"ok": True, "db": DB_PATH}))


def log_instruction(args):
    init_db_silent()
    conn = _connect()
    iid = _new_id("INS")
    conn.execute(
        "INSERT INTO instructions (instruction_id, ts, session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, raw_text, metadata_json, response_summary) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (iid, _now_iso(), args.session_id, args.source, args.medium, args.campaign, args.content, args.term,
         args.text, json.dumps(json.loads(args.metadata) if args.metadata else {}), args.response_summary),
    )
    conn.commit()
    conn.close()
    print(json.dumps({"instruction_id": iid}))


def log_work(args):
    init_db_silent()
    conn = _connect()
    wid = _new_id("WRK")
    # --ts override (2026-07-20, historical-import support): a bulk import of
    # past sessions needs to carry each entry's REAL date, not the moment of
    # import -- otherwise the whole point (an accurate timeline) is lost.
    ts = getattr(args, "ts", None) or _now_iso()
    conn.execute(
        "INSERT INTO work_items (work_item_id, ts, instruction_id, software_task_id, ai_task_id, cache_id, ai_cache_id, "
        "utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (wid, ts, args.instruction_id, args.software_task_id, args.ai_task_id, args.cache_id, args.ai_cache_id,
         args.source, args.medium, args.campaign, args.content, args.term, args.status,
         json.dumps(json.loads(args.metadata) if args.metadata else {})),
    )
    conn.commit()
    conn.close()
    print(json.dumps({"work_item_id": wid}))


def log_action(args):
    init_db_silent()
    conn = _connect()
    aid = _new_id("ACT")
    conn.execute(
        "INSERT INTO actions (action_id, ts, work_item_id, instruction_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, result, metadata_json) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (aid, _now_iso(), args.work_item_id, args.instruction_id, args.source, args.medium, args.campaign,
         args.content, args.term, args.result, json.dumps(json.loads(args.metadata) if args.metadata else {})),
    )
    conn.commit()
    conn.close()
    print(json.dumps({"action_id": aid}))


STOPWORDS = {"the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "vs", "is", "are", "be", "do", "does"}


def _fts_query(raw):
    """2026-07-20 fix: FTS5's default MATCH syntax is implicit AND across
    space-separated bare terms -- a natural query like 'software vs AI
    classification' silently returns ZERO rows if even one word (here:
    'vs') isn't indexed anywhere, which is exactly the false-negative this
    whole tool exists to prevent (a missed duplicate is worse than noise
    from a false positive). Strip stopwords, OR the remaining terms
    together -- forgiving by design for a discovery search."""
    terms = [t.strip('"') for t in raw.split() if t.strip('"').lower() not in STOPWORDS and t.strip('"')]
    if not terms:
        terms = raw.split() or [raw]
    escaped = [t.replace('"', '""') for t in terms]
    return " OR ".join(f'"{t}"' for t in escaped)


def search(args):
    init_db_silent()
    conn = _connect()
    results = {"instructions": [], "work_items": [], "actions": [], "system_index": []}
    q = _fts_query(args.query)
    for table, fts in [("instructions", "instructions_fts"), ("work_items", "work_items_fts"),
                        ("actions", "actions_fts"), ("system_index", "system_index_fts")]:
        try:
            rows = conn.execute(
                f"SELECT t.* FROM {fts} f JOIN {table} t ON t.rowid = f.rowid WHERE {fts} MATCH ? ORDER BY rank LIMIT ?",
                (q, args.limit),
            ).fetchall()
            results[table] = [dict(r) for r in rows]
        except sqlite3.OperationalError as e:
            results[table] = {"error": str(e)}
    print(json.dumps(results, indent=2, default=str))


def index_add(args):
    """Add or re-verify one system_index entry. path is UNIQUE -- re-running
    this on an already-indexed path UPDATES it (refreshes verified_ts,
    status, etc.) rather than erroring, since this is meant to be a living
    catalog re-checked over time, not a write-once log."""
    init_db_silent()
    conn = _connect()
    iid = _new_id("IDX")
    now = _now_iso()
    conn.execute(
        "INSERT INTO system_index (index_id, ts, path, category, layer, status, purpose, utm_term, calls, called_by, verified_ts, metadata_json) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(path) DO UPDATE SET category=excluded.category, layer=excluded.layer, status=excluded.status, "
        "purpose=excluded.purpose, utm_term=excluded.utm_term, calls=excluded.calls, called_by=excluded.called_by, "
        "verified_ts=excluded.verified_ts, metadata_json=excluded.metadata_json",
        (iid, now, args.path, args.category, args.layer, args.status, args.purpose, args.term,
         args.calls, args.called_by, now, json.dumps(json.loads(args.metadata) if args.metadata else {})),
    )
    conn.commit()
    row = conn.execute("SELECT index_id FROM system_index WHERE path=?", (args.path,)).fetchone()
    conn.close()
    print(json.dumps({"index_id": row["index_id"], "path": args.path}))


def check_duplicate(args):
    """The concrete fix for 'we keep duplicating': search system_index by
    category and/or keyword BEFORE building something new. Prints every
    existing mechanism that might already do what's being considered."""
    init_db_silent()
    conn = _connect()
    conditions = []
    params = []
    if args.category:
        conditions.append("category = ?")
        params.append(args.category)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = []
    if args.query:
        q = _fts_query(args.query)
        fts_rows = conn.execute(
            "SELECT t.* FROM system_index_fts f JOIN system_index t ON t.rowid = f.rowid WHERE system_index_fts MATCH ?",
            (q,),
        ).fetchall()
        if args.category:
            rows = [r for r in fts_rows if r["category"] == args.category]
        else:
            rows = fts_rows
    elif conditions:
        rows = conn.execute(f"SELECT * FROM system_index {where}", params).fetchall()
    conn.close()
    result = [dict(r) for r in rows]
    print(json.dumps({
        "found": len(result),
        "verdict": "STOP -- existing mechanism(s) found, review before building" if result else "no existing match found -- safe to proceed, but this is not exhaustive",
        "matches": result,
    }, indent=2, default=str))


def init_db_silent():
    if not os.path.exists(DB_PATH):
        conn = _connect()
        conn.close()
    conn = _connect()
    conn.execute("SELECT 1 FROM instructions LIMIT 1")
    conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init")

    p_ins = sub.add_parser("log-instruction")
    p_ins.add_argument("--text", required=True)
    p_ins.add_argument("--source", default="owner")
    p_ins.add_argument("--medium", default="ssh_session")
    p_ins.add_argument("--campaign", default="")
    p_ins.add_argument("--content", default="")
    p_ins.add_argument("--term", default="")
    p_ins.add_argument("--session-id", dest="session_id", default="")
    p_ins.add_argument("--metadata", default="")
    p_ins.add_argument("--response-summary", dest="response_summary", default="")

    p_work = sub.add_parser("log-work")
    p_work.add_argument("--instruction-id", dest="instruction_id", default=None)
    p_work.add_argument("--software-task-id", dest="software_task_id", default=None)
    p_work.add_argument("--ai-task-id", dest="ai_task_id", default=None)
    p_work.add_argument("--cache-id", dest="cache_id", default=None)
    p_work.add_argument("--ai-cache-id", dest="ai_cache_id", default=None)
    p_work.add_argument("--source", default="ai_agent")
    p_work.add_argument("--medium", default="claude_code_cli")
    p_work.add_argument("--campaign", default="")
    p_work.add_argument("--content", default="")
    p_work.add_argument("--term", default="")
    p_work.add_argument("--status", default="open")
    p_work.add_argument("--metadata", default="")
    p_work.add_argument("--ts", default=None, help="ISO8601 override for historical imports; defaults to now")

    p_act = sub.add_parser("log-action")
    p_act.add_argument("--work-item-id", dest="work_item_id", default=None)
    p_act.add_argument("--instruction-id", dest="instruction_id", default=None)
    p_act.add_argument("--source", default="ai_agent")
    p_act.add_argument("--medium", default="claude_code_cli")
    p_act.add_argument("--campaign", default="")
    p_act.add_argument("--content", required=True)
    p_act.add_argument("--term", default="")
    p_act.add_argument("--result", default="")
    p_act.add_argument("--metadata", default="")

    p_search = sub.add_parser("search")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=10)

    p_idx = sub.add_parser("index-add")
    p_idx.add_argument("--path", required=True, help="file/table/mechanism location, e.g. src/lib/task-tightening.ts")
    p_idx.add_argument("--category", required=True, help="cache|validation|guardrail|router|monitor|task_register|hallucination_detection|confidence_scoring|dispatch_entrypoint|classification|other")
    p_idx.add_argument("--layer", required=True, help="shell|typescript|database|documentation")
    p_idx.add_argument("--status", required=True, help="live|partial|dead|deprecated|designed_not_built")
    p_idx.add_argument("--purpose", required=True)
    p_idx.add_argument("--term", default="")
    p_idx.add_argument("--calls", default="")
    p_idx.add_argument("--called-by", dest="called_by", default="")
    p_idx.add_argument("--metadata", default="")

    p_dup = sub.add_parser("check-duplicate")
    p_dup.add_argument("query", nargs="?", default="")
    p_dup.add_argument("--category", default="")

    args = p.parse_args()
    if args.cmd == "init":
        init_db()
    elif args.cmd == "log-instruction":
        log_instruction(args)
    elif args.cmd == "log-work":
        log_work(args)
    elif args.cmd == "log-action":
        log_action(args)
    elif args.cmd == "search":
        search(args)
    elif args.cmd == "index-add":
        index_add(args)
    elif args.cmd == "check-duplicate":
        check_duplicate(args)
