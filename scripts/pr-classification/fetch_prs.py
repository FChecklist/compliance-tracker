#!/usr/bin/env python3
"""
Fetch every open PR on FChecklist/compliance-tracker via the GitHub GraphQL
API (paginated) with its real changed-file list (also paginated per-PR when
a PR has >100 changed files), and dump the raw result to JSON.

Read-only. No mutation. Requires `gh` CLI authenticated (see `gh auth status`).

Usage: python3 fetch_prs.py > raw_prs.json
"""
import json
import subprocess
import sys
import os

OWNER = "FChecklist"
NAME = "compliance-tracker"
QUERY_PATH = os.path.join(os.path.dirname(__file__), "pr-query.graphql")

PAGE_QUERY = open(QUERY_PATH).read()

FILES_QUERY = """
query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      files(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { path changeType additions deletions }
      }
    }
  }
}
"""


def gh_graphql(query, **variables):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in variables.items():
        if isinstance(v, int):
            args += ["-F", f"{k}={v}"]
        else:
            args += ["-f", f"{k}={v if v is not None else ''}"]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"gh api graphql failed (exit {result.returncode})")
    data = json.loads(result.stdout)
    if "errors" in data:
        raise SystemExit(f"GraphQL errors: {data['errors']}")
    return data["data"]


def fetch_remaining_files(number, cursor):
    files = []
    while True:
        data = gh_graphql(FILES_QUERY, owner=OWNER, name=NAME, number=number, cursor=cursor)
        f = data["repository"]["pullRequest"]["files"]
        files.extend(f["nodes"])
        if not f["pageInfo"]["hasNextPage"]:
            break
        cursor = f["pageInfo"]["endCursor"]
    return files


def main():
    all_prs = []
    cursor = None
    page = 0
    while True:
        data = gh_graphql(PAGE_QUERY, owner=OWNER, name=NAME, cursor=cursor)
        pr_conn = data["repository"]["pullRequests"]
        total_count = pr_conn["totalCount"]
        for node in pr_conn["nodes"]:
            files_conn = node["files"]
            files = list(files_conn["nodes"])
            if files_conn["pageInfo"]["hasNextPage"]:
                files.extend(
                    fetch_remaining_files(node["number"], files_conn["pageInfo"]["endCursor"])
                )
            all_prs.append(
                {
                    "number": node["number"],
                    "title": node["title"],
                    "author": node["author"]["login"] if node["author"] else None,
                    "createdAt": node["createdAt"],
                    "headRefName": node["headRefName"],
                    "additions": node["additions"],
                    "deletions": node["deletions"],
                    "changedFilesCount": node["changedFiles"],
                    "files": files,
                    "filesTotalCountReported": files_conn["totalCount"],
                }
            )
        page += 1
        print(
            f"page {page}: fetched {len(pr_conn['nodes'])} PRs "
            f"(running total {len(all_prs)}/{total_count})",
            file=sys.stderr,
        )
        if not pr_conn["pageInfo"]["hasNextPage"]:
            break
        cursor = pr_conn["pageInfo"]["endCursor"]

    print(json.dumps({"totalCount": total_count, "prs": all_prs}, indent=2))


if __name__ == "__main__":
    main()
