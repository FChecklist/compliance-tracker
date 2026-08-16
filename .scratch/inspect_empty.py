import json
d = json.load(open('.scratch/raw_prs.json'))
prs = d['prs']

zero_files = [p for p in prs if len(p['files']) == 0]
print("zero-file PRs:", len(zero_files))
for p in zero_files:
    print(" ", p['number'], p['author'], p['title'][:70], "changedFilesCount=", p['changedFilesCount'], "additions=", p['additions'], "deletions=", p['deletions'])

print()
one_file_zero_diff = [p for p in prs if len(p['files']) == 1 and p['files'][0]['additions'] == 0 and p['files'][0]['deletions'] == 0]
print("1-file zero-diff PRs (candidate bare gitlink):", len(one_file_zero_diff))
for p in one_file_zero_diff:
    print(" ", p['number'], p['author'], p['title'][:70], p['files'][0])

print()
small_file_count = [p for p in prs if 0 < len(p['files']) <= 1]
print("PRs with exactly 1 file total:", len(small_file_count))
