#!/usr/bin/env python3
"""
Software Request Analyzer -- the mandatory triage gate specified in
ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md section 1. Run this BEFORE
dispatching anything to an AI. Rule-based, $0 cost, deterministic.

Usage: software-request-analyzer.py "<request description>"
Output (stdout, JSON): {"route": "SOFTWARE_ONLY"|"SPLIT"|"AI_REQUIRED",
                        "software_pct": int, "ai_pct": int, "reasoning": str}

This is intentionally conservative and rule-based, not itself an AI call --
the whole point is a $0 check that runs before any AI is invoked. It will
under-classify some genuinely software-solvable requests (natural language
is ambiguous) -- that's the correct failure mode: a false AI_REQUIRED wastes
tokens, a false SOFTWARE_ONLY on something that actually needs judgment is
worse (wrong output shipped as if deterministic). When unsure, this errs
toward AI_REQUIRED or SPLIT, never a false SOFTWARE_ONLY.
"""
import json
import re
import sys

# Patterns strongly indicating a fully deterministic operation -- software
# can do 100% of these. Keep this list curated and conservative; a false
# positive here is worse than a false negative.
SOFTWARE_ONLY_PATTERNS = [
    (r"\brun (the )?(tests?|lint|typecheck|build)\b", "test/lint/build execution"),
    (r"\bcheck if .* (exists|matches|equals)\b", "existence/equality check"),
    (r"\bformat(ting)? (the )?(file|code|json|csv)\b", "format conversion"),
    (r"\bvalidate .* against\b", "rule validation"),
    (r"\bcalculate\b|\bcompute\b", "calculation — check src/lib/engines/ VCEL registry first"),
    (r"\blist all\b|\bfind all files\b|\bgrep for\b", "lookup/search"),
    (r"\bgit (status|log|diff|commit|push|pull)\b", "git operation"),
    (r"\bconvert .* to (json|csv|yaml|xml)\b", "format conversion"),
    (r"\baggregate\b|\bsum\b|\bcount\b.*\bfrom\b", "report/aggregation from existing data"),
    (r"\bstatus transition\b.*\brule\b", "explicit-rule status transition"),
]

# Patterns indicating a mostly-software task with a small AI sliver.
SPLIT_PATTERNS = [
    (r"\bgenerate .* matching (the )?(existing )?pattern\b", 80, "boilerplate from existing pattern"),
    (r"\bexplain why .* fail(ed)?\b", 40, "diagnostic synthesis after software gathers logs/state"),
    (r"\badapt\b.*\bexisting\b", 70, "adaptation of existing code/config"),
    (r"\bsummarize\b.*\b(log|output|result)s?\b", 30, "summarization of software-gathered data"),
]

# Patterns indicating genuine judgment/creativity — AI-required, minimal
# software portion (maybe scaffolding only).
AI_REQUIRED_PATTERNS = [
    (r"\bwrite new (business )?logic\b", "novel logic, no existing pattern"),
    (r"\bdesign\b", "design/judgment call"),
    (r"\bdecide\b|\brecommend\b", "decision requiring judgment"),
    (r"\bexplore\b|\breverse.engineer\b", "open-ended exploration"),
    (r"\breview\b.*\bfor (quality|correctness|security)\b", "qualitative review"),
]


def analyze(request_text: str) -> dict:
    text = request_text.lower()

    for pattern, reason in SOFTWARE_ONLY_PATTERNS:
        if re.search(pattern, text):
            return {"route": "SOFTWARE_ONLY", "software_pct": 100, "ai_pct": 0, "reasoning": reason}

    for pattern, reason in AI_REQUIRED_PATTERNS:
        if re.search(pattern, text):
            return {"route": "AI_REQUIRED", "software_pct": 10, "ai_pct": 90, "reasoning": reason}

    for pattern, software_pct, reason in SPLIT_PATTERNS:
        if re.search(pattern, text):
            return {"route": "SPLIT", "software_pct": software_pct, "ai_pct": 100 - software_pct, "reasoning": reason}

    # Default: unclassified natural-language request. Conservative fallback
    # per the module docstring -- never a false SOFTWARE_ONLY.
    return {
        "route": "AI_REQUIRED",
        "software_pct": 0,
        "ai_pct": 100,
        "reasoning": "no matching rule -- unclassified, defaulting to AI_REQUIRED rather than risking a false SOFTWARE_ONLY. "
                     "Consider adding a rule to this script if this request shape recurs.",
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: software-request-analyzer.py \"<request description>\""}))
        sys.exit(1)
    result = analyze(" ".join(sys.argv[1:]))
    print(json.dumps(result))
