import json
d = json.load(open('ai-os/registry/pr-classification-20260816.json'))
p = [x for x in d['prs'] if x['number'] == 1136]
print(p)
