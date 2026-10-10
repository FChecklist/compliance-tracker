#!/usr/bin/env python3
"""A-23: re-check the FETCHED-S01 facts of UNIVERSAL_AI_WORK_LINK_SPEC.md against the vendor pages.

Each fact names the page, the line(s) of the page's normalised text that carry it, the SHA-256 of
each such line, and the identifiers or numbers that must appear on those lines. The line text itself
is not copied into the programme files (vendor text is quoted only as identifiers and numbers);
this script re-derives it from the page and compares hashes, so anyone can see the exact lines.

Usage:
    python ailink_s01_verify.py                 # fetch every page now (read-only GETs of public docs)
    python ailink_s01_verify.py --cache DIR     # use pages saved earlier (file names as in CACHE_NAME)
    python ailink_s01_verify.py --show          # also print each matched line (local reading only)
Exit status 0 only when every fact's lines are found with the same hash and tokens.
Last line: "S01-VERIFY: <p> of <n> facts match".
Normalisation: UTF-8 decode; HTML pages lose script/style/svg/head and keep block breaks;
runs of spaces, tabs and no-break spaces become one space; each line is stripped; empty lines drop.
Standard library only.
"""
import argparse
import hashlib
import html
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser

MCP = "https://modelcontextprotocol.io/specification/2026-07-28"
PAGES = {
    "mcp-http": MCP + "/basic/transports/streamable-http.md",
    "mcp-transports": "https://modelcontextprotocol.io/specification/latest/basic/transports.md",
    "mcp-versioning": MCP + "/basic/versioning.md",
    "mcp-discover": MCP + "/server/discover.md",
    "mcp-tools": MCP + "/server/tools.md",
    "sb-limits": "https://supabase.com/docs/guides/functions/limits",
    "sb-invocations": "https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations",
    "ms-openapi": "https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition",
}

# (fact id, spec place, page, [line numbers in the normalised text on 2026-09-25], tokens every matched line set must hold,
#  sha256 prefixes of those lines as found on 2026-09-25, plain-words summary written by the PM's agent)
FACTS = [
    ("S01-01", "F-4, 7.1", "mcp-http", [11, 13, 14], ["2026-07-28", "GET stream", "sessions"], None,
     "Revision 2026-07-28 removed the GET stream endpoint and protocol-level sessions from Streamable HTTP."),
    ("S01-02", "F-4, 7.1", "mcp-versioning", [27, 28, 29, 30], ["Modern", "2026-07-28", "initialize", "2025-11-25"], None,
     "Modern versions (2026-07-28 on) carry version, identity and capabilities per request; the initialize handshake belongs to legacy versions up to 2025-11-25."),
    ("S01-03", "F-4, 7.1", "mcp-http", [199, 200, 202, 203, 204, 205], ["MCP-Protocol-Version", "_meta", "400", "HeaderMismatch"], None,
     "Every POST carries MCP-Protocol-Version, equal to the protocolVersion in the body _meta; a mismatch is rejected with 400 and HeaderMismatch."),
    ("S01-04", "F-4, 7.1", "mcp-http", [229, 230, 231], ["Mcp-Method", "Mcp-Name", "tools/call", "REQUIRED"], None,
     "Mcp-Method is required on all requests; Mcp-Name on tools/call, resources/read and prompts/get."),
    ("S01-05", "7.1", "mcp-http", [232, 233], ["Mcp-Name", "Base64"], None,
     "An Mcp-Name value that is not plain ASCII is sent in the Base64 sentinel form."),
    ("S01-06", "F-4, 7.1", "mcp-http", [452, 453, 454], ["400", "-32020", "HeaderMismatch"], None,
     "A header that does not match the body, after decoding, gets HTTP 400 with JSON-RPC error -32020."),
    ("S01-07", "7.1", "mcp-versioning", [48, 49, 51], ["-32022", "Unsupported protocol version", "supported"], None,
     "An unsupported version gets error -32022 whose data lists the supported versions."),
    ("S01-08", "7.1", "mcp-http", [214, 215, 216], ["404", "-32601"], None,
     "An unknown method gets HTTP 404 with JSON-RPC error -32601."),
    ("S01-09", "7.1", "mcp-http", [219, 220, 221], ["2025-06-18", "MCP-Protocol-Version", "2025-03-26"], None,
     "A server that serves clients older than 2025-06-18 may treat a request with no MCP-Protocol-Version header as 2025-03-26."),
    ("S01-10", "F-4, 7.1", "mcp-discover", [6, 7, 8], ["server/discover", "MUST"], None,
     "Servers must implement server/discover (calling it is optional for clients)."),
    ("S01-11", "7.1", "mcp-discover", [79, 81, 83, 85], ["supportedVersions", "capabilities", "serverInfo", "instructions"], None,
     "The discover result carries supportedVersions, capabilities, serverInfo in _meta, and optional instructions."),
    ("S01-12", "4 row 1, 7.1", "mcp-http", [545, 546, 547, 548, 549, 550], ["GET", "405", "Mcp-Session-Id"], None,
     "A server that supports only this revision should answer GET or DELETE on the MCP endpoint with 405 and should neither mint nor echo session ids."),
    ("S01-13", "4.2", "mcp-http", [42, 44, 45, 46], ["Origin", "MUST", "403", "id"], None,
     "Servers must validate Origin; a present and invalid Origin gets 403, and the body may be a JSON-RPC error with no id."),
    ("S01-14", "7.1", "mcp-http", [559, 560], ["HTTP+SSE", "2024-11-05", "2025-03-26"], None,
     "The 2024-11-05 HTTP+SSE transport has been deprecated since 2025-03-26."),
    ("S01-15", "7.2", "mcp-tools", [50, 51, 52, 53], ["MUST NOT", "MAY", "authorization"], None,
     "The tools/list set must not vary per connection but may vary by the authorization presented on the request."),
    ("S01-16", "7.3", "mcp-tools", [632, 650], ["isError", "SHOULD"], None,
     "Tool execution errors are reported with isError true, and clients should pass them to the model."),
    ("S01-17", "7.2 (U-10)", "mcp-tools", [252], ["annotations"], None,
     "The tools page lists annotations as optional properties; the names readOnlyHint and destructiveHint do not appear on this page, so U-10 stays open."),
    ("S01-18", "7.1", "mcp-versioning", [148, 149], ["dual-era", "MAY", "same endpoint"], None,
     "A dual-era server may serve both eras on the same endpoint."),
    ("S01-19", "19", "mcp-transports", [14, 15, 17], ["stdio", "Streamable HTTP"], None,
     "The latest transports overview (it resolves to revision 2026-07-28) names stdio and Streamable HTTP as the standard transports."),
    ("S01-20", "9.8 S-1", "sb-limits", [104], ["Maximum Function Size", "20MB", "5MB"], None,
     "Function size limit: 20 MB when bundled by the CLI, 5 MB when bundled server-side."),
    ("S01-21", "9.8 S-1", "sb-limits", [101], ["Maximum CPU Time", "2s"], None,
     "CPU time limit: 2 s per request, async I/O not counted."),
    ("S01-22", "9.8 S-1", "sb-limits", [96, 99, 100], ["256MB", "150s", "400s"], None,
     "Memory 256 MB; wall clock 150 s on Free and 400 s on paid plans."),
    ("S01-23", "4 row 22, T13", "sb-invocations", [92], ["regardless of the response status code", "OPTIONS", "not billed"], None,
     "Every invocation is billed whatever the status code; preflight OPTIONS requests are not billed."),
    ("S01-24", "T13, 16", "sb-invocations", [115, 121, 124, 125], ["$2 per 1 million", "500,000", "2 million"], None,
     "Over-quota invocations cost 2 USD per million; quota is 500,000 on Free and 2 million on Pro."),
    ("S01-25", "F-5", "ms-openapi", [31], ["1 MB", "OpenAPI 2.0"], None,
     "A custom connector definition must be under 1 MB and in OpenAPI 2.0 (Swagger) format."),
    ("S01-26", "F-5", "ms-openapi", [40], ["OpenAPI 3.0", "not supported"], None,
     "OpenAPI 3.0 definitions are not supported for custom connectors."),
]
NEGATIVE = [("S01-17", "mcp-tools", ["readOnlyHint", "destructiveHint"])]  # tokens that must be ABSENT (U-10 open)
CACHE_NAME = {
    "mcp-http": "modelcontextprotocol.io_specification_2026-07-28_basic_transports_streamable-http.md.raw",
    "mcp-transports": "modelcontextprotocol.io_specification_latest_basic_transports.md.raw",
    "mcp-versioning": "modelcontextprotocol.io_specification_2026-07-28_basic_versioning.md.raw",
    "mcp-discover": "modelcontextprotocol.io_specification_2026-07-28_server_discover.md.raw",
    "mcp-tools": "modelcontextprotocol.io_specification_2026-07-28_server_tools.md.raw",
    "sb-limits": "supabase.com_docs_guides_functions_limits.raw",
    "sb-invocations": "supabase.com_docs_guides_platform_manage-your-usage_edge-function-invocations.raw",
    "ms-openapi": "learn.microsoft.com_en-us_connectors_custom-connectors_define-openapi-definition.raw",
}


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}
    BLOCK = {"p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "div", "td", "th", "br", "pre", "section", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def normalise(raw_bytes, is_markdown):
    text = raw_bytes.decode("utf-8", "replace")
    if not is_markdown:
        p = _Text()
        p.feed(text)
        text = html.unescape("".join(p.parts))
    out = []
    for line in text.splitlines():
        line = re.sub(r"[ \t\u00a0]+", " ", line).strip()
        if line:
            out.append(line)
    return out


def sha(line):
    return hashlib.sha256(line.encode("utf-8")).hexdigest()


def load(page, cache):
    if cache:
        with open(os.path.join(cache, CACHE_NAME[page]), "rb") as f:
            raw = f.read()
    else:
        req = urllib.request.Request(PAGES[page], headers={"User-Agent": "projexa-s01-verify/1"})
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
    return normalise(raw, PAGES[page].endswith(".md"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--emit", action="store_true", help="print the hash table rows used in AILINK_S01_fetches.md")
    args = ap.parse_args(argv)
    pages = {}
    ok = 0
    for fid, place, page, nums, tokens, _, summary in FACTS:
        if page not in pages:
            try:
                pages[page] = load(page, args.cache)
            except Exception as exc:  # an unreachable page is a failed fact, never a pass
                pages[page] = exc
        lines = pages[page]
        if isinstance(lines, Exception):
            print("FAIL %s %s: page unreachable (%s)" % (fid, PAGES[page], type(lines).__name__))
            continue
        try:
            got = [lines[n - 1] for n in nums]
        except IndexError:
            print("FAIL %s: page has only %d lines" % (fid, len(lines)))
            continue
        joined = " ".join(got)
        missing = [t for t in tokens if t.lower() not in joined.lower()]
        hashes = [sha(l)[:16] for l in got]
        want = EXPECTED.get(fid)
        moved = want is not None and hashes != want
        if missing or moved:
            # the page may have shifted: look for the recorded hashes anywhere on the page
            where = {sha(l)[:16]: i + 1 for i, l in enumerate(lines)}
            found = want is not None and all(h in where for h in want)
            if found and not missing:
                ok += 1
                print("PASS %s %s (lines moved to %s)" % (fid, place, [where[h] for h in want]))
                continue
            print("FAIL %s %s: missing tokens %s, hashes %s" % (fid, place, missing, "changed" if moved else "ok"))
            continue
        ok += 1
        print("PASS %s %s lines %s" % (fid, place, nums))
        if args.emit:
            print("EMIT|%s|%s|%s|%s|%s|%s" % (fid, place, PAGES[page], ",".join(map(str, nums)), " ".join(hashes), summary))
        if args.show:
            for n, l in zip(nums, got):
                print("    %d: %s" % (n, l))
    for fid, page, absent in NEGATIVE:
        lines = pages.get(page)
        if isinstance(lines, list):
            present = [t for t in absent if any(t in l for l in lines)]
            print("%s %s negative check: %s" % ("PASS" if not present else "NOTE", fid, "absent" if not present else "now present: %s" % present))
    print("S01-VERIFY: %d of %d facts match" % (ok, len(FACTS)))
    return 0 if ok == len(FACTS) else 1


# SHA-256 prefixes (16 hex) of the matched lines, as served on 2026-09-25 08:00 UTC.
EXPECTED = {
    "S01-01": ['d68335b73de5430b', '1acbbae2dd428be5', 'a7b8c60ff552ed15'],
    "S01-02": ['0712b4a6b3d7e4dd', '0ac413dcc0cc451a', '540202684648f436', '2dd424cae73081ea'],
    "S01-03": ['1c009f3cb4294516', '5cd0683129df86e7', '6a98f10b1237f20d', '1eab4d0038e60b8b', '967a212ca4ec4562', '165748bdc51db19f'],
    "S01-04": ['560659c45b5b5cce', '50d1d6737725daab', 'd27433454c75ceb7'],
    "S01-05": ['874195e3c10d6606', '709f16d4e2db45e3'],
    "S01-06": ['a64f87f4adbd8093', '9e7b45276554968f', '4e8b21d31af918a3'],
    "S01-07": ['4db3da32c5a9dd5c', '590f0b19d654a8b3', 'aaf08068c024a273'],
    "S01-08": ['b78b0b66917edb94', 'a12cf8ad4e85e61e', '70e671ec9ab5e976'],
    "S01-09": ['a3c7320cd9565386', 'f0f609bc076c8d12', '2ce9bf486a0688ba'],
    "S01-10": ['71e2c327b7fa3fd1', '814f0d7277d3201b', '4e1c1ce72c9e908c'],
    "S01-11": ['8e8d8393d2a83452', '329f5032a39d24a6', 'd2b17b210be68de4', '0031385b7172ca1d'],
    "S01-12": ['816cd7dc5f2fa89e', '9fed53f3b4fcea26', '378714d4db6bbf14', '23ad3487b80f54ea', 'b075d4bd59706d8f', '0259314293e5429b'],
    "S01-13": ['09c884fbe3bfe506', '84f90141bd783481', 'de9380cec7d2acdd', 'ed6bd37cd3086dd1'],
    "S01-14": ['c06fed81e1f3e1d9', '493d261bf006c636'],
    "S01-15": ['bb02ce0f1272f658', '65a0fe056032158c', '6ddf4ac2e8ea56ab', '85a4909d0e063f9c'],
    "S01-16": ['deea96112d09b44f', '55f83ca2f81c8906'],
    "S01-17": ['3afc396a8d798065'],
    "S01-18": ['f7fb20d21111b916', 'f868570914791721'],
    "S01-19": ['a0234c39f183b438', '4202338b84a6cb19', '68dba990ee945d07'],
    "S01-20": ['4ef6f6142bcd1b7a'],
    "S01-21": ['a914d28cc9dab576'],
    "S01-22": ['4c4d4f22bab9107b', 'cb725f5f4fd86458', '0e22179734ee849d'],
    "S01-23": ['f1c8cda0cf6bba83'],
    "S01-24": ['65d19a44a3aeb925', '17d31d542311edaf', '9b066e6c89fb43b8', '0624f30042f322c2'],
    "S01-25": ['d00c9854a946f4d8'],
    "S01-26": ['a94b9812bb5cae97'],
}

if __name__ == "__main__":
    sys.exit(main())
