#!/usr/bin/env python3
"""PROJEXA AI Work Link - conformance harness (spec S01 section 13, as fixed by audit S02).

It behaves like a plain AI that has had no setup: it starts from ONE pasted
link, reads the Markdown manual that link returns, finds the machine-readable
manifest block inside that manual, and from then on calls only the URLs the
manual gave it.  No vendor account is needed to run it.

Usage (read-only checks, safe on production data):
    python ai_link_conformance.py --link "<pasted link>"            # 19 checks
Optional extra checks (each needs a second test link):
    --link-b       <link for a DIFFERENT project>                  -> H17 isolation
    --member-link  <link minted by a member-role user>             -> H18 money redaction, H22 on that link too
    --revoked-link <a link that was revoked>                       -> H19 revocation
    --demoted-link <link whose person was demoted after minting>   -> H23 live role
    --write        run ONE real level-1 write, then replay it      -> H20
Exit status: 0 when every selected check passed, 1 otherwise.
Last output line: "RESULT: <p> passed, <f> failed".

Business counters: /context carries counters.intents and counters.submissions.
Every GET, every dry run and every function read must leave both unchanged
(spec 9.2, audit A-01). The rate reading (/context "rate") moves on every call
and is not compared.
Standard library only.
"""
import argparse
import http.client
import json
import os
import re
import sys
import time
import urllib.parse

MAX_MANUAL_BYTES = 20000
MAX_PAGE_BYTES = 1_000_000
MAX_PAGE_SECONDS = 2.0
MAX_URL_CHARS = 250  # Anthropic web fetch tool refuses longer URLs (url_too_long), per AILINK_R03 1.5 (FETCHED)
MODERN = "2026-07-28"
LEGACY = "2025-06-18"
JSON = {"Accept": "application/json"}
MCP_ACCEPT = "application/json, text/event-stream"
MANIFEST_RE = re.compile(r"```json ai-link-manifest[ \t]*\r?\n(.*?)\r?\n```", re.S)
TOKEN_TAIL_RE = re.compile(r"/(pxa_[0-9a-f]{64})$")
REQUIRED_URL_KEYS = ("context", "openapi", "swagger", "mcp", "records", "check",
                     "propose_example", "history", "actions", "drafts", "inbox")
# Manifest URLs that are plain reads and must answer Markdown to a request with no Accept header (audit A-22).
READ_URL_KEYS = ("context", "functions", "history", "propose_example", "records")
# Tools every link may list besides its allowed function ids (spec section 7.2).
READ_TOOL_NAMES = {"get_context", "list_records", "get_record", "get_history", "search", "fetch",
                   "check_change", "propose_change"}
BUSINESS = ("intents", "submissions")


# PACING. A link may make 120 calls a minute (spec section 4.1) and a run of this harness makes more than that against one link once the
# manifest lists many record kinds (H24 alone reads every manifest read address, one per kind). So the harness keeps under the limit
# itself: at most PACE_MAX calls to one link in any PACE_WINDOW seconds, waiting when it would go over. The defaults (100 in 60 seconds)
# suit a live deployment and make a full run take a few minutes; a test that runs the handler on a faster clock shortens the window with
# AWL_HARNESS_WINDOW_SECONDS. An answer of 429 despite this is waited out once (Retry-After, at most one window) and retried.
PACE_MAX = int(os.environ.get("AWL_HARNESS_MAX_CALLS", "100"))
PACE_WINDOW = float(os.environ.get("AWL_HARNESS_WINDOW_SECONDS", "60"))
LINK_IN_URL_RE = re.compile(r"/pxa_[0-9a-f]{64}")
_PACE = {}


def _pace(url):
    """Sleeps as long as one more call to this link would exceed PACE_MAX calls in PACE_WINDOW seconds."""
    m = LINK_IN_URL_RE.search(url)
    key = m.group(0) if m else "-" + urllib.parse.urlsplit(url).netloc
    stamps = _PACE.setdefault(key, [])
    while True:
        now = time.monotonic()
        stamps[:] = [t for t in stamps if now - t < PACE_WINDOW]
        if len(stamps) < PACE_MAX:
            stamps.append(now)
            return
        time.sleep(max(0.05, PACE_WINDOW - (now - stamps[0]) + 0.05))


def call(method, url, headers=None, body=None, timeout=25):
    """One HTTP request, no redirects followed, paced under the per-link limit. Returns (status, headers, raw, seconds)."""
    for attempt in (0, 1):
        _pace(url)
        status, got, raw, seconds = _call_once(method, url, headers, body, timeout)
        if status != 429 or attempt == 1 or method not in ("GET", "HEAD"):
            return status, got, raw, seconds
        try:
            wait = float(got.get("retry-after", PACE_WINDOW))
        except ValueError:
            wait = PACE_WINDOW
        time.sleep(min(wait, PACE_WINDOW) + 0.05)


def _call_once(method, url, headers=None, body=None, timeout=25):
    """One HTTP request, no redirects followed. Returns (status, headers, raw, seconds)."""
    parts = urllib.parse.urlsplit(url)
    cls = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    conn = cls(parts.hostname, parts.port, timeout=timeout)
    target = (parts.path or "/") + ("?" + parts.query if parts.query else "")
    hdrs = {"User-Agent": "projexa-ai-link-conformance/1"}
    hdrs.update(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    start = time.monotonic()
    conn.request(method, target, body=data, headers=hdrs)
    resp = conn.getresponse()
    raw = resp.read()
    seconds = time.monotonic() - start
    got = {k.lower(): v for k, v in resp.getheaders()}
    conn.close()
    return resp.status, got, raw, seconds


def as_json(raw):
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def rpc_body(raw, content_type):
    """A JSON-RPC message from a JSON body or from the last `data:` line of an SSE body."""
    if content_type.startswith("text/event-stream"):
        last = None
        for line in raw.decode("utf-8", "replace").splitlines():
            if line.startswith("data:"):
                last = line[5:].strip()
        return json.loads(last) if last else None
    return as_json(raw)


def strip_slash(u):
    return u[:-1] if u.endswith("/") else u


def money_leaks(text, cols):
    """Money columns that carry a value inside one search/fetch text (JSON object text or plain text)."""
    doc = None
    try:
        doc = json.loads(text)
    except Exception:
        pass
    leaked = []
    for col in cols:
        if isinstance(doc, dict) and doc.get(col) is not None:
            leaked.append(col)
        elif re.search(r'"%s"\s*:\s*-?\d' % re.escape(col), text or ""):
            leaked.append(col)
    return sorted(set(leaked))


class Harness:
    def __init__(self, args):
        self.args = args
        self.base = strip_slash(args.link)
        self.passed = 0
        self.failed = 0
        self.manual = ""
        self.manual_headers = {}
        self.manifest = {}
        self.context = {}

    def run_check(self, cid, text, fn):
        try:
            ok, detail = fn()
        except Exception as exc:  # a crash in a check is a failed check
            ok, detail = False, "exception %s: %s" % (type(exc).__name__, exc)
        if ok:
            self.passed += 1
            print("PASS %s %s" % (cid, text))
        else:
            self.failed += 1
            print("FAIL %s %s: %s" % (cid, text, detail))
        return ok

    # --- helpers that read state -------------------------------------------
    def urls(self):
        return self.manifest.get("urls", {})

    def get_json(self, url):
        status, headers, raw, seconds = call("GET", url, JSON)
        return status, headers, as_json(raw), raw, seconds

    def counters(self, link_base=None):
        """The two business counters of one link. A missing counter is a failure, never a zero."""
        url = (strip_slash(link_base) + "/context") if link_base else self.urls()["context"]
        status, _, doc, _, _ = self.get_json(url)
        if status != 200 or not isinstance(doc, dict):
            raise RuntimeError("context status %s" % status)
        got = doc.get("counters", {})
        missing = [k for k in BUSINESS if k not in got]
        if missing:
            raise RuntimeError("context counters lack %s" % missing)
        return {k: got[k] for k in BUSINESS}

    def first_record_kind(self):
        records = self.urls().get("records", {})
        return sorted(records)[0], records[sorted(records)[0]]

    def first_read_function(self):
        fn = next((f.get("id") for f in self.context.get("functions", []) if f.get("kind") == "read"), None)
        if not fn:
            raise RuntimeError("no read function listed in /context")
        return fn

    def mcp_tool(self, link_base, name, arguments):
        hdrs = {"Accept": MCP_ACCEPT, "MCP-Protocol-Version": LEGACY}
        body = {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
        status, h, raw, _ = call("POST", link_base, hdrs, body)
        msg = rpc_body(raw, h.get("content-type", "")) or {}
        result = msg.get("result") or {}
        if status != 200 or result.get("isError"):
            raise RuntimeError("tools/call %s: status %s body %r" % (name, status, raw[:200]))
        doc = result.get("structuredContent")
        if doc is None:
            texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
            doc = json.loads(texts[0]) if texts else {}
        return doc

    # --- H01..H16, H21, H22, H24: always run ---------------------------------
    def h01(self):
        status, headers, raw, _ = call("GET", self.base)
        self.manual_headers = headers
        self.manual = raw.decode("utf-8", "replace")
        ctype = headers.get("content-type", "")
        if status != 200:
            return False, "status %s" % status
        if not ctype.startswith("text/markdown"):
            return False, "content-type %r" % ctype
        if not self.manual.startswith("# "):
            return False, "body does not start with '# '"
        if len(raw) >= MAX_MANUAL_BYTES:
            return False, "%d bytes" % len(raw)
        return True, ""

    def h02(self):
        found = MANIFEST_RE.search(self.manual)
        if not found:
            return False, "no ```json ai-link-manifest block"
        self.manifest = json.loads(found.group(1))
        if self.manifest.get("ai_work_link") != 1:
            return False, "ai_work_link != 1"
        if strip_slash(self.manifest.get("base", "")) != self.base:
            return False, "manifest base %r != pasted link" % self.manifest.get("base")
        urls = self.urls()
        missing = [k for k in REQUIRED_URL_KEYS if k not in urls]
        if missing:
            return False, "missing url keys %s" % missing
        for key, value in urls.items():
            values = value.values() if isinstance(value, dict) else [value]
            for v in values:
                if key == "inbox":
                    if "#" not in v:
                        return False, "inbox url carries no fragment"
                    continue
                if not v.startswith(self.base):
                    return False, "url %s=%r is not under the pasted link" % (key, v)
                if len(v) > MAX_URL_CHARS:
                    return False, "url %s is %d characters (limit %d)" % (key, len(v), MAX_URL_CHARS)
        return True, ""

    def h03(self):
        h = self.manual_headers
        if "no-store" not in h.get("cache-control", ""):
            return False, "cache-control %r" % h.get("cache-control")
        if h.get("referrer-policy", "").strip().lower() != "no-referrer":
            return False, "referrer-policy %r" % h.get("referrer-policy")
        if "noindex" not in h.get("x-robots-tag", ""):
            return False, "x-robots-tag %r" % h.get("x-robots-tag")
        return True, ""

    def h04(self):
        status, _, doc, _, _ = self.get_json(self.urls()["context"])
        if status != 200 or not isinstance(doc, dict):
            return False, "status %s" % status
        self.context = doc
        if doc.get("project", {}).get("id") != self.manifest.get("project", {}).get("id"):
            return False, "project id differs from manifest"
        if doc.get("level") not in (0, 1):
            return False, "level %r" % doc.get("level")
        if sorted(doc.get("allowed_functions", [])) != sorted(self.manifest.get("allowed_functions", [])):
            return False, "allowed_functions differ from manifest"
        missing = [k for k in BUSINESS if k not in doc.get("counters", {})]
        if missing:
            return False, "counters lack %s" % missing
        return True, ""

    def h05(self):
        status, _, doc, _, _ = self.get_json(self.urls()["openapi"])
        if status != 200 or not isinstance(doc, dict):
            return False, "status %s" % status
        if not str(doc.get("openapi", "")).startswith("3.0"):
            return False, "openapi %r" % doc.get("openapi")
        servers = doc.get("servers") or [{}]
        if strip_slash(servers[0].get("url", "")) != self.base:
            return False, "servers[0].url %r" % servers[0].get("url")
        paths = doc.get("paths", {})
        for needed in ("/context", "/records/{kind}", "/check", "/actions", "/drafts"):
            if needed not in paths:
                return False, "path %s missing" % needed
        for path, item in paths.items():
            if path.startswith("/functions/") and isinstance(item, dict) and "get" in item:
                return False, "GET declared on %s (function reads are POST-only)" % path
            for op in item.values():
                for p in op.get("parameters", []) if isinstance(op, dict) else []:
                    if p.get("in") == "query" and p.get("name", "").lower() in ("token", "key", "api_key"):
                        return False, "token declared as a query parameter"
        return True, ""

    def h06(self):
        status, _, doc, _, _ = self.get_json(self.urls()["swagger"])
        if status != 200 or not isinstance(doc, dict):
            return False, "status %s" % status
        if doc.get("swagger") != "2.0":
            return False, "swagger %r" % doc.get("swagger")
        rebuilt = "%s://%s%s" % ((doc.get("schemes") or ["https"])[0], doc.get("host", ""), doc.get("basePath", ""))
        if strip_slash(rebuilt) != self.base:
            return False, "scheme+host+basePath %r" % rebuilt
        return True, ""

    def h07(self):
        mcp = self.urls()["mcp"]
        accept = {"Accept": MCP_ACCEPT}
        init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": LEGACY, "capabilities": {},
                           "clientInfo": {"name": "conformance", "version": "1"}}}
        status, h, raw, _ = call("POST", mcp, accept, init)
        msg = rpc_body(raw, h.get("content-type", ""))
        if status != 200 or not msg or msg.get("result", {}).get("protocolVersion") != LEGACY:
            return False, "initialize status %s body %r" % (status, raw[:200])
        hdrs = dict(accept, **{"MCP-Protocol-Version": LEGACY})
        status, h, raw, _ = call("POST", mcp, hdrs, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        msg = rpc_body(raw, h.get("content-type", ""))
        names = {t.get("name") for t in (msg or {}).get("result", {}).get("tools", [])}
        if not {"get_context", "list_records"} <= names:
            return False, "tools/list lacks get_context/list_records: %s" % sorted(names)
        allowed = set(self.manifest.get("allowed_functions", [])) | READ_TOOL_NAMES
        extra = names - allowed
        if extra:
            return False, "tools outside the link scope: %s" % sorted(extra)
        return True, ""

    def h08(self):
        mcp = self.urls()["mcp"]
        meta = {"io.modelcontextprotocol/protocolVersion": MODERN,
                "io.modelcontextprotocol/clientInfo": {"name": "conformance", "version": "1"},
                "io.modelcontextprotocol/clientCapabilities": {}}
        body = {"jsonrpc": "2.0", "id": "d1", "method": "server/discover", "params": {"_meta": meta}}
        hdrs = {"Accept": MCP_ACCEPT, "MCP-Protocol-Version": MODERN, "Mcp-Method": "server/discover"}
        status, h, raw, _ = call("POST", mcp, hdrs, body)
        msg = rpc_body(raw, h.get("content-type", ""))
        if status != 200 or MODERN not in (msg or {}).get("result", {}).get("supportedVersions", []):
            return False, "server/discover status %s body %r" % (status, raw[:200])
        bad = dict(hdrs, **{"Mcp-Method": "tools/list"})
        status, h, raw, _ = call("POST", mcp, bad, body)
        msg = rpc_body(raw, h.get("content-type", "")) or {}
        if status != 400 or msg.get("error", {}).get("code") != -32020:
            return False, "header/body mismatch gave status %s code %r" % (status, msg.get("error", {}).get("code"))
        return True, ""

    def h09(self):
        status, h, _, _ = call("GET", self.urls()["mcp"], {"Accept": "text/event-stream"})
        if status != 405:
            return False, "status %s" % status
        return True, ""

    def h10(self):
        kind, url = self.first_record_kind()
        status, _, doc, raw, seconds = self.get_json(url)
        if status != 200 or not isinstance(doc, dict) or not isinstance(doc.get("items"), list):
            return False, "status %s" % status
        nxt = doc.get("next")
        if nxt is not None and not str(nxt).startswith(self.base):
            return False, "next %r is not an absolute link URL" % nxt
        if nxt is not None and len(str(nxt)) > MAX_URL_CHARS:
            return False, "next link is %d characters (limit %d)" % (len(str(nxt)), MAX_URL_CHARS)
        if len(raw) >= MAX_PAGE_BYTES:
            return False, "%d bytes" % len(raw)
        if seconds >= MAX_PAGE_SECONDS:
            return False, "%.2f s" % seconds
        return True, ""

    def h11(self):
        before = self.counters()
        functions = self.context.get("functions", [])
        target = next((f for f in functions if f.get("kind") == "write"), None) or (functions or [{}])[0]
        status, _, raw, _ = call("POST", self.urls()["check"], JSON,
                                 {"function": target.get("id", "none"), "params": {}})
        doc = as_json(raw)
        if status != 200 or not isinstance(doc, dict) or "valid" not in doc:
            return False, "status %s body %r" % (status, raw[:200])
        after = self.counters()
        if after != before:
            return False, "counters %r -> %r after a dry run" % (before, after)
        return True, ""

    def h12(self):
        before = self.counters()
        status, _, doc, raw, _ = self.get_json(self.urls()["propose_example"])
        confirm = (doc or {}).get("confirm_url", "") if isinstance(doc, dict) else ""
        if status != 200 or "#t=" not in confirm:
            return False, "status %s, confirm_url with a #t= fragment not found" % status
        if confirm.split("#", 1)[0].count("pxa_"):
            return False, "the token sits outside the fragment of confirm_url"
        after = self.counters()
        if after != before:
            return False, "counters %r -> %r after a GET propose" % (before, after)
        return True, ""

    def h13(self):
        before = self.counters()
        flat = []
        for key, value in self.urls().items():
            if key in ("inbox", "check", "actions", "drafts", "mcp"):
                continue
            for v in (value.values() if isinstance(value, dict) else [value]):
                if "{" not in v:
                    flat.append(v)
        for _ in range(2):
            for url in flat:
                call("GET", url)  # no Accept header, as a plain AI or a link preview would send
        after = self.counters()
        if after != before:
            return False, "counters %r -> %r after %d GETs" % (before, after, 2 * len(flat))
        return True, ""

    def h14(self):
        status, h, _, _ = call("GET", self.urls()["actions"])
        if status != 405 or "POST" not in h.get("allow", ""):
            return False, "/actions: status %s allow %r" % (status, h.get("allow"))
        fn = self.first_read_function()
        status, h, _, _ = call("GET", self.base + "/functions/" + fn)
        if status != 405 or "POST" not in h.get("allow", ""):
            return False, "GET /functions/%s: status %s allow %r (a GET must never run a function)" % (fn, status, h.get("allow"))
        return True, ""

    def h15(self):
        m = TOKEN_TAIL_RE.search(self.base)
        if not m:
            return False, "pasted link does not end in a pxa_ token (header-mode link?)"
        stem = self.base[: m.start(1)]
        s1, _, _, _ = call("GET", stem + "not-a-token")
        s2, _, _, _ = call("GET", stem + "pxa_" + "e" * 64)
        if s1 != 404 or s2 != 410:
            return False, "malformed -> %s (want 404), unknown -> %s (want 410)" % (s1, s2)
        return True, ""

    def h16(self):
        status, _, _, _ = call("GET", self.base + "?token=abc")
        if status != 400:
            return False, "status %s" % status
        return True, ""

    def h21(self):
        before = self.counters()
        fn = self.first_read_function()
        status, _, raw, _ = call("POST", self.base + "/functions/" + fn, JSON, {})
        if status not in (200, 503):
            return False, "POST /functions/%s: status %s body %r" % (fn, status, raw[:200])
        after = self.counters()
        if after != before:
            return False, "counters %r -> %r after a function read" % (before, after)
        return True, ""

    def h22(self):
        links = [self.base] + ([strip_slash(self.args.member_link)] if self.args.member_link else [])
        for link in links:
            status, _, ctx, _, _ = self.get_json(link + "/context")
            if status != 200 or not isinstance(ctx, dict):
                return False, "%s/context status %s" % (link[-12:], status)
            cols = sorted({c for v in (ctx.get("money_fields") or {}).values() for c in v})
            hidden = ctx.get("acting_for", {}).get("money_visible") is False
            token = TOKEN_TAIL_RE.search(link)
            found = self.mcp_tool(link, "search", {"query": ""})
            results = found.get("results") or []
            if not results:
                return False, "search returned no results to test with"
            fetched = self.mcp_tool(link, "fetch", {"id": results[0].get("id")})
            for item in results + [fetched]:
                url = str(item.get("url", ""))
                if "pxa_" in url or url.startswith(link) or (token and token.group(1) in url):
                    return False, "result url carries the link or its token: %r" % url[:80]
                if hidden:
                    leaked = money_leaks(str(item.get("text", "")), cols)
                    if leaked:
                        return False, "search/fetch text shows %s for a role that may not see money" % leaked
        return True, ""

    def h24(self):
        urls = []
        for key in READ_URL_KEYS:
            value = self.urls().get(key)
            if value is None:
                return False, "manifest lacks %s" % key
            urls += list(value.values()) if isinstance(value, dict) else [value]
        for url in urls:
            status, h, _, _ = call("GET", url)
            if status != 200 or not h.get("content-type", "").startswith("text/markdown"):
                return False, "%s -> %s %r (want 200 text/markdown)" % (url[len(self.base):] or "/", status, h.get("content-type"))
        return True, ""

    # --- H17..H20, H23: optional -------------------------------------------------
    def h17(self):
        kind, url = self.first_record_kind()
        status, _, doc, _, _ = self.get_json(url)
        items = (doc or {}).get("items") or []
        if not items:
            return False, "link A has no %s records to test with" % kind
        record_id = items[0]["id"]
        status, _, _, _ = call("GET", strip_slash(self.args.link_b) + "/records/%s/%s" % (kind, urllib.parse.quote(record_id)), JSON)
        if status != 404:
            return False, "link B read project A record %s: status %s" % (record_id, status)
        return True, ""

    def h18(self):
        member = strip_slash(self.args.member_link)
        status, _, ctx, _, _ = self.get_json(member + "/context")
        ctx = ctx or {}
        if ctx.get("acting_for", {}).get("money_visible") is not False:
            return False, "member link says money_visible=%r" % ctx.get("acting_for", {}).get("money_visible")
        money = ctx.get("money_fields") or {}
        if not money:
            return False, "member link lists no money fields"
        for kind, cols in money.items():
            status, _, page, _, _ = self.get_json(member + "/records/%s?limit=200" % kind)
            for item in (page or {}).get("items", []):
                leaked = [c for c in cols if item.get(c) is not None]
                if leaked:
                    return False, "%s record %s shows %s" % (kind, item.get("id"), leaked)
            for col in cols:  # a filter or a sort on a hidden field would recover it (audit A-09)
                for q in ("%s_gt=0" % col, "sort=%s" % col):
                    status, _, _, _ = call("GET", member + "/records/%s?%s" % (kind, q), JSON)
                    if status != 400:
                        return False, "records/%s?%s -> %s (want 400)" % (kind, q, status)
        status, _, _, _ = call("POST", member + "/functions/get_construction_budget_status", JSON, {})
        if status != 403:
            return False, "budget function for member -> %s (want 403)" % status
        return True, ""

    def h19(self):
        revoked = strip_slash(self.args.revoked_link)
        s1, _, _, _ = call("GET", revoked)
        init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "c", "version": "1"}}}
        s2, _, _, _ = call("POST", revoked, {"Accept": MCP_ACCEPT}, init)
        if s1 != 410 or s2 != 410:
            return False, "GET -> %s, MCP POST -> %s (want 410 and 410)" % (s1, s2)
        return True, ""

    def h23(self):
        demoted = strip_slash(self.args.demoted_link)
        status, _, ctx, _, _ = self.get_json(demoted + "/context")
        if status != 200 or not isinstance(ctx, dict):
            return False, "context status %s" % status
        if ctx.get("level") != 0:
            return False, "demoted link still reports level %r" % ctx.get("level")
        target = next((f for f in ctx.get("functions", []) if f.get("kind") == "write" and f.get("level") == 1), None)
        body = {"function": (target or {}).get("id", "record_work_progress"),
                "params": (target or {}).get("example_params") or {"itemCode": "EX-01", "percent": 10}}
        status, _, raw, _ = call("POST", demoted + "/actions", JSON, body)
        if status != 403:
            return False, "write on a demoted link -> %s (want 403) %r" % (status, raw[:120])
        return True, ""

    def h20(self):
        if self.context.get("level") != 1:
            return False, "link is level %r; --write needs a level-1 link" % self.context.get("level")
        target = next((f for f in self.context.get("functions", [])
                       if f.get("kind") == "write" and f.get("level") == 1 and f.get("example_params")), None)
        if not target:
            return False, "no level-1 write with example_params in /context"
        before = self.counters()
        key = "conformance-%d" % int(time.time())
        body = {"function": target["id"], "params": target["example_params"], "idempotency_key": key}
        s1, _, raw1, _ = call("POST", self.urls()["actions"], JSON, body)
        s2, _, raw2, _ = call("POST", self.urls()["actions"], JSON, body)
        after = self.counters()
        replay = as_json(raw2) or {}
        if s1 != 201:
            return False, "first write status %s body %r" % (s1, raw1[:200])
        if s2 != 200 or replay.get("replayed") is not True:
            return False, "replay status %s replayed=%r" % (s2, replay.get("replayed"))
        want = {k: before[k] + 1 for k in BUSINESS}
        if after != want:
            return False, "counters %r -> %r (want intents +1 and submissions +1, replay adds nothing)" % (before, after)
        return True, ""

    def run(self):
        plan = [
            ("H01", "manual is Markdown at the pasted link", self.h01),
            ("H02", "manual carries a manifest whose URLs sit under the link", self.h02),
            ("H03", "private headers: no-store, no-referrer, noindex", self.h03),
            ("H04", "context names the same project, level and functions, with both business counters", self.h04),
            ("H05", "OpenAPI 3.0 served, server URL is the link, no query token, no GET on a function path", self.h05),
            ("H06", "Swagger 2.0 served for Power Platform importers", self.h06),
            ("H07", "MCP legacy initialize + tools/list inside link scope", self.h07),
            ("H08", "MCP 2026-07-28 server/discover + header mismatch 400/-32020", self.h08),
            ("H09", "MCP GET stream probe answered 405", self.h09),
            ("H10", "records page: items, absolute next, < 1 MB, < 2 s", self.h10),
            ("H11", "POST /check is a dry run: counters unchanged", self.h11),
            ("H12", "GET propose returns a confirm link, counters unchanged", self.h12),
            ("H13", "counters.intents and counters.submissions unchanged", self.h13),
            ("H14", "GET on /actions and on a function path refused 405 with Allow: POST", self.h14),
            ("H15", "malformed token 404, unknown token 410", self.h15),
            ("H16", "token in a query string refused 400", self.h16),
            ("H21", "POST function read changes no counter (read-only executor mode)", self.h21),
            ("H22", "search/fetch redacted and token-free", self.h22),
            ("H24", "manifest read URLs answer Markdown with no Accept header", self.h24),
        ]
        if self.args.link_b:
            plan.append(("H17", "link for project B cannot read a project A record", self.h17))
        if self.args.member_link:
            plan.append(("H18", "member link: money fields null, money filter and sort 400, budget function 403", self.h18))
        if self.args.revoked_link:
            plan.append(("H19", "revoked link: GET 410 and MCP POST 410", self.h19))
        if self.args.demoted_link:
            plan.append(("H23", "demoted link: effective level 0 and write refused 403", self.h23))
        if self.args.write:
            plan.append(("H20", "one level-1 write 201, replay 200 replayed, intents and submissions +1", self.h20))
        stop_after_prereq = False
        for cid, text, fn in plan:
            if stop_after_prereq and cid not in ("H15", "H16", "H19", "H23"):
                self.failed += 1
                print("FAIL %s %s: skipped, manual or manifest unreadable" % (cid, text))
                continue
            ok = self.run_check(cid, text, fn)
            if not ok and cid in ("H01", "H02"):
                stop_after_prereq = True
        print("RESULT: %d passed, %d failed" % (self.passed, self.failed))
        return 0 if self.failed == 0 and self.passed > 0 else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="PROJEXA AI Work Link conformance harness")
    ap.add_argument("--link", required=True, help="the pasted link, exactly as a person would paste it")
    ap.add_argument("--link-b", help="a link for a different project (H17)")
    ap.add_argument("--member-link", help="a link minted by a member-role user (H18, and H22 on it)")
    ap.add_argument("--revoked-link", help="a revoked link (H19)")
    ap.add_argument("--demoted-link", help="a link whose person was demoted after it was minted (H23)")
    ap.add_argument("--write", action="store_true", help="run one real level-1 write and its replay (H20)")
    args = ap.parse_args(argv)
    return Harness(args).run()


if __name__ == "__main__":
    sys.exit(main())
