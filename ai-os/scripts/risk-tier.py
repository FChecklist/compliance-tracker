#!/usr/bin/env python3
"""
Deterministic (non-AI) risk-tier classifier for a task's diff against its
base branch. tier1 = server-side Superboss may merge autonomously.
tier2 = Superboss may approve but must hold for human sign-off.
Classification must stay simple and auditable — do not let the AI reviewer
override it; this is the trust boundary, not a suggestion.
"""
import re
import subprocess
import sys

TIER2_PATH_PATTERNS = [
    r"migrations?/",
    r"schema\.(sql|prisma)",
    r"\.sql$",
    r"(^|/)auth/",
    r"permission",
    r"payment",
    r"billing",
    r"\brls\b",
    r"security",
    r"\.env",
]


def main():
    workspace, base_ref = sys.argv[1], sys.argv[2]

    files = subprocess.run(
        ["git", "-C", workspace, "diff", "--name-only", f"{base_ref}...HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()

    numstat = subprocess.run(
        ["git", "-C", workspace, "diff", "--numstat", f"{base_ref}...HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()

    tier = "tier1"
    reasons = []

    for f in files:
        for pat in TIER2_PATH_PATTERNS:
            if re.search(pat, f, re.IGNORECASE):
                tier = "tier2"
                reasons.append(f"path matched /{pat}/: {f}")

    total_add, total_del = 0, 0
    for line in numstat:
        parts = line.split("\t")
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            total_add += int(parts[0])
            total_del += int(parts[1])
    if total_del > 20 and total_del > total_add * 2:
        tier = "tier2"
        reasons.append(f"heavy deletion: -{total_del}/+{total_add}")

    print(tier)
    if reasons:
        print("\n".join(reasons), file=sys.stderr)


if __name__ == "__main__":
    main()
