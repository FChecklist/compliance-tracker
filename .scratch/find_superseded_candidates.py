import json, re, os, subprocess

d = json.load(open('ai-os/registry/pr-classification-20260816.json'))
docs = [p for p in d['prs'] if p['class'] == 'DOCS-ONLY']

UMR_RE = re.compile(r'UMR-\d{8}-\d{6}-[0-9a-f]{4}', re.IGNORECASE)

MAIN_TREE = '.scratch/main-tree'

# Build UMR -> list of files on main mentioning it (grep -rl across main tree,
# text files only, skip binary/huge dirs we don't care about)
def grep_main_for_umr(umr):
    try:
        out = subprocess.run(
            ["grep", "-rIl", "-i", umr, MAIN_TREE],
            capture_output=True, text=True, timeout=30
        )
        return [l[len(MAIN_TREE)+1:] for l in out.stdout.splitlines()]
    except Exception as e:
        return []

results = []
for p in docs:
    umrs = set(m.upper() for m in UMR_RE.findall(p['title']))
    entry = {"number": p['number'], "title": p['title'], "files": p['files'], "umrs": sorted(umrs)}
    if umrs:
        matches = {}
        for u in umrs:
            matches[u] = grep_main_for_umr(u)
        entry["main_matches"] = matches
    results.append(entry)

with open('.scratch/docsonly_umr_matches.json', 'w') as fh:
    json.dump(results, fh, indent=2)

# Summary
with_umr = [r for r in results if r['umrs']]
print("DOCS-ONLY PRs with a UMR id in title:", len(with_umr))
has_main_match = [r for r in with_umr if any(r['main_matches'].get(u) for u in r['umrs'])]
print("...of which at least one UMR id already appears somewhere on main:", len(has_main_match))
no_main_match = [r for r in with_umr if not any(r['main_matches'].get(u) for u in r['umrs'])]
print("...of which NO UMR id appears on main (not superseded):", len(no_main_match))
no_umr = [r for r in results if not r['umrs']]
print("DOCS-ONLY PRs with NO UMR id in title (need separate check):", len(no_umr))
