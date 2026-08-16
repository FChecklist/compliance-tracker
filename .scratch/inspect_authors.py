import json
d = json.load(open('.scratch/raw_prs.json'))
authors = {}
for pr in d['prs']:
    authors[pr['author']] = authors.get(pr['author'], 0) + 1
print(authors)
