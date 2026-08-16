#!/usr/bin/env python3
"""
Deterministic file-signature classification of every open PR on
FChecklist/compliance-tracker, per Owner directive 2026-08-16
(task-20260816-171212-classify-the-entire-compliance-tracker-p).

Input:  .scratch/raw_prs.json (produced by fetch_prs.py — real GraphQL data,
        every open PR's real changed-file list, additions/deletions).
Output: ai-os/registry/pr-classification-20260816.json (committed).

Classes (exactly one per PR), precedence in this order:
  1. EMPTY       — zero changed files, OR the single changed file is a
                    bare gitlink/submodule-pointer entry with no real
                    text diff (additions==0 and deletions==0 on the only
                    changed file) — the known fake-PR pattern this repo
                    has seen before.
  2. DEPENDENCY  — author is dependabot (a dependabot version-bump PR),
                    checked after EMPTY so a (hypothetical) empty
                    dependabot PR still reports as EMPTY.
  3. DOCS-ONLY   — every changed path is documentation or progress
                    reporting: a markdown file (.md/.mdx), a file whose
                    basename starts with PROGRESS (any case/extension),
                    or a path with a directory component literally named
                    "docs" or "progress" — AND zero source, config, test,
                    or schema files.
                    NOTE on ai-os/*.yaml: deliberately NOT treated as
                    docs-only even though much of ai-os/ is governance
                    narrative, because grep confirms real application
                    routes/services and CI scripts parse and act on
                    ai-os/CONSTITUTION.yaml, MASTER-TRACKER.yaml,
                    ACTIVE-CLAIMS.yaml, COMPLETED.yaml, and ai-os/registry/*
                    (e.g. src/lib/status-source-of-truth.ts,
                    src/app/api/ai/team/governance-health/route.ts,
                    scripts/check-guardrail-presence.mjs,
                    scripts/check-governance-yaml-parse.mjs). A change to
                    one of those files can alter real governed behavior,
                    so it is conservatively classed as CODE, not DOCS-ONLY
                    — see AGENTS.md Rule 9 (no guardrail weakened without
                    sign-off) for why this conservatism matters here.
  4. CODE        — everything else: at least one real source, test,
                    config, or schema file (includes .ts/.tsx/.js/.mjs/
                    .py/.sql/.json/.jsonc/.sh/.css/.html/lockfiles/
                    .github/workflows/* and ai-os/*.yaml per the note
                    above).
"""
import json
import os
import re

SCRATCH_DIR = os.path.join(os.path.dirname(__file__), "..", "..", ".scratch")
RAW_PATH = os.path.join(SCRATCH_DIR, "raw_prs.json")
OUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "ai-os", "registry", "pr-classification-20260816.json"
)

DOC_EXTENSIONS = {"md", "mdx"}


def is_doc_path(path: str) -> bool:
    parts = path.split("/")
    fname = parts[-1]
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    if ext in DOC_EXTENSIONS:
        return True
    if re.match(r"(?i)^progress", fname):
        return True
    dirs_lower = [p.lower() for p in parts[:-1]]
    if "docs" in dirs_lower or "progress" in dirs_lower:
        return True
    return False


def classify(pr: dict) -> tuple[str, str]:
    files = pr["files"]
    if len(files) == 0:
        return "EMPTY", "zero changed files"
    if len(files) == 1 and files[0]["additions"] == 0 and files[0]["deletions"] == 0:
        return (
            "EMPTY",
            f"single changed file '{files[0]['path']}' with additions=0 deletions=0 "
            "(no real text diff — bare gitlink/submodule-pointer pattern)",
        )
    if pr["author"] and pr["author"].lower().startswith("dependabot"):
        return "DEPENDENCY", "authored by dependabot"
    doc_paths = [f["path"] for f in files if is_doc_path(f["path"])]
    non_doc_paths = [f["path"] for f in files if not is_doc_path(f["path"])]
    if not non_doc_paths:
        return "DOCS-ONLY", f"all {len(doc_paths)} changed file(s) are markdown/PROGRESS/docs-or-progress-dir"
    return (
        "CODE",
        f"{len(non_doc_paths)} of {len(files)} changed file(s) are real source/config/test/schema "
        f"(e.g. {non_doc_paths[0]})",
    )


def main():
    with open(RAW_PATH) as fh:
        data = json.load(fh)
    prs = data["prs"]

    results = []
    counts = {"EMPTY": 0, "DEPENDENCY": 0, "DOCS-ONLY": 0, "CODE": 0}
    for pr in prs:
        cls, reason = classify(pr)
        counts[cls] += 1
        results.append(
            {
                "number": pr["number"],
                "title": pr["title"],
                "author": pr["author"],
                "createdAt": pr["createdAt"],
                "headRefName": pr["headRefName"],
                "changedFilesCount": len(pr["files"]),
                "files": [f["path"] for f in pr["files"]],
                "class": cls,
                "reason": reason,
            }
        )

    out = {
        "generatedFrom": "gh api graphql (live, real paginated open-PR + changed-file fetch)",
        "repo": "FChecklist/compliance-tracker",
        "totalOpenPrs": data["totalCount"],
        "classCounts": counts,
        "classificationRules": (
            "See scripts/pr-classification/classify.py module docstring for the exact, "
            "deterministic precedence and file-signature rules applied."
        ),
        "prs": sorted(results, key=lambda r: r["number"]),
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(json.dumps(counts, indent=2))
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
