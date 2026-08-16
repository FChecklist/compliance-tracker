import json, collections
d = json.load(open('.scratch/raw_prs.json'))
prs = d['prs']
print("total", len(prs))

ext_counter = collections.Counter()
for p in prs:
    for f in p['files']:
        path = f['path']
        ext = path.rsplit('.', 1)[-1] if '.' in path.rsplit('/',1)[-1] else '(none)'
        ext_counter[ext] += 1
print("all extensions:", ext_counter.most_common(40))

def is_md_or_progress_or_docsdir(path):
    parts = path.split('/')
    lower = path.lower()
    if lower.endswith('.md') or lower.endswith('.mdx'):
        return True
    if 'progress' in [p.lower() for p in parts[:-1]]:
        return True
    if 'docs' in [p.lower() for p in parts[:-1]]:
        return True
    fname = parts[-1]
    if fname.upper().startswith('PROGRESS'):
        return True
    return False

# PRs where ALL files are md/progress/docsdir
strict_docs_only = []
ai_os_yaml_only = []
for p in prs:
    if p['author'] == 'dependabot':
        continue
    if not p['files']:
        continue
    if all(is_md_or_progress_or_docsdir(f['path']) for f in p['files']):
        strict_docs_only.append(p)

print("strict docs-only (md/progress/docs-dir) count:", len(strict_docs_only))

# how many PRs touch ONLY ai-os/*.yaml (no md) type files, non-dependabot
def is_ai_os_yaml(path):
    return path.startswith('ai-os/') and (path.endswith('.yaml') or path.endswith('.yml'))

ai_os_yaml_only = []
mixed_ai_os_and_md = []
for p in prs:
    if p['author'] == 'dependabot' or not p['files']:
        continue
    paths = [f['path'] for f in p['files']]
    if all(is_ai_os_yaml(x) or is_md_or_progress_or_docsdir(x) for x in paths):
        if any(is_ai_os_yaml(x) for x in paths):
            mixed_ai_os_and_md.append(p)

print("md/progress/docsdir + ai-os yaml only (no other files) count:", len(mixed_ai_os_and_md))
for p in mixed_ai_os_and_md[:8]:
    print(" ", p['number'], p['title'][:70], [f['path'] for f in p['files']][:6])
