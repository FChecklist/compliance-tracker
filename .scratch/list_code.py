import json
d = json.load(open('ai-os/registry/pr-classification-20260816.json'))
code_nums = sorted(p['number'] for p in d['prs'] if p['class'] == 'CODE')
print(len(code_nums))
print(code_nums)
