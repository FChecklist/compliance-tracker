import json, collections
d = json.load(open('.scratch/raw_prs.json'))
prs = d['prs']

docs_titled = [p for p in prs if p['title'].lower().startswith('docs')]
print("count docs-titled:", len(docs_titled))

ext_counter = collections.Counter()
dir_counter = collections.Counter()
for p in docs_titled:
    for f in p['files']:
        path = f['path']
        ext = path.rsplit('.', 1)[-1] if '.' in path else '(none)'
        ext_counter[ext] += 1
        top = path.split('/')[0]
        dir_counter[top] += 1

print("extensions:", ext_counter.most_common(20))
print("top-level dirs:", dir_counter.most_common(20))

# show a few examples with non-md files
for p in docs_titled[:5]:
    print(p['number'], p['title'], [f['path'] for f in p['files']])
