import json
d = json.load(open('ai-os/registry/pr-classification-20260816.json'))
docs = [p for p in d['prs'] if p['class'] == 'DOCS-ONLY']
print("DOCS-ONLY count:", len(docs))
for p in docs:
    print(p['number'], '|', p['createdAt'][:10], '|', p['title'][:90], '|', p['files'])
